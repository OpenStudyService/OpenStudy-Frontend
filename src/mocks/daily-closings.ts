import { http } from "msw/http";
import { z } from "zod";
import type { components } from "../shared/api/foundation.generated";
import { formatBusinessDate } from "../shared/domain/format";
import { admin, can, type Employee } from "../shared/domain/schema";
import { paymentResponse, paymentView } from "./payments";
import { assert, DomainError, store } from "./store";

type S = components["schemas"];
type Closing = S["DailyClosing"];
type Payment = S["Payment"];
type Amounts = S["ClosingAmounts"];
const keys = [
  "approvedAmountKrw",
  "refundAmountKrw",
  "netAmountKrw",
  "approvedPaymentCount",
  "refundCount",
] as const;
const records = new WeakMap<typeof store.events, Map<string, Closing>>();
const requests = new WeakMap<
  typeof store.events,
  Map<string, { input: string; result: Closing }>
>();
function getMap<T>(ledger: WeakMap<typeof store.events, Map<string, T>>) {
  const existing = ledger.get(store.events);
  if (existing) return existing;
  const value = new Map<string, T>();
  ledger.set(store.events, value);
  return value;
}

function payments(actor: Employee, branchId: string) {
  return (store.scenario === "empty" ? [] : store.db.payments)
    .filter(
      (p) => p.branchId === branchId && p.approvedAt && p.status !== "실패",
    )
    .map((p) => paymentView(actor, p));
}

function snapshot(
  rows: Payment[],
  date: string,
  basis: "processedDate" | "paymentDate",
): S["ClosingBasisSnapshot"] {
  function calculate(items: Payment[]): Amounts {
    const approved = items.filter(
      (p) => formatBusinessDate(p.approvedAt) === date,
    );
    const refunded = items.flatMap((p) =>
      p.refund &&
      formatBusinessDate(
        basis === "paymentDate" ? p.approvedAt : p.refund.refundedAt,
      ) === date
        ? [p.refund]
        : [],
    );
    const approvedAmountKrw = approved.reduce((sum, p) => sum + p.amountKrw, 0);
    const refundAmountKrw = refunded.reduce((sum, p) => sum + p.amountKrw, 0);
    return {
      approvedAmountKrw,
      refundAmountKrw,
      netAmountKrw: approvedAmountKrw - refundAmountKrw,
      approvedPaymentCount: approved.length,
      refundCount: refunded.length,
    };
  }
  const purposes = ["이용권", "스터디룸", "사물함"] as const;
  const methods = ["현금", "카드", "계좌이체", "기타"] as const;
  return {
    totals: calculate(rows),
    byPurpose: purposes.map((purpose) => ({
      purpose,
      ...calculate(rows.filter((p) => p.purpose === purpose)),
    })),
    byMethod: methods.map((method) => ({
      method,
      ...calculate(rows.filter((p) => p.method === method)),
    })),
  };
}

function details(actor: Employee, closing: Closing): Closing {
  const rows = payments(actor, closing.branchId);
  const paymentDate = snapshot(
    rows,
    closing.businessDate,
    "paymentDate",
  ).totals;
  const saved = closing.snapshot.paymentDate.totals;
  const difference = { ...paymentDate };
  for (const key of keys) difference[key] -= saved[key];
  const adjustments = rows
    .flatMap((p) => {
      if (
        !p.refund ||
        formatBusinessDate(p.approvedAt) !== closing.businessDate ||
        Date.parse(p.refund.refundedAt) <= Date.parse(closing.closedAt)
      )
        return [];
      return [
        {
          id: `adjustment-${p.refund.id}`,
          refundId: p.refund.id,
          paymentId: p.id,
          amountKrw: -p.refund.amountKrw,
          processedAt: p.refund.refundedAt,
          processedBy: p.refund.processedBy,
          reason: can(actor, closing.branchId, "payments:read")
            ? p.refund.reason
            : null,
        },
      ];
    })
    .sort((a, b) => a.processedAt.localeCompare(b.processedAt));
  return {
    ...closing,
    current: { paymentDate, asOf: store.now() },
    difference,
    adjustments,
  };
}

export const dailyClosingHandlers = [
  http.get(
    "/api/daily-closings",
    paymentResponse(({ request }, actor): S["DailyClosingPage"] => {
      const q = new URL(request.url).searchParams;
      const requested = q.getAll("branchIds");
      const visible = store.db.branches
        .filter((b) => can(actor, b.id, "sales:read"))
        .map((b) => b.id);
      assert(
        new Set(requested).size === requested.length,
        "지점 조건을 확인해 주세요.",
        422,
        "VALIDATION_FAILED",
      );
      assert(
        requested.every((id) => visible.includes(id)),
        "매출 조회 권한이 없습니다.",
        403,
        "FORBIDDEN",
      );
      const branchIds = requested.length ? requested : visible;
      const now = formatBusinessDate(store.now());
      const from = q.get("from"),
        to = q.get("to");
      assert(
        (from === null) === (to === null),
        "조회 기간을 확인해 주세요.",
        422,
        "VALIDATION_FAILED",
      );
      const defaultFrom = formatBusinessDate(
        new Date(
          Date.UTC(Number(now.slice(0, 4)), Number(now.slice(5, 7)) - 2, 1),
        ).toISOString(),
      );
      const lower = from === null ? defaultFrom : z.iso.date().parse(from);
      const upper = to === null ? now : z.iso.date().parse(to);
      assert(
        lower <= upper,
        "조회 기간을 확인해 주세요.",
        422,
        "VALIDATION_FAILED",
      );
      assert(
        Date.parse(upper) - Date.parse(lower) <= 366 * 86_400_000,
        "조회 기간이 너무 깁니다.",
        422,
        "PERIOD_TOO_LONG",
      );
      const page = z.coerce
        .number()
        .int()
        .positive()
        .parse(q.get("page") ?? 1);
      const pageSize = z.coerce
        .number()
        .int()
        .min(1)
        .max(100)
        .parse(q.get("pageSize") ?? 20);
      const all = [...getMap(records).values()]
        .filter(
          (c) =>
            branchIds.includes(c.branchId) &&
            lower <= c.businessDate &&
            c.businessDate <= upper,
        )
        .sort(
          (a, b) =>
            b.businessDate.localeCompare(a.businessDate) ||
            a.branchId.localeCompare(b.branchId),
        );
      return {
        items: all.slice((page - 1) * pageSize, page * pageSize).map((c) => ({
          id: c.id,
          branchId: c.branchId,
          businessDate: c.businessDate,
          closedAt: c.closedAt,
          closedBy: c.closedBy,
          processedDate: c.snapshot.processedDate.totals,
          adjustmentCount: details(actor, c).adjustments.length,
        })),
        meta: { page, pageSize, total: all.length },
      };
    }),
  ),
  http.get(
    "/api/daily-closings/:id",
    paymentResponse(({ params }, actor) => {
      const closing = getMap(records).get(String(params.id));
      assert(
        closing && can(actor, closing.branchId),
        "마감 기록이 없습니다.",
        404,
        "NOT_FOUND",
      );
      assert(
        can(actor, closing.branchId, "sales:read"),
        "매출 조회 권한이 없습니다.",
        403,
        "FORBIDDEN",
      );
      return details(actor, closing);
    }),
  ),
  http.post(
    "/api/daily-closings",
    paymentResponse(async ({ request }, actor): Promise<Closing> => {
      const input = z
        .strictObject({
          branchId: z.string().min(1),
          businessDate: z.iso.date(),
          note: z.string().min(1).max(500).optional(),
        })
        .parse(await request.json());
      const { branchId, businessDate, note } = input;
      assert(
        store.db.branches.some((b) => b.id === branchId) &&
          can(actor, branchId),
        "지점이 없습니다.",
        404,
        "NOT_FOUND",
      );
      assert(
        admin(actor, branchId) && can(actor, branchId, "sales:read"),
        "마감 권한이 없습니다.",
        403,
        "FORBIDDEN",
      );
      const key = z
        .string()
        .min(1)
        .parse(request.headers.get("Idempotency-Key"));
      const requestKey = JSON.stringify([actor.id, key]);
      const fingerprint = JSON.stringify(input);
      const prior = getMap(requests).get(requestKey);
      if (prior) {
        assert(
          prior.input === fingerprint,
          "요청이 충돌했습니다.",
          409,
          "IDEMPOTENCY_CONFLICT",
        );
        return prior.result;
      }
      const closedAt = store.now();
      if (businessDate >= formatBusinessDate(closedAt))
        throw new DomainError(
          422,
          "CLOSING_DATE_OPEN",
          "지난 날짜를 선택해 주세요.",
          { businessDate: "지난 날짜를 선택해 주세요." },
        );
      const existing = [...getMap(records).values()].find(
        (c) => c.branchId === branchId && c.businessDate === businessDate,
      );
      if (existing)
        throw new DomainError(
          409,
          "CLOSING_EXISTS",
          "이미 마감된 날짜입니다.",
          undefined,
          undefined,
          undefined,
          { closingId: existing.id },
        );
      const rows = payments(actor, branchId);
      const processedDate = snapshot(rows, businessDate, "processedDate");
      const paymentDate = snapshot(rows, businessDate, "paymentDate");
      const result: Closing = {
        id: crypto.randomUUID(),
        branchId,
        businessDate,
        note: note ?? null,
        closedAt,
        closedBy: { id: actor.id, name: actor.name },
        snapshot: { processedDate, paymentDate },
        current: { paymentDate: paymentDate.totals, asOf: closedAt },
        difference: {
          approvedAmountKrw: 0,
          refundAmountKrw: 0,
          netAmountKrw: 0,
          approvedPaymentCount: 0,
          refundCount: 0,
        },
        adjustments: [],
        timeZone: "Asia/Seoul",
        currency: "KRW",
      };
      getMap(records).set(result.id, result);
      getMap(requests).set(requestKey, { input: fingerprint, result });
      return result;
    }, 201),
  ),
];
