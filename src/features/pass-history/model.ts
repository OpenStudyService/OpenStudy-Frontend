import { formatNumber } from "../../shared/domain/format";
import type {
  components,
  operations,
} from "../../shared/api/foundation.generated";
import type { Employee } from "../../shared/domain/schema";
import { can } from "../../shared/domain/schema";
import type { Pass } from "../payments/model";

export type SessionFilters = NonNullable<
  operations["listSeatSessions"]["parameters"]["query"]
>;
// OpenAPI's anyOf with required-only branches generates `unknown`. Keep the
// documented request explicit until that upstream schema is made generatable.
export type PassAdjustment = {
  version: number;
  reason: string;
  remainingMinutes?: number;
  remainingCreditKrw?: number;
  expiresAt?: string | null;
};
// These references are null for non-payment / out-of-scope events in the
// implemented API; the OpenAPI Id refs currently omit their nullability.
export type HistoryEvent = Omit<
  components["schemas"]["PassHistoryEvent"],
  "paymentId" | "seatSessionId"
> & {
  paymentId: string | null;
  seatSessionId: string | null;
};
export type CustomerHistory = Omit<
  components["schemas"]["CustomerPassHistory"],
  "events"
> & { events: HistoryEvent[] };
export type Ledger = CustomerHistory["passes"][number];

export function canAdjust(user: Employee, pass: Pass) {
  return (
    pass.status !== "환불" && can(user, pass.purchaseBranchId, "payments:write")
  );
}

/** Inputs always mean Korean business time, independent of browser timezone. */
export function toInstant(value: string) {
  if (!value) return undefined;
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(value))
    throw new Error("일시를 확인해 주세요.");
  const result = new Date(`${value}+09:00`);
  if (
    !Number.isFinite(result.getTime()) ||
    toDateInput(result.toISOString()).slice(0, value.length) !== value
  )
    throw new Error("일시를 확인해 주세요.");
  return result.toISOString();
}
export function toDateInput(value: string | null) {
  return value
    ? new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(0, 19)
    : "";
}
export function timeRange(from: string, to: string) {
  const start = toInstant(from),
    end = toInstant(to);
  if (start && end && start >= end)
    throw new Error("조회 종료는 시작보다 뒤여야 해요.");
  return { from: start, to: end };
}

export function adjustmentBody(
  pass: Pass,
  balance: string,
  expiry: string,
  noExpiry: boolean,
  reason: string,
): PassAdjustment {
  const body: PassAdjustment = { version: pass.version, reason: reason.trim() };
  if (!body.reason || body.reason.length > 500)
    throw new Error("조정 사유를 1~500자로 입력해 주세요.");
  if (pass.kind !== "기간권") {
    const amount = Number(balance);
    const maximum =
      pass.kind === "시간권" ? 4294967295 : Number.MAX_SAFE_INTEGER;
    if (
      !/^\d+$/.test(balance) ||
      !Number.isSafeInteger(amount) ||
      amount > maximum
    )
      throw new Error(
        `잔량은 0~${formatNumber(maximum)} 사이의 정수로 입력해 주세요.`,
      );
    const field =
      pass.kind === "시간권" ? "remainingMinutes" : "remainingCreditKrw";
    if (amount !== pass[field]) body[field] = amount;
  }
  if (pass.kind === "기간권" && noExpiry)
    throw new Error("기간권은 만료 일시가 필요해요.");
  const expiresAt = noExpiry ? null : toInstant(expiry);
  if (expiresAt === undefined) throw new Error("만료 일시를 입력해 주세요.");
  if (
    expiresAt &&
    pass.startedAt &&
    Date.parse(expiresAt) <= Date.parse(pass.startedAt)
  )
    throw new Error("만료 일시는 시작 일시보다 뒤여야 해요.");
  // Compare the input precision without silently truncating server microseconds.
  if (
    noExpiry ? pass.expiresAt !== null : expiry !== toDateInput(pass.expiresAt)
  )
    body.expiresAt = expiresAt;
  if (Object.keys(body).length === 2)
    throw new Error("조정할 잔량이나 만료 일시를 변경해 주세요.");
  return body;
}
