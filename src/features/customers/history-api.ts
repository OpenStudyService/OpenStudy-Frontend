import { z } from "zod";
import type { components } from "../../shared/api/foundation.generated";
import { api, ApiError, queryString } from "../../shared/api/client";
import { reservationSchema } from "../rooms/api";
import { assignmentSchema } from "../lockers/api";
import { admin, can } from "../../shared/domain/schema";
import type { Employee } from "../../shared/domain/schema";

export type SpaceHistory = components["schemas"]["SpaceHistory"];
export type CrossBranchSummary = components["schemas"]["CrossBranchSummary"];
export type SummaryRequest = components["schemas"]["CrossBranchSummaryRequest"];
const id = z.string().min(1);
const instant = z.iso.datetime({ offset: true });
const summarySchema = z
  .object({
    customerId: id,
    passes: z.array(
      z
        .object({
          kind: z.enum(["시간권", "기간권", "정액권"]),
          productName: z.string(),
          status: z.enum(["활성", "소진", "만료", "환불"]),
          expiresAt: instant.nullable(),
        })
        .strict(),
    ),
    usages: z
      .array(
        z
          .object({
            kind: z.enum(["좌석", "스터디룸", "사물함"]),
            branchId: id,
            startAt: instant,
            endAt: instant.nullable(),
          })
          .strict()
          .refine(
            (v) =>
              v.endAt === null || Date.parse(v.endAt) >= Date.parse(v.startAt),
          ),
      )
      .max(50),
    asOf: instant,
  })
  .strict();
const spaceSchema = z.object({
  customerId: id,
  reservations: z.array(reservationSchema),
  assignments: z.array(assignmentSchema),
});
function invalid(): never {
  throw new ApiError(0, {
    code: "INVALID_RESPONSE",
    message: "고객 이력 응답을 확인하지 못했어요. 다시 조회해 주세요.",
  });
}
export const canReadCrossBranch = (user: Employee, branchId: string) =>
  branchId !== "all" &&
  (admin(user, branchId) || can(user, branchId, "customers:cross-branch-read"));

export async function getSpaceHistory(
  customerId: string,
  scope: string,
  signal: AbortSignal,
): Promise<SpaceHistory> {
  const parsed = spaceSchema.safeParse(
    await api<unknown>(
      `/customers/${encodeURIComponent(customerId)}/space-history?${queryString({ scope })}`,
      { signal },
    ),
  );
  if (!parsed.success || parsed.data.customerId !== customerId)
    return invalid();
  const { reservations, assignments } = parsed.data;
  if (
    [...reservations, ...assignments].some(
      (r) =>
        r.customer.id !== customerId ||
        (scope !== "all" && r.branchId !== scope),
    ) ||
    new Set(reservations.map((r) => r.id)).size !== reservations.length ||
    new Set(assignments.map((r) => r.id)).size !== assignments.length
  )
    return invalid();
  return parsed.data;
}
/** Every explicit lookup records a new service interaction. No query cache or Idempotency-Key. */
export async function getCrossBranchSummary(
  customerId: string,
  body: SummaryRequest,
  signal: AbortSignal,
): Promise<CrossBranchSummary> {
  const parsed = summarySchema.safeParse(
    await api<unknown>(
      `/customers/${encodeURIComponent(customerId)}/cross-branch-summary`,
      { method: "POST", body, signal },
    ),
  );
  if (!parsed.success || parsed.data.customerId !== customerId)
    return invalid();
  return parsed.data;
}
