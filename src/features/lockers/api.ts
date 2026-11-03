import { z } from "zod";
import { api, ApiError, queryString } from "../../shared/api/client";
import { dateValue, lockerTerms } from "./model";
import type {
  Locker,
  LockerPage,
  LockerCreate,
  LockerUpdate,
  LockerStatusChange,
  LockerRateApply,
  LockerRateApplyResult,
  LockerOccupancy,
  LockerAssignment,
  LockerAssignmentPage,
  LockerAssignmentCreate,
  LockerAssignmentExtend,
  LockerAssignmentReturn,
  LockerFilters,
  AssignmentFilters,
} from "./model";
export type * from "./model";

const id = z.string().trim().min(1);
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positive = integer.positive();
const date = z.string().refine((value) => Number.isFinite(dateValue(value)));
const instant = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)));
const customer = z.object({ id, memberNo: id, name: z.string() });
const actor = z.object({ id, name: z.string() });
const active = z
  .object({
    id,
    customer,
    startDate: date,
    endDate: date,
    overdue: z.boolean(),
  })
  .refine((value) => lockerTerms(value.startDate, value.endDate) !== null);
export const lockerSchema = z
  .object({
    id,
    version: integer,
    branchId: id,
    lockerNo: z.string().min(1).max(40),
    ratePer4WeeksKrw: positive,
    status: z.enum(["사용 가능", "운영 중단"]),
    assignmentState: z.enum(["사용 가능", "사용 중", "운영 중단"]),
    activeAssignment: active.nullable(),
  })
  .refine(
    (value) =>
      value.assignmentState ===
      (value.status === "운영 중단"
        ? "운영 중단"
        : value.activeAssignment
          ? "사용 중"
          : "사용 가능"),
  );
const charge = z
  .object({
    id,
    kind: z.enum(["최초", "연장"]),
    startDate: date,
    endDate: date,
    terms: positive,
    ratePer4WeeksKrw: positive,
    amountKrw: positive,
    status: z.enum(["적용", "실패"]),
    paymentId: id,
    createdAt: instant,
    appliedAt: instant.nullable(),
  })
  .refine(
    (value) =>
      lockerTerms(value.startDate, value.endDate) === value.terms &&
      Number.isSafeInteger(value.ratePer4WeeksKrw * value.terms) &&
      value.amountKrw === value.ratePer4WeeksKrw * value.terms &&
      (value.status === "적용") === (value.appliedAt !== null),
  );
export const assignmentSchema = z
  .object({
    id,
    version: integer,
    branchId: id,
    status: z.enum(["결제 실패", "배정", "반납", "취소"]),
    locker: z.object({ id, lockerNo: z.string().min(1) }),
    customer,
    startDate: date,
    endDate: date,
    overdue: z.boolean(),
    returnedAt: instant.nullable(),
    assignedBy: actor,
    lastChangedBy: actor.nullable(),
    reason: z.string().nullable(),
    charges: z.array(charge).nullable(),
    createdAt: instant,
    updatedAt: instant,
  })
  .refine(
    (value) =>
      lockerTerms(value.startDate, value.endDate) !== null &&
      (value.status === "반납") === (value.returnedAt !== null) &&
      (!value.overdue || value.status === "배정") &&
      (value.charges === null ||
        new Set(value.charges.map((row) => row.id)).size ===
          value.charges.length),
  );
const meta = z.object({ page: positive, pageSize: positive, total: integer });
const occupancy = z.object({
  items: z.array(
    z
      .object({
        branchId: id,
        total: integer,
        inUse: integer,
        available: integer,
        blocked: integer,
        overdue: integer,
        asOf: instant,
      })
      .refine(
        (value) =>
          value.total === value.inUse + value.available + value.blocked &&
          value.overdue <= value.total,
      ),
  ),
});
function invalid(): never {
  throw new ApiError(0, {
    code: "INVALID_RESPONSE",
    message: "사물함 응답을 확인하지 못했습니다. 다시 조회해 주세요.",
  });
}
function parse<T>(schema: z.ZodType, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) invalid();
  return result.data as T;
}
function checkScope(value: { branchId: string }, scope: string) {
  if (scope !== "all" && value.branchId !== scope) invalid();
}
function checkPage<T extends { id: string; branchId: string }>(
  value: { items: T[]; meta: { page: number; pageSize: number } },
  scope: string,
  filters: { page?: number; pageSize?: number },
) {
  if (
    new Set(value.items.map((row) => row.id)).size !== value.items.length ||
    value.items.length > value.meta.pageSize ||
    value.meta.page !== (filters.page ?? 1) ||
    value.meta.pageSize !== (filters.pageSize ?? 20)
  )
    invalid();
  value.items.forEach((row) => checkScope(row, scope));
}
const scoped = (path: string, scope: string) =>
  `${path}?${queryString({ scope })}`;
const lockerPath = (value: string) => `/lockers/${encodeURIComponent(value)}`;
const assignmentPath = (value: string) =>
  `/locker-assignments/${encodeURIComponent(value)}`;

export const lockerApi = {
  async lockers(scope: string, filters: LockerFilters, signal: AbortSignal) {
    const { page, pageSize, assignmentState } = filters;
    const result = parse<LockerPage>(
      z.object({ items: z.array(lockerSchema), meta }),
      await api(
        `/lockers?${queryString({ scope, page, pageSize, assignmentState })}`,
        { signal },
      ),
    );
    checkPage(result, scope, filters);
    if (
      assignmentState &&
      result.items.some((row) => row.assignmentState !== assignmentState)
    )
      invalid();
    return result;
  },
  async locker(scope: string, value: string, signal: AbortSignal) {
    const result = parse<Locker>(
      lockerSchema,
      await api(scoped(lockerPath(value), scope), { signal }),
    );
    checkScope(result, scope);
    if (result.id !== value) invalid();
    return result;
  },
  async occupancy(scope: string, signal: AbortSignal) {
    const result = parse<LockerOccupancy>(
      occupancy,
      await api(scoped("/lockers/occupancy", scope), { signal }),
    );
    if (
      new Set(result.items.map((row) => row.branchId)).size !==
        result.items.length ||
      (scope !== "all" &&
        (result.items.length !== 1 || result.items[0].branchId !== scope))
    )
      invalid();
    return result;
  },
  async createLocker(
    scope: string,
    body: LockerCreate,
    signal: AbortSignal,
    key: string,
  ) {
    const { branchId, lockerNo, ratePer4WeeksKrw, status } = body;
    const result = parse<Locker>(
      lockerSchema,
      await api(scoped("/lockers", scope), {
        method: "POST",
        body: { branchId, lockerNo, ratePer4WeeksKrw, status },
        signal,
        key,
      }),
    );
    if (result.branchId !== branchId) invalid();
    if (
      result.lockerNo !== lockerNo.trim() ||
      result.ratePer4WeeksKrw !== ratePer4WeeksKrw ||
      result.status !== (status ?? "사용 가능")
    )
      invalid();
    return result;
  },
  async updateLocker(
    scope: string,
    value: string,
    body: LockerUpdate,
    signal: AbortSignal,
  ) {
    const { version, lockerNo, ratePer4WeeksKrw } = body;
    const result = parse<Locker>(
      lockerSchema,
      await api(scoped(lockerPath(value), scope), {
        method: "PATCH",
        body: { version, lockerNo, ratePer4WeeksKrw },
        signal,
      }),
    );
    checkScope(result, scope);
    if (result.id !== value) invalid();
    if (
      (lockerNo !== undefined && result.lockerNo !== lockerNo.trim()) ||
      (ratePer4WeeksKrw !== undefined &&
        result.ratePer4WeeksKrw !== ratePer4WeeksKrw)
    )
      invalid();
    return result;
  },
  async lockerStatus(
    scope: string,
    value: string,
    body: LockerStatusChange,
    signal: AbortSignal,
  ) {
    const { version, status, reason } = body;
    const result = parse<Locker>(
      lockerSchema,
      await api(scoped(`${lockerPath(value)}/status`, scope), {
        method: "POST",
        body: { version, status, reason },
        signal,
      }),
    );
    checkScope(result, scope);
    if (result.id !== value) invalid();
    if (result.status !== status) invalid();
    return result;
  },
  async applyRate(
    branchId: string,
    body: LockerRateApply,
    signal: AbortSignal,
    key: string,
  ) {
    const { ratePer4WeeksKrw } = body;
    const result = parse<LockerRateApplyResult>(
      z.object({ updated: integer, ratePer4WeeksKrw: positive }),
      await api(`/branches/${encodeURIComponent(branchId)}/locker-rate`, {
        method: "POST",
        body: { ratePer4WeeksKrw },
        signal,
        key,
      }),
    );
    if (result.ratePer4WeeksKrw !== ratePer4WeeksKrw) invalid();
    return result;
  },
  async assignments(
    scope: string,
    filters: AssignmentFilters,
    signal: AbortSignal,
  ) {
    const { page, pageSize, lockerId, customerId, status } = filters;
    const result = parse<LockerAssignmentPage>(
      z.object({ items: z.array(assignmentSchema), meta }),
      await api(
        `/locker-assignments?${queryString({ scope, page, pageSize, lockerId, customerId, status })}`,
        { signal },
      ),
    );
    checkPage(result, scope, filters);
    if (
      result.items.some(
        (row) =>
          (lockerId && row.locker.id !== lockerId) ||
          (customerId && row.customer.id !== customerId) ||
          (status && row.status !== status),
      )
    )
      invalid();
    return result;
  },
  async assignment(scope: string, value: string, signal: AbortSignal) {
    const result = parse<LockerAssignment>(
      assignmentSchema,
      await api(scoped(assignmentPath(value), scope), { signal }),
    );
    checkScope(result, scope);
    if (result.id !== value) invalid();
    return result;
  },
  async createAssignment(
    scope: string,
    body: LockerAssignmentCreate,
    signal: AbortSignal,
    key: string,
  ) {
    const {
      branchId,
      lockerId,
      customerId,
      startDate,
      endDate,
      method,
      mockOutcome,
    } = body;
    const result = parse<LockerAssignment>(
      assignmentSchema,
      await api(scoped("/locker-assignments", scope), {
        method: "POST",
        body: {
          branchId,
          lockerId,
          customerId,
          startDate,
          endDate,
          method,
          mockOutcome,
        },
        signal,
        key,
      }),
    );
    if (
      result.branchId !== branchId ||
      result.locker.id !== lockerId ||
      result.customer.id !== customerId ||
      result.startDate !== startDate ||
      result.endDate !== endDate
    )
      invalid();
    const initial = result.charges?.[0];
    if (
      !initial ||
      result.charges?.length !== 1 ||
      initial.kind !== "최초" ||
      initial.startDate !== startDate ||
      initial.endDate !== endDate ||
      result.status !== (mockOutcome === "FAILED" ? "결제 실패" : "배정") ||
      initial.status !== (mockOutcome === "FAILED" ? "실패" : "적용")
    )
      invalid();
    return result;
  },
  async extend(
    scope: string,
    value: string,
    body: LockerAssignmentExtend,
    signal: AbortSignal,
    key: string,
  ) {
    const { version, endDate, method, mockOutcome } = body;
    const result = parse<LockerAssignment>(
      assignmentSchema,
      await api(scoped(`${assignmentPath(value)}/extend`, scope), {
        method: "POST",
        body: { version, endDate, method, mockOutcome },
        signal,
        key,
      }),
    );
    checkScope(result, scope);
    if (result.id !== value) invalid();
    const last = result.charges?.at(-1);
    if (
      result.status !== "배정" ||
      !last ||
      last.kind !== "연장" ||
      last.endDate !== endDate ||
      last.status !== (mockOutcome === "FAILED" ? "실패" : "적용") ||
      result.endDate !== (last.status === "적용" ? endDate : last.startDate)
    )
      invalid();
    return result;
  },
  async returnLocker(
    scope: string,
    value: string,
    body: LockerAssignmentReturn,
    signal: AbortSignal,
  ) {
    const { version, reason } = body;
    const result = parse<LockerAssignment>(
      assignmentSchema,
      await api(scoped(`${assignmentPath(value)}/return`, scope), {
        method: "POST",
        body: { version, reason },
        signal,
      }),
    );
    checkScope(result, scope);
    if (result.id !== value) invalid();
    if (result.status !== "반납") invalid();
    return result;
  },
};
