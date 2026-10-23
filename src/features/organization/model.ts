import type { components } from "../../shared/api/foundation.generated";
import type { Employee as SessionEmployee } from "../../shared/domain/schema";
import { permissions } from "../../shared/domain/schema";

export type Branch = components["schemas"]["Branch"];
export type Employee = components["schemas"]["Employee"];
export type Membership = components["schemas"]["Membership"];
export type Preset = components["schemas"]["PermissionPreset"];
export type WeeklyHours = components["schemas"]["WeeklyHours"];
export type BranchInput = components["schemas"]["BranchCreate"];
export type MembershipInput = components["schemas"]["MembershipUpdate"];
export const weekdays = ["월", "화", "수", "목", "금", "토", "일"];
export const defaultHours = (): WeeklyHours[] =>
  weekdays.map((_, i) => ({
    weekday: i + 1,
    isClosed: false,
    opensMinute: 0,
    closesMinute: 1440,
  }));
export function hoursError(hours: WeeklyHours[]): string | undefined {
  if (
    hours.length !== 7 ||
    new Set(hours.map((h) => h.weekday)).size !== 7 ||
    hours.some(
      (h) => !Number.isInteger(h.weekday) || h.weekday < 1 || h.weekday > 7,
    )
  )
    return "월요일부터 일요일까지 7일을 지정해 주세요.";
  if (
    hours.some((h) =>
      h.isClosed
        ? h.opensMinute !== null || h.closesMinute !== null
        : !Number.isInteger(h.opensMinute) ||
          !Number.isInteger(h.closesMinute) ||
          h.opensMinute! < 0 ||
          h.opensMinute! >= 1440 ||
          h.closesMinute! <= h.opensMinute! ||
          h.closesMinute! > 2880,
    )
  )
    return "영업 시작은 00:00~23:59, 종료는 시작 이후부터 다음 날 24:00까지 입력해 주세요.";
}
export function canManageBranch(
  actor: SessionEmployee,
  branchId: string,
  permission: "operations:write" | "people:manage" = "operations:write",
) {
  return (
    actor.status === "활성" &&
    (actor.owner ||
      actor.memberships.some(
        (m) =>
          m.branchId === branchId &&
          m.role === "admin" &&
          m.permissions.includes(permission) &&
          (!m.status || m.status === "활성"),
      ))
  );
}
export function canManageMembership(
  actor: SessionEmployee,
  employee: Employee,
  membership: Membership,
) {
  if (
    actor.status !== "활성" ||
    actor.id === employee.id ||
    employee.owner ||
    membership.status !== "활성"
  )
    return false;
  return (
    actor.owner ||
    (membership.role === "staff" &&
      canManageBranch(actor, membership.branchId, "people:manage"))
  );
}
export function copyPreset(
  preset: Pick<Preset, "id" | "role" | "permissions">,
): Pick<MembershipInput, "role" | "permissions" | "presetId"> {
  return {
    presetId: preset.id,
    role: preset.role,
    permissions: [...preset.permissions],
  };
}
export function rolePermissions(
  role: Membership["role"],
): Membership["permissions"] {
  return role === "admin" ? [...permissions] : [];
}
export function membershipBody(
  employee: Employee,
  current: Membership,
  draft: Pick<MembershipInput, "role" | "status" | "permissions" | "presetId">,
): MembershipInput {
  return {
    ...draft,
    permissions: [...draft.permissions],
    employeeVersion: employee.version,
    version: current.version,
  };
}
