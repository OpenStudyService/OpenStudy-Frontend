import { z } from "zod";
import { api, ApiError, queryString } from "../../shared/api/client";
import type { CustomerHistory, PassAdjustment, SessionFilters } from "./model";
import type { Pass } from "../payments/model";

const id = z.string().min(1);
const integer = z
  .number()
  .int()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
const count = integer.nonnegative();
const instant = z.string().refine((v) => Number.isFinite(Date.parse(v)));
const actor = z.object({ id, name: z.string() });
const kind = z.enum(["시간권", "정액권", "기간권"]);
const status = z.enum(["활성", "소진", "만료", "환불"]);
const historySchema = z.object({
  customer: z.object({ id, memberNo: id, name: z.string() }),
  from: instant.nullable(),
  to: instant.nullable(),
  events: z.array(
    z.object({
      at: instant,
      type: z.enum(["구매", "환불", "이용", "조정"]),
      passId: id,
      productName: z.string(),
      deltaMinutes: integer,
      deltaKrw: integer,
      usedMinutes: count.nullable(),
      branchId: id,
      paymentId: id.nullable(),
      seatSessionId: id.nullable(),
      reason: z.string().nullable(),
      actor: actor.nullable(),
    }),
  ),
  passes: z.array(
    z.object({
      passId: id,
      kind,
      productName: z.string(),
      status,
      purchaseBranchId: id,
      issuedMinutes: count.nullable(),
      issuedCreditKrw: count.nullable(),
      ledgerMinutes: integer,
      ledgerKrw: integer,
      remainingMinutes: count.nullable(),
      remainingCreditKrw: count.nullable(),
    }),
  ),
});
function invalid(): never {
  throw new ApiError(0, {
    code: "INVALID_RESPONSE",
    message: "이용권 응답을 확인하지 못했어요. 다시 조회해 주세요.",
  });
}

export async function getCustomerHistory(
  customerId: string,
  scope: string,
  range: { from?: string; to?: string },
  signal?: AbortSignal,
): Promise<CustomerHistory> {
  const raw = await api<unknown>(
    `/customers/${encodeURIComponent(customerId)}/pass-history?${queryString({ scope, ...range })}`,
    { signal },
  );
  const parsed = historySchema.safeParse(raw);
  if (!parsed.success) return invalid();
  const result = parsed.data;
  if (
    result.customer.id !== customerId ||
    result.passes.some((p) => scope !== "all" && p.purchaseBranchId !== scope)
  )
    return invalid();
  if (
    result.events.some(
      (e) =>
        !result.passes.some((p) => p.passId === e.passId) ||
        (range.from && Date.parse(e.at) < Date.parse(range.from)) ||
        (range.to && Date.parse(e.at) >= Date.parse(range.to)),
    )
  )
    return invalid();
  return result;
}

export async function adjustPass(
  passId: string,
  scope: string,
  body: PassAdjustment,
  signal: AbortSignal,
  key: string,
): Promise<Pass> {
  const { version, reason, remainingMinutes, remainingCreditKrw, expiresAt } =
    body;
  const result = await api<Pass>(
    `/passes/${encodeURIComponent(passId)}/adjustments?${queryString({ scope })}`,
    {
      method: "POST",
      body: {
        version,
        reason,
        remainingMinutes,
        remainingCreditKrw,
        expiresAt,
      },
      signal,
      key,
    },
  );
  const parsed = z
    .object({
      id,
      version: count,
      kind,
      status,
      purchaseBranchId: id,
      remainingMinutes: count.nullable(),
      remainingCreditKrw: count.nullable(),
      expiresAt: instant.nullable(),
    })
    .safeParse(result);
  if (
    !parsed.success ||
    result.id !== passId ||
    result.purchaseBranchId !== scope
  )
    return invalid();
  return result;
}
export type { SessionFilters };
