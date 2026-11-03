import type { components } from "../../shared/api/foundation.generated";
import { can } from "../../shared/domain/schema";
import type { Employee } from "../../shared/domain/schema";

type S = components["schemas"];
export type Locker = S["Locker"];
export type LockerPage = S["LockerPage"];
export type LockerCreate = S["LockerCreate"];
export type LockerUpdate = S["LockerUpdate"];
export type LockerStatusChange = S["SpaceStatusChange"];
export type LockerRateApply = S["LockerRateApply"];
export type LockerRateApplyResult = S["LockerRateApplyResult"];
export type LockerOccupancy = S["LockerOccupancy"];
export type LockerBranchOccupancy = S["LockerBranchOccupancy"];
export type LockerAssignment = S["LockerAssignment"];
export type LockerAssignmentPage = S["LockerAssignmentPage"];
export type LockerAssignmentCreate = S["LockerAssignmentCreate"];
export type LockerAssignmentExtend = S["LockerAssignmentExtend"];
export type LockerAssignmentReturn = S["LockerAssignmentReturn"];
export type LockerCharge = S["LockerCharge"];
export type LockerFilters = {
  page?: number;
  pageSize?: number;
  assignmentState?: Locker["assignmentState"] | "";
};
export type AssignmentFilters = {
  page?: number;
  pageSize?: number;
  lockerId?: string;
  customerId?: string;
  status?: LockerAssignment["status"] | "";
};
export const lockerStatuses: Locker["status"][] = ["사용 가능", "운영 중단"];
export const assignmentStates: Locker["assignmentState"][] = [
  "사용 가능",
  "사용 중",
  "운영 중단",
];
export const assignmentStatuses: LockerAssignment["status"][] = [
  "결제 실패",
  "배정",
  "반납",
  "취소",
];
export const canManageLocker = (user: Employee, branch: string) =>
  can(user, branch, "operations:write");
export const canAssignLocker = (user: Employee, branch: string) =>
  can(user, branch, "payments:write");
export const canReadLockerCharges = (user: Employee, branch: string) =>
  can(user, branch, "payments:read") || can(user, branch, "payments:write");
export const canReturnAssignment = (
  user: Employee,
  assignment: LockerAssignment,
) => can(user, assignment.branchId) && assignment.status === "배정";
export const canExtendAssignment = (
  user: Employee,
  assignment: LockerAssignment,
) => canAssignLocker(user, assignment.branchId) && assignment.status === "배정";

const DAY = 86400000;
/** Date-only arithmetic avoids device timezone and daylight-saving changes. */
export function dateValue(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const result = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(result) &&
    new Date(result).toISOString().slice(0, 10) === value
    ? result
    : NaN;
}
export function lockerTerms(startDate: string, endDate: string): number | null {
  const days = (dateValue(endDate) - dateValue(startDate)) / DAY;
  return Number.isSafeInteger(days) && days > 0 && days % 28 === 0
    ? days / 28
    : null;
}
export function addLockerTerms(startDate: string, terms: number): string {
  const value = dateValue(startDate) + terms * 28 * DAY;
  return Number.isSafeInteger(terms) &&
    terms > 0 &&
    Number.isFinite(value) &&
    value <= dateValue("9999-12-31")
    ? new Date(value).toISOString().slice(0, 10)
    : "";
}
export function koreaToday(now: number | string = Date.now()): string {
  const value = typeof now === "string" ? Date.parse(now) : now;
  return Number.isFinite(value)
    ? new Date(value + 9 * 3600000).toISOString().slice(0, 10)
    : "";
}
export function validAssignmentPeriod(
  startDate: string,
  endDate: string,
  now: number | string = Date.now(),
): boolean {
  const today = koreaToday(now);
  return (
    !!today && lockerTerms(startDate, endDate) !== null && startDate >= today
  );
}
export function lockerKey(user: string, scope: string, id: string) {
  return ["data", user, scope, "lockers", "detail", id] as const;
}
export function assignmentKey(user: string, scope: string, id: string) {
  return ["data", user, scope, "locker-assignments", "detail", id] as const;
}
