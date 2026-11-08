/** Canonical M9 reads over the same demo payments used by the selling screens. */
import { delay } from "msw";
import { http, HttpResponse } from "msw/http";
import { z } from "zod";
import { can } from "../shared/domain/schema";
import { assert, DomainError, store } from "./store";
import { salesProductSnapshot } from "./payments";

const purposes = ["이용권", "스터디룸", "사물함"] as const;
type Purpose = (typeof purposes)[number];
type Entry = {
  id: string;
  entryType: "승인" | "환불";
  paymentId: string;
  refundId: string | null;
  branchId: string;
  processingBranchId: string | null;
  purpose: Purpose;
  productId: string | null;
  productName: string | null;
  categoryCode: string | null;
  categoryName: string | null;
  passQuantity: number;
  amountKrw: number;
  approvedAt: string;
  refundedAt: string | null;
  basisAt: string;
  canViewPayment: boolean;
};
function totals(rows: Entry[]) {
  const approved = rows.filter((r) => r.entryType === "승인"),
    refunds = rows.filter((r) => r.entryType === "환불");
  const approvedAmountKrw = approved.reduce((n, r) => n + r.amountKrw, 0),
    refundAmountKrw = -refunds.reduce((n, r) => n + r.amountKrw, 0);
  return {
    approvedAmountKrw,
    refundAmountKrw: refundAmountKrw || 0,
    netAmountKrw: approvedAmountKrw - refundAmountKrw,
    approvedPaymentCount: approved.length,
    refundCount: refunds.length,
    dataStatus: rows.length ? "hasData" : "noData",
  };
}
function invalid(
  condition: unknown,
  message: string,
  code = "VALIDATION_FAILED",
): asserts condition {
  assert(condition, message, 422, code);
}
type SalesRead =
  "revenue" | "branches" | "ledger" | "volume" | "products" | "trend";
type ProductSnapshot = NonNullable<ReturnType<typeof salesProductSnapshot>>;
function volume(rows: Entry[]) {
  const paymentCount = rows.filter((row) => row.entryType === "승인").length;
  const refundedQuantity = rows.length - paymentCount;
  return {
    paymentCount,
    soldQuantity: paymentCount,
    refundedQuantity,
    netSoldQuantity: paymentCount - refundedQuantity,
    issuedCount: paymentCount,
    dataStatus: rows.length ? "hasData" : "noData",
  };
}
function trendBuckets(
  from: string,
  to: string,
  granularity: "day" | "week" | "month",
) {
  const offset = 9 * 3600000;
  const first = Date.parse(from),
    last = Date.parse(to);
  const cursor = new Date(first + offset);
  cursor.setUTCHours(0, 0, 0, 0);
  if (granularity === "week")
    cursor.setUTCDate(cursor.getUTCDate() - ((cursor.getUTCDay() + 6) % 7));
  if (granularity === "month") cursor.setUTCDate(1);
  const items = [];
  while (cursor.getTime() - offset < last) {
    const label = cursor
      .toISOString()
      .slice(0, granularity === "month" ? 7 : 10);
    const bucketStart = cursor.getTime() - offset;
    if (granularity === "month") cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else
      cursor.setUTCDate(cursor.getUTCDate() + (granularity === "week" ? 7 : 1));
    const bucketEnd = cursor.getTime() - offset;
    const start = Math.max(bucketStart, first),
      end = Math.min(bucketEnd, last);
    items.push({
      label,
      bucketStart: new Date(bucketStart).toISOString(),
      bucketEnd: new Date(bucketEnd).toISOString(),
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      partial: start !== bucketStart || end !== bucketEnd,
    });
  }
  return items;
}
function build(request: Request, kind: SalesRead) {
  const actor = store.activeUser(),
    q = new URL(request.url).searchParams;
  const selected = q.getAll("branchIds");
  invalid(
    selected.every(Boolean) && selected.length === new Set(selected).size,
    "지점 선택을 확인해 주세요.",
  );
  const branchIds = selected.length
    ? selected
    : store.db.branches
        .filter((b) => can(actor, b.id, "sales:read"))
        .map((b) => b.id);
  const asOf = store.now(),
    day = new Date(Date.parse(asOf) + 9 * 3600000).toISOString().slice(0, 10);
  let from = q.get("from"),
    to = q.get("to");
  invalid(
    (from === null) === (to === null),
    "시작과 종료를 함께 지정해 주세요.",
  );
  const defaultPeriod = from === null;
  if (defaultPeriod) {
    from = new Date(`${day.slice(0, 7)}-01T00:00:00+09:00`).toISOString();
    to = new Date(Date.parse(`${day}T00:00:00+09:00`) + 86400000).toISOString();
  }
  from = z.iso.datetime({ offset: true }).parse(from);
  to = z.iso.datetime({ offset: true }).parse(to);
  invalid(Date.parse(from) < Date.parse(to), "종료는 시작 이후여야 합니다.");
  invalid(
    Date.parse(to) - Date.parse(from) <= 366 * 86400000,
    "조회 기간은 366일 이내로 선택해 주세요.",
    "PERIOD_TOO_LONG",
  );
  const refundBasis = z
    .enum(["processedDate", "paymentDate"])
    .parse(q.get("refundBasis") ?? "processedDate");
  const measure =
    kind === "trend"
      ? z.enum(["revenue", "passes"]).parse(q.get("measure") ?? "revenue")
      : null;
  const granularity =
    kind === "trend"
      ? z.enum(["day", "week", "month"]).parse(q.get("granularity") ?? "day")
      : null;
  const passes =
    kind === "volume" || kind === "products" || measure === "passes";
  const purpose = passes
    ? "이용권"
    : q.has("purpose")
      ? z.enum(purposes).parse(q.get("purpose"))
      : null;
  invalid(
    passes ? !q.has("purpose") : !q.has("productId") && !q.has("categoryCode"),
    "집계에 적용할 수 없는 필터입니다.",
  );
  const productId = q.get("productId"),
    categoryCode = q.get("categoryCode");
  assert(
    branchIds.length &&
      branchIds.every(
        (id) =>
          store.db.branches.some((b) => b.id === id) &&
          can(actor, id, "sales:read"),
      ),
    "매출 조회 권한이 없습니다.",
    403,
    "FORBIDDEN",
  );
  const entryType =
    kind === "ledger" && q.has("entryType")
      ? z.enum(["승인", "환불"]).parse(q.get("entryType"))
      : null;
  const rows: Entry[] = [];
  const snapshots = new Map<string, ProductSnapshot>();
  const within = (at: string) =>
    Date.parse(at) >= Date.parse(from) &&
    Date.parse(at) < Date.parse(to) &&
    Date.parse(at) <= Date.parse(asOf);
  if (store.scenario !== "empty")
    for (const row of store.db.payments) {
      if (
        !branchIds.includes(row.branchId) ||
        row.status === "실패" ||
        !row.approvedAt
      )
        continue;
      const p =
        row.canonical?.purpose ?? (row.reservationId ? "스터디룸" : "이용권");
      if (purpose && purpose !== p) continue;
      const snapshot =
        p === "이용권" && row.productId ? salesProductSnapshot(row) : null;
      if (productId !== null && row.productId !== productId) continue;
      if (categoryCode !== null && snapshot?.categoryCode !== categoryCode)
        continue;
      if (snapshot) snapshots.set(row.id, snapshot);
      const approvedAt = row.canonical?.approvedAt ?? row.approvedAt;
      const refund = row.canonical?.refund;
      const refundedAt = refund?.refundedAt ?? row.refundAt;
      const common = {
        paymentId: row.id,
        branchId: row.branchId,
        purpose: p,
        productId: p === "이용권" ? row.productId : null,
        productName: snapshot?.productName ?? null,
        categoryCode: snapshot?.categoryCode ?? null,
        categoryName: snapshot?.categoryName ?? null,
        approvedAt,
        canViewPayment: can(actor, row.branchId, "payments:read"),
      };
      if ((!entryType || entryType === "승인") && within(approvedAt))
        rows.push({
          ...common,
          id: `payment-${row.id}`,
          entryType: "승인",
          refundId: null,
          processingBranchId: null,
          passQuantity: p === "이용권" ? 1 : 0,
          amountKrw: row.amount,
          refundedAt: null,
          basisAt: approvedAt,
        });
      const basisAt = refundBasis === "paymentDate" ? approvedAt : refundedAt;
      if (
        (!entryType || entryType === "환불") &&
        refundedAt &&
        Date.parse(refundedAt) <= Date.parse(asOf) &&
        within(basisAt)
      )
        rows.push({
          ...common,
          id: `refund-${refund?.id ?? `refund-${row.id}`}`,
          entryType: "환불",
          refundId: refund?.id ?? `refund-${row.id}`,
          processingBranchId: refund?.processingBranchId ?? row.refundBranchId,
          passQuantity: p === "이용권" ? -1 : 0,
          amountKrw: -row.amount,
          refundedAt,
          basisAt,
        });
    }
  const byPurpose = (items: Entry[]) =>
    (purpose ? [purpose] : purposes).map((p) => ({
      purpose: p,
      ...totals(items.filter((r) => r.purpose === p)),
    }));
  const aggregation = (
    rowCount: number,
    firstBucketPartial: boolean | null = null,
    lastBucketPartial: boolean | null = null,
  ) => ({
    condition: {
      branchIds: [...branchIds].sort(),
      allBranches: !selected.length,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      refundBasis,
      purpose,
      productId,
      categoryCode,
      granularity,
    },
    defaultPeriod,
    timeZone: "Asia/Seoul",
    currency: "KRW",
    asOf,
    rowCount,
    sourceRowCount: rows.length,
    dataStatus: rows.length ? "hasData" : "noData",
    partial: {
      periodOpen: Date.parse(to) > Date.parse(asOf),
      firstBucketPartial,
      lastBucketPartial,
    },
    metrics: passes
      ? [
          { id: "pass.payment_count", unit: "건" },
          { id: "pass.sold_quantity", unit: "개" },
          { id: "pass.refunded_quantity", unit: "개" },
          { id: "pass.net_sold_quantity", unit: "개" },
          { id: "pass.issued_count", unit: "개" },
        ]
      : [
          { id: "sales.approved_amount", unit: "원" },
          { id: "sales.refund_amount", unit: "원" },
          { id: "sales.net_amount", unit: "원" },
          { id: "sales.approved_payment_count", unit: "건" },
          { id: "sales.refund_count", unit: "건" },
        ],
  });
  if (kind === "revenue")
    return {
      aggregation: aggregation(purpose ? 1 : 3),
      totals: totals(rows),
      byPurpose: byPurpose(rows),
    };
  if (kind === "volume")
    return { aggregation: aggregation(1), totals: volume(rows) };
  if (kind === "trend" && granularity) {
    const values = (items: Entry[]) => ({
      revenue: passes ? null : totals(items),
      passes: passes ? volume(items) : null,
    });
    const items = trendBuckets(from, to, granularity).map((bucket) => ({
      ...bucket,
      ...values(
        rows.filter(
          (row) =>
            Date.parse(row.basisAt) >= Date.parse(bucket.start) &&
            Date.parse(row.basisAt) < Date.parse(bucket.end),
        ),
      ),
    }));
    return {
      aggregation: aggregation(
        items.length,
        items[0]?.partial,
        items.at(-1)?.partial,
      ),
      measure,
      granularity,
      totals: values(rows),
      items,
    };
  }
  const direction = z.enum(["asc", "desc"]).parse(q.get("direction") ?? "desc"),
    factor = direction === "asc" ? 1 : -1;
  if (kind === "branches") {
    const sort = z
      .enum([
        "netAmount",
        "approvedAmount",
        "refundAmount",
        "branchId",
        "requested",
      ])
      .parse(q.get("sort") ?? "netAmount");
    const items = branchIds.map((id) => {
      const items = rows.filter((r) => r.branchId === id);
      return {
        branchId: id,
        branchName: store.get("branches", id).name,
        ...totals(items),
        byPurpose: byPurpose(items),
      };
    });
    if (sort !== "requested")
      items.sort(
        (a, b) =>
          factor *
          ((sort === "branchId" ? 0 : a[`${sort}Krw`] - b[`${sort}Krw`]) ||
            a.branchId.localeCompare(b.branchId)),
      );
    return {
      aggregation: aggregation(items.length),
      totals: totals(rows),
      items,
    };
  }
  const page = z.coerce
      .number()
      .int()
      .min(1)
      .parse(q.get("page") ?? 1),
    pageSize = z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .parse(q.get("pageSize") ?? 20);
  if (kind === "products") {
    const groups = new Map<
      string,
      { product: ProductSnapshot & { productId: string }; rows: Entry[] }
    >();
    for (const row of rows) {
      const snapshot = snapshots.get(row.paymentId);
      if (!snapshot || !row.productId) continue;
      const product = { productId: row.productId, ...snapshot };
      const key = JSON.stringify(product);
      const group = groups.get(key) ?? { product, rows: [] };
      group.rows.push(row);
      groups.set(key, group);
    }
    const compare = (a: string, b: string) => (a === b ? 0 : a < b ? -1 : 1);
    const items = [...groups.values()]
      .map(({ product, rows }) => ({ ...product, ...volume(rows), rank: 0 }))
      .sort(
        (a, b) =>
          b.netSoldQuantity - a.netSoldQuantity ||
          compare(a.productId, b.productId) ||
          compare(a.productName, b.productName) ||
          compare(a.categoryCode, b.categoryCode) ||
          compare(a.categoryName, b.categoryName),
      );
    items.forEach((item, i) => {
      item.rank =
        i > 0 && item.netSoldQuantity === items[i - 1].netSoldQuantity
          ? items[i - 1].rank
          : i + 1;
    });
    return {
      aggregation: aggregation(items.length),
      totals: volume(rows),
      items: items.slice((page - 1) * pageSize, page * pageSize),
      meta: { page, pageSize, total: items.length },
    };
  }
  rows.sort(
    (a, b) =>
      factor *
      (Date.parse(a.basisAt) - Date.parse(b.basisAt) ||
        (a.entryType === b.entryType ? 0 : a.entryType === "승인" ? -1 : 1) ||
        a.id.localeCompare(b.id)),
  );
  return {
    aggregation: aggregation(rows.length),
    totals: totals(rows),
    items: rows.slice((page - 1) * pageSize, page * pageSize),
    meta: {
      page,
      pageSize,
      total: rows.length,
    },
  };
}
function handler(kind: SalesRead) {
  return async ({ request }: { request: Request }) => {
    try {
      const actor = store.activeUser().id;
      if (store.scenario === "slow") await delay(2200);
      assert(
        store.activeUser().id === actor,
        "계정이 변경됐습니다.",
        403,
        "FORBIDDEN",
      );
      assert(
        store.scenario !== "error",
        "서버에 연결하지 못했습니다.",
        503,
        "SERVICE_UNAVAILABLE",
      );
      assert(
        store.scenario !== "forbidden",
        "매출 조회 권한이 없습니다.",
        403,
        "FORBIDDEN",
      );
      return HttpResponse.json(build(request, kind), {
        headers: { "Cache-Control": "no-store" },
      });
    } catch (e) {
      const error =
        e instanceof DomainError
          ? e
          : new DomainError(
              422,
              "VALIDATION_FAILED",
              "조회 조건을 확인해 주세요.",
            );
      return HttpResponse.json(
        {
          code: error.code,
          message: error.message,
          requestId: crypto.randomUUID(),
        },
        { status: error.status },
      );
    }
  };
}
export const salesHandlers = [
  http.get("/api/sales/revenue", handler("revenue")),
  http.get("/api/sales/revenue/branches", handler("branches")),
  http.get("/api/sales/ledger", handler("ledger")),
  http.get("/api/sales/passes/volume", handler("volume")),
  http.get("/api/sales/passes/products", handler("products")),
  http.get("/api/sales/trend", handler("trend")),
];
