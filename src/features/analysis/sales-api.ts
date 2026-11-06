import { z } from "zod";
import { api, ApiError, MOCK } from "../../shared/api/client";
import type { components } from "../../shared/api/foundation.generated";

export type SalesPurpose = "이용권" | "스터디룸" | "사물함";
export type RefundBasis = "processedDate" | "paymentDate";
export type BranchSort =
  "netAmount" | "approvedAmount" | "refundAmount" | "branchId" | "requested";
export interface SalesCondition {
  branchIds?: string[];
  from?: string;
  to?: string;
  refundBasis?: RefundBasis;
  purpose?: SalesPurpose;
}
const id = MOCK ? z.string().min(1) : z.string().regex(/^[1-9][0-9]{0,19}$/);
const integer = z
  .number()
  .int()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
const count = integer.nonnegative();
const instant = z
  .string()
  .refine(
    (v) => /(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v)),
  );
const purpose = z.enum(["이용권", "스터디룸", "사물함"]);
const dataStatus = z.enum(["hasData", "noData"]);
const amountFields = {
  approvedAmountKrw: count,
  refundAmountKrw: count,
  netAmountKrw: integer,
  approvedPaymentCount: count,
  refundCount: count,
  dataStatus,
};
function amountsValid(v: z.infer<typeof amountsSchema>): boolean {
  return (
    BigInt(v.approvedAmountKrw) - BigInt(v.refundAmountKrw) ===
      BigInt(v.netAmountKrw) &&
    (v.dataStatus === "noData") ===
      (v.approvedPaymentCount === 0 && v.refundCount === 0) &&
    (v.approvedPaymentCount !== 0 || v.approvedAmountKrw === 0) &&
    (v.refundCount !== 0 || v.refundAmountKrw === 0)
  );
}
const amountsSchema = z.strictObject(amountFields);
const amounts = amountsSchema.refine(amountsValid);
const purposeAmounts = z
  .strictObject({ purpose, ...amountFields })
  .refine(amountsValid);
const conditionSchema = z
  .strictObject({
    branchIds: z.array(id).min(1),
    allBranches: z.boolean(),
    from: instant,
    to: instant,
    refundBasis: z.enum(["processedDate", "paymentDate"]),
    purpose: purpose.nullable(),
    productId: z.null(),
    categoryCode: z.null(),
    granularity: z.null(),
  })
  .refine(
    (v) =>
      new Set(v.branchIds).size === v.branchIds.length &&
      Date.parse(v.from) < Date.parse(v.to) &&
      Date.parse(v.to) - Date.parse(v.from) <= 366 * 86400000,
  );
const aggregationSchema = z
  .strictObject({
    condition: conditionSchema,
    defaultPeriod: z.boolean(),
    timeZone: z.literal("Asia/Seoul"),
    currency: z.literal("KRW"),
    asOf: instant,
    rowCount: count,
    sourceRowCount: count,
    dataStatus,
    partial: z.strictObject({
      periodOpen: z.boolean(),
      firstBucketPartial: z.null(),
      lastBucketPartial: z.null(),
    }),
    metrics: z
      .array(
        z.strictObject({
          id: z.string().regex(/^[a-z]+(\.[a-z_]+)+$/),
          unit: z.enum(["원", "건", "개", "%"]),
        }),
      )
      .min(1),
  })
  .refine((v) => {
    const expected = new Map<string, string>([
      ["sales.approved_amount", "원"],
      ["sales.refund_amount", "원"],
      ["sales.net_amount", "원"],
      ["sales.approved_payment_count", "건"],
      ["sales.refund_count", "건"],
    ]);
    const day = new Date(Date.parse(v.asOf) + 9 * 3600000)
      .toISOString()
      .slice(0, 10);
    const defaultFrom = Date.parse(`${day.slice(0, 7)}-01T00:00:00+09:00`);
    const defaultTo = Date.parse(`${day}T00:00:00+09:00`) + 86400000;
    return (
      (v.dataStatus === "noData") === (v.sourceRowCount === 0) &&
      v.metrics.length === expected.size &&
      new Set(v.metrics.map((m) => m.id)).size === expected.size &&
      v.metrics.every((m) => expected.get(m.id) === m.unit) &&
      v.partial.periodOpen ===
        Date.parse(v.condition.to) > Date.parse(v.asOf) &&
      (!v.defaultPeriod ||
        (Date.parse(v.condition.from) === defaultFrom &&
          Date.parse(v.condition.to) === defaultTo))
    );
  });
export type RevenueAmounts = components["schemas"]["RevenueAmounts"];
// OpenAPI 3.0 nullable allOf IDs are generated as string by the current tool.
// Infer the boundary DTOs from validators so explicit wire nulls are retained;
// never fill absent product/payment references using cached or demo values.
export type AggregationMeta = z.infer<typeof aggregationSchema>;
const amountKeys = [
  "approvedAmountKrw",
  "refundAmountKrw",
  "netAmountKrw",
  "approvedPaymentCount",
  "refundCount",
] as const;
function sumsEqual(total: RevenueAmounts, rows: RevenueAmounts[]) {
  return amountKeys.every(
    (k) =>
      rows.reduce((sum, row) => sum + BigInt(row[k]), 0n) === BigInt(total[k]),
  );
}
function purposesValid(
  total: RevenueAmounts,
  rows: z.infer<typeof purposeAmounts>[],
  filter: SalesPurpose | null,
) {
  const expected = filter ? [filter] : ["이용권", "스터디룸", "사물함"];
  return (
    rows.length === expected.length &&
    rows.every((row, i) => row.purpose === expected[i]) &&
    sumsEqual(total, rows)
  );
}
function metaTotalsValid(aggregation: AggregationMeta, totals: RevenueAmounts) {
  return (
    aggregation.dataStatus === totals.dataStatus &&
    BigInt(aggregation.sourceRowCount) ===
      BigInt(totals.approvedPaymentCount) + BigInt(totals.refundCount)
  );
}
const revenueSchema = z
  .strictObject({
    aggregation: aggregationSchema,
    totals: amounts,
    byPurpose: z.array(purposeAmounts),
  })
  .refine(
    (v) =>
      metaTotalsValid(v.aggregation, v.totals) &&
      v.aggregation.rowCount === v.byPurpose.length &&
      purposesValid(v.totals, v.byPurpose, v.aggregation.condition.purpose),
  );
const branchSchema = z
  .strictObject({
    branchId: id,
    branchName: z.string(),
    ...amountFields,
    byPurpose: z.array(purposeAmounts),
  })
  .refine(amountsValid);
const branchesSchema = z
  .strictObject({
    aggregation: aggregationSchema,
    totals: amounts,
    items: z.array(branchSchema),
  })
  .refine(
    (v) =>
      metaTotalsValid(v.aggregation, v.totals) &&
      v.aggregation.rowCount === v.items.length &&
      v.items.length === v.aggregation.condition.branchIds.length &&
      new Set(v.items.map((x) => x.branchId)).size === v.items.length &&
      v.items.every(
        (x) =>
          v.aggregation.condition.branchIds.includes(x.branchId) &&
          purposesValid(x, x.byPurpose, v.aggregation.condition.purpose),
      ) &&
      sumsEqual(v.totals, v.items),
  );
const entrySchema = z
  .strictObject({
    id: z.string().min(1),
    entryType: z.enum(["승인", "환불"]),
    paymentId: id,
    refundId: id.nullable(),
    branchId: id,
    processingBranchId: id.nullable(),
    purpose,
    productId: id.nullable(),
    productName: z.string().nullable(),
    categoryCode: z.string().nullable(),
    categoryName: z.string().nullable(),
    passQuantity: z.number().int().min(-1).max(1),
    amountKrw: integer,
    approvedAt: instant,
    refundedAt: instant.nullable(),
    basisAt: instant,
    canViewPayment: z.boolean(),
  })
  .refine((v) =>
    v.entryType === "승인"
      ? v.amountKrw >= 0 &&
        v.refundId === null &&
        v.refundedAt === null &&
        v.processingBranchId === null &&
        v.id === `payment-${v.paymentId}` &&
        v.passQuantity === (v.purpose === "이용권" ? 1 : 0)
      : v.amountKrw <= 0 &&
        v.refundId !== null &&
        v.refundedAt !== null &&
        v.processingBranchId !== null &&
        v.id === `refund-${v.refundId}` &&
        v.passQuantity === (v.purpose === "이용권" ? -1 : 0),
  );
const ledgerSchema = z
  .strictObject({
    aggregation: aggregationSchema,
    totals: amounts,
    items: z.array(entrySchema),
    meta: z.strictObject({
      page: count.min(1),
      pageSize: count.min(1).max(100),
      total: count,
    }),
  })
  .refine(
    (v) =>
      metaTotalsValid(v.aggregation, v.totals) &&
      v.meta.total === v.aggregation.sourceRowCount &&
      v.meta.total === v.aggregation.rowCount &&
      v.items.length ===
        Math.min(
          v.meta.pageSize,
          Math.max(0, v.meta.total - (v.meta.page - 1) * v.meta.pageSize),
        ) &&
      new Set(v.items.map((x) => x.id)).size === v.items.length &&
      (v.meta.page !== 1 ||
        v.meta.total > v.meta.pageSize ||
        (v.items.reduce((sum, x) => sum + BigInt(x.amountKrw), 0n) ===
          BigInt(v.totals.netAmountKrw) &&
          v.items
            .filter((x) => x.entryType === "승인")
            .reduce((sum, x) => sum + BigInt(x.amountKrw), 0n) ===
            BigInt(v.totals.approvedAmountKrw) &&
          v.items.filter((x) => x.entryType === "승인").length ===
            v.totals.approvedPaymentCount &&
          v.items.filter((x) => x.entryType === "환불").length ===
            v.totals.refundCount)) &&
      v.items.every((x) => {
        const c = v.aggregation.condition;
        const at = Date.parse(x.basisAt);
        return (
          c.branchIds.includes(x.branchId) &&
          (!c.purpose || x.purpose === c.purpose) &&
          at >= Date.parse(c.from) &&
          at < Date.parse(c.to) &&
          x.basisAt ===
            (x.entryType === "환불" && c.refundBasis === "processedDate"
              ? x.refundedAt
              : x.approvedAt)
        );
      }),
  );
export type RevenueSummary = z.infer<typeof revenueSchema>;
export type BranchRevenueComparison = z.infer<typeof branchesSchema>;
export type SalesLedgerPage = z.infer<typeof ledgerSchema>;
export type SalesLedgerEntry = z.infer<typeof entrySchema>;

export function validateSalesCondition(condition: SalesCondition): void {
  if (
    condition.branchIds &&
    (!condition.branchIds.length ||
      new Set(condition.branchIds).size !== condition.branchIds.length ||
      condition.branchIds.some((v) => !id.safeParse(v).success))
  )
    throw new Error("조회할 지점을 확인해 주세요.");
  if ((condition.from === undefined) !== (condition.to === undefined))
    throw new Error("시작일과 종료일을 함께 입력해 주세요.");
  if (condition.from !== undefined && condition.to !== undefined) {
    if (
      !instant.safeParse(condition.from).success ||
      !instant.safeParse(condition.to).success ||
      Date.parse(condition.from) >= Date.parse(condition.to)
    )
      throw new Error("시작일보다 뒤인 종료일을 입력해 주세요.");
    if (Date.parse(condition.to) - Date.parse(condition.from) > 366 * 86400000)
      throw new Error("조회 기간은 최대 366일이에요.");
  }
  if (
    condition.purpose !== undefined &&
    !purpose.safeParse(condition.purpose).success
  )
    throw new Error("용도를 확인해 주세요.");
  if (
    condition.refundBasis !== undefined &&
    !["processedDate", "paymentDate"].includes(condition.refundBasis)
  )
    throw new Error("환불 기준을 확인해 주세요.");
}
export function salesPeriod(
  fromDate: string,
  toDate: string,
): Pick<SalesCondition, "from" | "to"> {
  if (!fromDate && !toDate) return {};
  const date = (v: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v))
      throw new Error("올바른 날짜를 입력해 주세요.");
    const at = new Date(`${v}T00:00:00+09:00`);
    if (
      !Number.isFinite(at.getTime()) ||
      new Date(at.getTime() + 9 * 3600000).toISOString().slice(0, 10) !== v
    )
      throw new Error("올바른 날짜를 입력해 주세요.");
    return at.toISOString();
  };
  if (!fromDate || !toDate)
    throw new Error("시작일과 종료일을 함께 입력해 주세요.");
  const result = { from: date(fromDate), to: date(toDate) };
  validateSalesCondition(result);
  return result;
}
function params(
  condition: SalesCondition,
  options: Record<string, string | number | undefined> = {},
) {
  validateSalesCondition(condition);
  const result = new URLSearchParams();
  condition.branchIds?.forEach((v) => result.append("branchIds", v));
  for (const [key, value] of Object.entries({
    from: condition.from,
    to: condition.to,
    refundBasis: condition.refundBasis,
    purpose: condition.purpose,
    ...options,
  }))
    if (value !== undefined) result.set(key, String(value));
  return result.toString();
}
function parse<T>(
  schema: z.ZodType<T>,
  value: unknown,
  condition: SalesCondition,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new ApiError(0, {
      code: "INVALID_RESPONSE",
      message: "매출 응답을 확인할 수 없어요. 다시 조회해 주세요.",
    });
  const c = (parsed.data as { aggregation: AggregationMeta }).aggregation
    .condition;
  const matches =
    (parsed.data as { aggregation: AggregationMeta }).aggregation
      .defaultPeriod ===
      (condition.from === undefined) &&
    (!condition.from || Date.parse(c.from) === Date.parse(condition.from)) &&
    (!condition.to || Date.parse(c.to) === Date.parse(condition.to)) &&
    c.refundBasis === (condition.refundBasis ?? "processedDate") &&
    c.purpose === (condition.purpose ?? null) &&
    c.allBranches === (condition.branchIds === undefined) &&
    (!condition.branchIds ||
      (condition.branchIds.length === c.branchIds.length &&
        condition.branchIds.every((v) => c.branchIds.includes(v))));
  if (!matches)
    throw new ApiError(0, {
      code: "INVALID_RESPONSE",
      message: "조회 조건과 매출 응답이 달라요. 다시 조회해 주세요.",
    });
  return parsed.data;
}
export const salesApi = {
  async revenue(
    condition: SalesCondition,
    signal?: AbortSignal,
  ): Promise<RevenueSummary> {
    return parse(
      revenueSchema,
      await api(`/sales/revenue?${params(condition)}`, { signal }),
      condition,
    );
  },
  async branches(
    condition: SalesCondition,
    options: { sort?: BranchSort; direction?: "asc" | "desc" } = {},
    signal?: AbortSignal,
  ): Promise<BranchRevenueComparison> {
    return parse(
      branchesSchema,
      await api(`/sales/revenue/branches?${params(condition, options)}`, {
        signal,
      }),
      condition,
    );
  },
  async ledger(
    condition: SalesCondition,
    options: {
      page?: number;
      pageSize?: number;
      entryType?: "승인" | "환불";
      direction?: "asc" | "desc";
    } = {},
    signal?: AbortSignal,
  ): Promise<SalesLedgerPage> {
    const result = parse(
      ledgerSchema,
      await api(`/sales/ledger?${params(condition, options)}`, { signal }),
      condition,
    );
    if (
      result.meta.page !== (options.page ?? 1) ||
      result.meta.pageSize !== (options.pageSize ?? 20) ||
      (options.entryType &&
        (result.items.some((v) => v.entryType !== options.entryType) ||
          (options.entryType === "승인" &&
            (result.totals.refundCount !== 0 ||
              result.totals.refundAmountKrw !== 0)) ||
          (options.entryType === "환불" &&
            (result.totals.approvedPaymentCount !== 0 ||
              result.totals.approvedAmountKrw !== 0))))
    )
      throw new ApiError(0, {
        code: "INVALID_RESPONSE",
        message: "원장 페이지 조건을 확인할 수 없어요.",
      });
    return result;
  },
};
