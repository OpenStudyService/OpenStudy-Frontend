import type { components } from "../../shared/api/foundation.generated";
import { can } from "../../shared/domain/schema";
import type { Employee } from "../../shared/domain/schema";

type S = components["schemas"];
export type Room = S["Room"];
export type RoomCreate = S["RoomCreate"];
export type RoomUpdate = S["RoomUpdate"];
export type SpaceStatusChange = S["SpaceStatusChange"];
export type RoomStatusChange = SpaceStatusChange;
export type RoomPage = S["RoomPage"];
export type RoomReservation = S["RoomReservation"];
export type RoomReservationCreate = S["RoomReservationCreate"];
export type RoomReservationCancel = S["RoomReservationCancel"];
export type RoomUsageChange = S["RoomUsageChange"];
export type RoomReservationPage = S["RoomReservationPage"];
export type RoomReservationCalendar = S["RoomReservationCalendar"] & {
  closedDates?: string[];
};
export type ReservationBilling = S["ReservationBilling"];
export type RoomFilters = {
  page?: number;
  pageSize?: number;
  status?: Room["status"] | "";
};
export type ReservationFilters = {
  page?: number;
  pageSize?: number;
  roomId?: string;
  customerId?: string;
  status?: RoomReservation["status"] | "";
  from?: string;
  to?: string;
};
export const roomStatuses: Room["status"][] = ["사용 가능", "운영 중단"];
export const reservationStatuses: RoomReservation["status"][] = [
  "확정",
  "이용 중",
  "완료",
  "취소",
  "결제 실패",
];
export const canManageRoom = (user: Employee, branch: string) =>
  can(user, branch, "operations:write");
export const canBookRoom = (user: Employee, branch: string) =>
  can(user, branch, "payments:write");
export function canCancelReservation(
  user: Employee,
  reservation: RoomReservation,
  now: number | string = Date.now(),
) {
  const current = typeof now === "string" ? Date.parse(now) : now;
  return (
    canBookRoom(user, reservation.branchId) &&
    reservation.canCancel &&
    reservation.status === "확정" &&
    current < Date.parse(reservation.startAt)
  );
}
export function canStartReservation(
  user: Employee,
  reservation: RoomReservation,
) {
  return can(user, reservation.branchId) && reservation.status === "확정";
}
export function canCompleteReservation(
  user: Employee,
  reservation: RoomReservation,
) {
  return can(user, reservation.branchId) && reservation.status === "이용 중";
}
/** Offset-aware timestamps, whole hours, future start and at most 24 hours: the server's M6 rule. */
export function validReservationTime(
  startAt: string,
  endAt: string,
  now: number | string = Date.now(),
) {
  const start = Date.parse(startAt),
    end = Date.parse(endAt),
    current = typeof now === "string" ? Date.parse(now) : now;
  return (
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    start % 3600000 === 0 &&
    end % 3600000 === 0 &&
    start > current &&
    end > start &&
    end - start <= 24 * 3600000
  );
}
export function roomKey(user: string, scope: string, id: string) {
  return ["data", user, scope, "rooms", "detail", id] as const;
}
export function reservationKey(user: string, scope: string, id: string) {
  return ["data", user, scope, "room-reservations", "detail", id] as const;
}
