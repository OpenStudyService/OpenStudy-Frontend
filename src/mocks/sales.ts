/** Canonical M9 reads over the same demo payments used by the selling screens. */
import { delay } from "msw";
import { http, HttpResponse } from "msw/http";
import { z } from "zod";
import { can } from "../shared/domain/schema";
import { assert, DomainError, store } from "./store";
import { paymentView, salesProductSnapshot } from "./payments";
import { CSV_ROW_LIMIT } from "../features/analysis/export-api";
import {
  salesExportTitles,
  type SalesReport,
} from "../features/analysis/sales-api";
import { mockCsv } from "./export-csv";
import type { components } from "../shared/api/foundation.generated";

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
  "revenue" | "branches" | "ledger" | "volume" | "products" | "trend" | "usage";
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
function build(request: Request, kind: SalesRead, exporting = false) {
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
    kind === "volume" ||
    kind === "products" ||
    kind === "usage" ||
    measure === "passes";
  const methods = z
    .array(z.enum(["현금", "카드", "계좌이체", "기타"]))
    .parse(q.getAll("methods"));
  const productKinds = z
    .array(z.enum(["시간권", "기간권", "정액권"]))
    .parse(q.getAll("productKinds"));
  const operatorIds = q.getAll("operatorIds");
  const processingBranchIds = q.getAll("processingBranchIds");
  for (const values of [
    methods,
    productKinds,
    operatorIds,
    processingBranchIds,
  ])
    invalid(
      values.every(Boolean) && values.length === new Set(values).size,
      "필터를 확인해 주세요.",
    );
  assert(
    processingBranchIds.every(
      (id) =>
        store.db.branches.some((branch) => branch.id === id) && can(actor, id),
    ),
    "지점에 접근할 수 없습니다.",
    403,
    "FORBIDDEN",
  );
  const passOnly = productKinds.length > 0 || q.has("categoryCode");
  const requestedPurpose = q.has("purpose")
    ? z.enum(purposes).parse(q.get("purpose"))
    : null;
  const purpose = passes || passOnly ? "이용권" : requestedPurpose;
  invalid(
    passes
      ? !q.has("purpose")
      : !q.has("productId") &&
          (!passOnly || !requestedPurpose || requestedPurpose === "이용권"),
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
  if (kind !== "usage" && store.scenario !== "empty")
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
      if (
        productKinds.length &&
        (!snapshot || !productKinds.includes(snapshot.kind))
      )
        continue;
      const payment = paymentView(actor, row);
      if (methods.length && !methods.includes(payment.method)) continue;
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
      if (
        (!entryType || entryType === "승인") &&
        within(approvedAt) &&
        (!operatorIds.length || operatorIds.includes(payment.createdBy.id))
      )
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
        (!operatorIds.length ||
          (!!payment.refund &&
            operatorIds.includes(payment.refund.processedBy.id))) &&
        (!processingBranchIds.length ||
          processingBranchIds.includes(
            refund?.processingBranchId ?? row.refundBranchId,
          )) &&
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
      methods,
      productKinds,
      operatorIds,
      processingBranchIds,
      granularity,
    },
    conditionNotes: [
      ...(passOnly
        ? [{ code: "PASS_ONLY", message: "이용권 결제만 집계했다" }]
        : []),
      ...(processingBranchIds.length
        ? [
            {
              code: "REFUND_PROCESSING_BRANCH",
              message:
                "환불은 처리 지점 조건에 맞는 것만, 승인은 조건과 무관하다",
            },
          ]
        : []),
      ...(operatorIds.length
        ? [
            {
              code: "OPERATOR_BY_ENTRY",
              message: "승인은 결제 처리자, 환불은 환불 처리자로 골랐다",
            },
          ]
        : []),
      ...(methods.length
        ? [
            {
              code: "REFUND_BY_PAYMENT_METHOD",
              message: "환불은 원결제 수단으로 나눴다",
            },
          ]
        : []),
    ],
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
  if (kind === "usage") {
    type Schemas = components["schemas"];
    type Amounts = Schemas["PassUsageAmounts"];
    const empty = (): Amounts => ({
      sessionCount: 0,
      usedMinutes: 0,
      usedCreditKrw: 0,
    });
    const add = (a: Amounts, b: Amounts) => {
      a.sessionCount += b.sessionCount;
      a.usedMinutes += b.usedMinutes;
      a.usedCreditKrw += b.usedCreditKrw;
      return a;
    };
    const groups = new Map<string, Map<string | null, Amounts>>();
    const total = empty();
    let sourceRowCount = 0;
    for (const use of store.scenario === "empty" ? [] : store.db.usage) {
      if (!branchIds.includes(use.branchId)) continue;
      const pass = store.db.passes.find((p) => p.id === use.passId);
      if (!pass || (productKinds.length && !productKinds.includes(pass.kind)))
        continue;
      const payment = store.db.payments.find((p) => p.id === pass.paymentId);
      if (productId && payment?.productId !== productId) continue;
      if (
        categoryCode &&
        (!payment ||
          salesProductSnapshot(payment).categoryCode !== categoryCode)
      )
        continue;
      const started = within(use.startedAt);
      const charged =
        !!use.endedAt && within(use.endedAt) && pass.kind !== "기간권";
      if (!started && !charged) continue;
      sourceRowCount += Number(started) + Number(charged);
      const cell = {
        sessionCount: Number(started),
        usedMinutes: charged && pass.kind === "시간권" ? use.charged : 0,
        usedCreditKrw: charged && pass.kind === "정액권" ? use.charged : 0,
      };
      const saleBranch = can(actor, pass.branchId, "sales:read")
        ? pass.branchId
        : null;
      const usage =
        groups.get(use.branchId) ?? new Map<string | null, Amounts>();
      usage.set(saleBranch, add(usage.get(saleBranch) ?? empty(), cell));
      groups.set(use.branchId, usage);
      add(total, cell);
    }
    const items = [...groups]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([branchId, group]) => {
        const bySaleBranch = [...group]
          .sort(([a], [b]) => (a ?? "").localeCompare(b ?? ""))
          .map(([saleBranchId, amounts]) => ({
            ...amounts,
            saleBranchId,
            visible: saleBranchId !== null,
            label: saleBranchId === null ? "다른 지점" : null,
          }));
        return { branchId, bySaleBranch, ...bySaleBranch.reduce(add, empty()) };
      });
    const base = aggregation(items.length);
    return {
      items,
      totals: total,
      aggregation: {
        ...base,
        condition: { ...base.condition, refundBasis: null },
        sourceRowCount,
        dataStatus: sourceRowCount ? "hasData" : "noData",
        metrics: [
          { id: "pass.usage_session_count", unit: "건" },
          { id: "pass.usage_minutes", unit: "분" },
          { id: "pass.usage_credit_krw", unit: "원" },
        ],
        conditionNotes: [
          ...base.conditionNotes,
          {
            code: "USAGE_NOT_REVENUE",
            message:
              "이용권 사용량이며 매출이 아닙니다. 매출은 판매 지점에 귀속됩니다.",
          },
        ],
      },
    };
  }
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
    pageSize = exporting
      ? CSV_ROW_LIMIT
      : z.coerce
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
const reportReads: Record<SalesReport, SalesRead> = {
  revenue: "revenue",
  "revenue-branches": "branches",
  ledger: "ledger",
  trend: "trend",
  "passes-volume": "volume",
  "passes-products": "products",
  "passes-usage": "usage",
};

const amountColumns = [
  "승인 금액(원)",
  "환불 금액(원)",
  "순매출(원)",
  "승인 결제 수(건)",
  "환불 수(건)",
  "데이터 상태",
];
const volumeColumns = [
  "결제 수(건)",
  "판매 수량(개)",
  "환불 수량(개)",
  "순판매 수량(개)",
  "발급 수(개)",
  "데이터 상태",
];
const amountCells = (v: ReturnType<typeof totals>) => [
  v.approvedAmountKrw,
  v.refundAmountKrw,
  v.netAmountKrw,
  v.approvedPaymentCount,
  v.refundCount,
  v.dataStatus,
];
const volumeCells = (v: ReturnType<typeof volume>) => [
  v.paymentCount,
  v.soldQuantity,
  v.refundedQuantity,
  v.netSoldQuantity,
  v.issuedCount,
  v.dataStatus,
];
const branchName = (id: string) =>
  store.db.branches.find((branch) => branch.id === id)?.name ?? id;

function salesCsvData(
  data: ReturnType<typeof build>,
  report: SalesReport,
): { columns: string[]; rows: unknown[][]; money: boolean; total?: number } {
  if (data.byPurpose)
    return {
      columns: ["용도", ...amountColumns],
      rows: data.byPurpose.map((v) => [v.purpose, ...amountCells(v)]),
      money: true,
    };
  if (data.measure)
    return {
      columns: [
        "구간",
        ...(data.measure === "passes" ? volumeColumns : amountColumns),
      ],
      rows: data.items.map((v) => [
        v.label,
        ...(v.passes ? volumeCells(v.passes) : amountCells(v.revenue!)),
      ]),
      money: data.measure === "revenue",
    };
  if (!data.items && "soldQuantity" in data.totals)
    return {
      columns: ["구분", ...volumeColumns],
      rows: [["합계", ...volumeCells(data.totals)]],
      money: false,
    };

  const items = data.items ?? [];
  if (report === "passes-usage")
    return {
      columns: [
        "사용 지점",
        "판매 지점",
        "이용 횟수(건)",
        "이용 시간(분)",
        "정액권 사용 금액(원)",
      ],
      rows: items.flatMap((v) =>
        "bySaleBranch" in v
          ? v.bySaleBranch.map((sale) => [
              branchName(v.branchId),
              sale.saleBranchId ? branchName(sale.saleBranchId) : sale.label,
              sale.sessionCount,
              sale.usedMinutes,
              sale.usedCreditKrw,
            ])
          : [],
      ),
      money: false,
    };
  if (data.meta && "soldQuantity" in data.totals)
    return {
      columns: ["순위", "상품", "분류", "종류", ...volumeColumns],
      rows: items.flatMap((v) =>
        "rank" in v
          ? [[v.rank, v.productName, v.categoryName, v.kind, ...volumeCells(v)]]
          : [],
      ),
      money: false,
      total: data.meta.total,
    };
  if (data.meta)
    return {
      columns: [
        "구분",
        "기준 시각",
        "지점",
        "처리 지점 ID",
        "용도",
        "상품",
        "분류",
        "수량(개)",
        "금액(원)",
        "결제 ID",
        "환불 ID",
      ],
      rows: items.flatMap((v) =>
        "entryType" in v
          ? [
              [
                v.entryType,
                v.basisAt,
                branchName(v.branchId),
                v.processingBranchId,
                v.purpose,
                v.productName,
                v.categoryName,
                v.passQuantity,
                v.amountKrw,
                v.paymentId,
                v.refundId,
              ],
            ]
          : [],
      ),
      money: true,
      total: data.meta.total,
    };
  return {
    columns: ["지점", ...amountColumns],
    rows: items.flatMap((v) =>
      "branchName" in v ? [[v.branchName, ...amountCells(v)]] : [],
    ),
    money: true,
  };
}

function exportReport(request: Request, report: string) {
  assert(
    Object.hasOwn(reportReads, report),
    "내보낼 수 없는 보고서입니다.",
    404,
    "EXPORT_REPORT_UNKNOWN",
  );
  const key = report as SalesReport;
  const query = new URL(request.url).searchParams;
  invalid(
    !query.has("page") && !query.has("pageSize"),
    "내보내기는 페이지 없이 전체 결과를 담습니다.",
  );
  const data = build(request, reportReads[key], true);
  const { condition, conditionNotes, asOf } = data.aggregation;
  const { branchIds, from, to } = condition;
  return mockCsv({
    title: salesExportTitles[key],
    conditions: [
      `기간 ${from} ~ ${to} (Asia/Seoul)`,
      `지점 ${branchIds.map(branchName).join(", ")}`,
      ...conditionNotes.map(({ message }) => message),
    ].join(" · "),
    asOf,
    ...salesCsvData(data, key),
  });
}

function handler(kind: SalesRead | "export") {
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
      if (kind === "export") {
        const report = new URL(request.url).pathname.split("/").at(-1)!;
        return exportReport(request, report);
      }
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
  http.get("/api/sales/exports/:report", handler("export")),
  http.get("/api/sales/revenue", handler("revenue")),
  http.get("/api/sales/revenue/branches", handler("branches")),
  http.get("/api/sales/ledger", handler("ledger")),
  http.get("/api/sales/passes/volume", handler("volume")),
  http.get("/api/sales/passes/usage", handler("usage")),
  http.get("/api/sales/passes/products", handler("products")),
  http.get("/api/sales/trend", handler("trend")),
];
