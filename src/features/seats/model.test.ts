import { describe, expect, it } from "vitest";
import type { Employee } from "../../shared/domain/schema";
import {
  canManageSeats,
  canUseSeats,
  canWriteSeats,
  occupancyLabel,
} from "./model";

const staff = {
  id: "u",
  status: "활성",
  owner: false,
  memberships: [
    { branchId: "b", status: "활성", role: "staff", permissions: [] },
  ],
} as unknown as Employee;
describe("seat action authorization", () => {
  it("allows every active member to check in/out, with no operations grant", () => {
    expect(canUseSeats(staff, "b")).toBe(true);
    expect(canWriteSeats(staff, "b")).toBe(false);
    expect(canManageSeats(staff, "b")).toBe(false);
  });
  it("requires operations write for editing/moving and an admin grant for operating state", () => {
    const writer: Employee = {
      ...staff,
      memberships: [
        { ...staff.memberships[0], permissions: ["operations:write"] },
      ],
    };
    expect(canWriteSeats(writer, "b")).toBe(true);
    expect(canManageSeats(writer, "b")).toBe(false);
    expect(
      canManageSeats(
        {
          ...writer,
          memberships: [{ ...writer.memberships[0], role: "admin" }],
        },
        "b",
      ),
    ).toBe(true);
  });
  it("does not combine manager and operations grants across separate memberships", () => {
    const split: Employee = {
      ...staff,
      memberships: [
        { branchId: "b", status: "활성", role: "admin", permissions: [] },
        {
          branchId: "other",
          status: "활성",
          role: "staff",
          permissions: ["operations:write"],
        },
      ],
    };
    expect(canManageSeats(split, "b")).toBe(false);
    expect(canWriteSeats(split, "b")).toBe(false);
  });
  it("accepts the actual canonical /me membership shape without status", () => {
    const canonicalStaff: Employee = {
      ...staff,
      memberships: [{ branchId: "1", role: "staff", permissions: [] }],
    };
    expect(canUseSeats(canonicalStaff, "1")).toBe(true);
    expect(canWriteSeats(canonicalStaff, "1")).toBe(false);
    expect(canManageSeats(canonicalStaff, "1")).toBe(false);
    const canonicalWriter: Employee = {
      ...canonicalStaff,
      memberships: [
        { branchId: "1", role: "staff", permissions: ["operations:write"] },
      ],
    };
    expect(canWriteSeats(canonicalWriter, "1")).toBe(true);
    expect(canManageSeats(canonicalWriter, "1")).toBe(false);
    const canonicalManager: Employee = {
      ...canonicalWriter,
      memberships: [{ ...canonicalWriter.memberships[0], role: "admin" }],
    };
    expect(canUseSeats(canonicalManager, "1")).toBe(true);
    expect(canWriteSeats(canonicalManager, "1")).toBe(true);
    expect(canManageSeats(canonicalManager, "1")).toBe(true);
    expect(canUseSeats(canonicalStaff, "other")).toBe(false);
  });
  it("rejects inactive, revoked, pending and missing memberships", () => {
    expect(canUseSeats({ ...staff, status: "비활성" }, "b")).toBe(false);
    for (const status of ["회수", "승인 대기"] as const) {
      const inactive: Employee = {
        ...staff,
        memberships: [
          {
            ...staff.memberships[0],
            status,
            role: "admin",
            permissions: ["operations:write"],
          },
        ],
      };
      expect(canUseSeats(inactive, "b")).toBe(false);
      expect(canWriteSeats(inactive, "b")).toBe(false);
      expect(canManageSeats(inactive, "b")).toBe(false);
    }
    expect(canUseSeats(staff, "other")).toBe(false);
    expect(canUseSeats(staff, "all")).toBe(false);
    expect(canUseSeats(staff, "")).toBe(false);
  });
  it("allows active owners for concrete branches only", () => {
    const owner = { ...staff, owner: true, memberships: [] };
    expect(canUseSeats(owner, "other")).toBe(true);
    expect(canWriteSeats(owner, "other")).toBe(true);
    expect(canManageSeats(owner, "other")).toBe(true);
    expect(canManageSeats(owner, "all")).toBe(false);
    expect(canUseSeats({ ...owner, status: "비활성" }, "other")).toBe(false);
  });
});
it("keeps unavailable occupancy separate from zero percent", () => {
  expect(occupancyLabel(null)).toBe("해당 없음");
  expect(occupancyLabel(0)).toBe("0.0%");
  expect(occupancyLabel(33.3)).toBe("33.3%");
});
