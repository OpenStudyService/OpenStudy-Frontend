import { expect, it } from "vitest";
import { MockStore } from "../../mocks/store";
import {
  lockerTerms,
  addLockerTerms,
  koreaToday,
  validAssignmentPeriod,
  canManageLocker,
  canAssignLocker,
  canReturnAssignment,
  canExtendAssignment,
} from "./model";
import type { LockerAssignment } from "./model";

it("uses 28-day calendar blocks across leap days and year boundaries", () => {
  expect(addLockerTerms("2028-02-01", 1)).toBe("2028-02-29");
  expect(addLockerTerms("2029-12-20", 2)).toBe("2030-02-14");
  expect(lockerTerms("2029-12-20", "2030-02-14")).toBe(2);
  expect(lockerTerms("2030-01-01", "2030-01-28")).toBeNull();
  expect(lockerTerms("2030-02-30", "2030-03-30")).toBeNull();
  expect(addLockerTerms("9999-12-20", 1)).toBe("");
});

it("validates start against Korea's date and permits extensions from overdue dates", () => {
  const now = "2030-01-01T15:00:00Z";
  expect(koreaToday(now)).toBe("2030-01-02");
  expect(validAssignmentPeriod("2030-01-01", "2030-01-29", now)).toBe(false);
  expect(validAssignmentPeriod("2030-01-02", "2030-01-30", now)).toBe(true);
  expect(validAssignmentPeriod("2030-01-02", "2030-01-30", "invalid")).toBe(
    false,
  );
  expect(lockerTerms("2029-12-01", "2029-12-29")).toBe(1);
});

it("keeps ordinary staff return permission separate from ledger and payment grants", () => {
  const store = new MockStore(false),
    staff = store.db.employees.find((row) => row.id === "junho")!,
    owner = store.db.employees.find((row) => row.owner)!;
  const row = {
    branchId: "gangnam",
    status: "배정",
    overdue: true,
  } as LockerAssignment;
  expect(canManageLocker(staff, "gangnam")).toBe(false);
  expect(canAssignLocker(staff, "gangnam")).toBe(false);
  expect(canExtendAssignment(staff, row)).toBe(false);
  expect(canReturnAssignment(staff, row)).toBe(true);
  expect(canReturnAssignment(staff, { ...row, status: "반납" })).toBe(false);
  expect(canReturnAssignment(staff, { ...row, branchId: "other" })).toBe(false);
  expect(canManageLocker(owner, "gangnam")).toBe(true);
  expect(canExtendAssignment(owner, row)).toBe(true);
});
