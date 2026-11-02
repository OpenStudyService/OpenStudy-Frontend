import type { Employee, Membership } from "../../shared/domain/schema";
export type {
  Seat,
  SeatBoard,
  SeatCounts,
  SeatCreate,
  SeatUpdate,
  SeatStatusChange,
  CheckInLookup,
  CheckInCandidate,
  UsablePass,
  SeatSession,
  CheckIn,
  CheckOut,
  SeatSessionMove,
} from "./api";

export const seatKinds = ["일반", "모니터", "기타"] as const;
export const seatStatuses = ["사용 가능", "사용 중", "운영 중단"] as const;
// These hints use the current user's memberships, never lookup metadata.
// Canonical /me includes only active memberships and omits their status.
const activeMembership = (membership: Membership, branchId: string) =>
  membership.branchId === branchId &&
  (membership.status === undefined || membership.status === "활성");
export function canUseSeats(user: Employee, branchId: string) {
  return (
    !!branchId &&
    branchId !== "all" &&
    user.status === "활성" &&
    (user.owner ||
      user.memberships.some((membership) =>
        activeMembership(membership, branchId),
      ))
  );
}
export function canWriteSeats(user: Employee, branchId: string) {
  return (
    canUseSeats(user, branchId) &&
    (user.owner ||
      user.memberships.some(
        (membership) =>
          activeMembership(membership, branchId) &&
          membership.permissions.includes("operations:write"),
      ))
  );
}
export function canManageSeats(user: Employee, branchId: string) {
  return (
    canUseSeats(user, branchId) &&
    (user.owner ||
      user.memberships.some(
        (membership) =>
          activeMembership(membership, branchId) &&
          membership.role === "admin" &&
          membership.permissions.includes("operations:write"),
      ))
  );
}
export const occupancyLabel = (rate: number | null) =>
  rate === null ? "해당 없음" : `${rate.toFixed(1)}%`;
