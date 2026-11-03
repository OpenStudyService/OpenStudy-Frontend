import { expect, it } from "vitest";
import {
  validReservationTime,
  canCancelReservation,
  canStartReservation,
  canCompleteReservation,
} from "./model";
import type { RoomReservation } from "./model";
import { MockStore } from "../../mocks/store";
it("accepts Korean whole-hour intervals and the 24-hour upper boundary", () => {
  expect(
    validReservationTime(
      "2030-01-01T10:00:00+09:00",
      "2030-01-02T10:00:00+09:00",
      "2029-01-01T00:00:00Z",
    ),
  ).toBe(true);
});
it.each([
  ["2030-01-01T01:30:00Z", "2030-01-01T02:30:00Z"],
  ["2030-01-01T01:00:00.001Z", "2030-01-01T02:00:00Z"],
  ["2030-01-01T01:00:00Z", "2030-01-01T01:00:00Z"],
  ["2030-01-01T01:00:00Z", "2030-01-02T02:00:00Z"],
])("rejects invalid whole-hour interval %s / %s", (start, end) => {
  expect(validReservationTime(start, end, "2029-01-01T00:00:00Z")).toBe(false);
});
it("treats the exact start boundary as not cancellable and keeps staff's no-payment usage actions", () => {
  const store = new MockStore(false),
    owner = store.db.employees.find((e) => e.owner)!,
    staff = store.db.employees.find((e) => e.id === "junho")!;
  const row = {
    branchId: "gangnam",
    status: "확정",
    canCancel: true,
    startAt: "2030-01-01T01:00:00Z",
  } as RoomReservation;
  expect(canCancelReservation(owner, row, "2030-01-01T00:59:59Z")).toBe(true);
  expect(canCancelReservation(owner, row, row.startAt)).toBe(false);
  expect(canCancelReservation(staff, row, "2030-01-01T00:59:59Z")).toBe(false);
  expect(canStartReservation(staff, row)).toBe(true);
  expect(canCompleteReservation(staff, { ...row, status: "이용 중" })).toBe(
    true,
  );
  expect(canCompleteReservation(staff, row)).toBe(false);
});
