import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../../shared/api/client";
import { MockStore } from "../../mocks/store";
import {
  canReadCrossBranch,
  getCrossBranchSummary,
  getSpaceHistory,
} from "./history-api";
vi.mock("../../shared/api/client", async (load) => ({
  ...(await load<typeof import("../../shared/api/client")>()),
  api: vi.fn(),
}));
const signal = new AbortController().signal;
const summary = {
  customerId: "c1",
  passes: [
    { kind: "시간권", productName: "10시간", status: "활성", expiresAt: null },
  ],
  usages: [
    {
      kind: "좌석",
      branchId: "b2",
      startAt: "2026-11-01T10:00:00Z",
      endAt: null,
    },
  ],
  asOf: "2026-11-03T10:00:00Z",
};
beforeEach(() => vi.resetAllMocks());
it("POSTs the serving branch and reason without scope, idempotency or a shared read cache", async () => {
  vi.mocked(api).mockResolvedValue(summary);
  const body = { branchId: "b1", reason: "상담" };
  expect(await getCrossBranchSummary("c1", body, signal)).toEqual(summary);
  await getCrossBranchSummary("c1", body, signal);
  expect(api).toHaveBeenCalledTimes(2);
  expect(api).toHaveBeenLastCalledWith("/customers/c1/cross-branch-summary", {
    method: "POST",
    body,
    signal,
  });
});
it.each([
  { ...summary, customerId: "another" },
  { ...summary, paymentId: "secret" },
  { ...summary, passes: [{ ...summary.passes[0], remainingMinutes: 60 }] },
  { ...summary, usages: [{ ...summary.usages[0], actor: "secret" }] },
  {
    ...summary,
    usages: [{ ...summary.usages[0], endAt: "2026-10-01T00:00:00Z" }],
  },
])("rejects mismatched or expanded minimal summary responses", async (raw) => {
  vi.mocked(api).mockResolvedValue(raw);
  await expect(
    getCrossBranchSummary("c1", { branchId: "b1", reason: "상담" }, signal),
  ).rejects.toMatchObject({ detail: { code: "INVALID_RESPONSE" } });
});
it("reads unpaged space history with the selected scope and validates the target", async () => {
  vi.mocked(api).mockResolvedValue({
    customerId: "c1",
    reservations: [],
    assignments: [],
  });
  expect(await getSpaceHistory("c1", "b1", signal)).toEqual({
    customerId: "c1",
    reservations: [],
    assignments: [],
  });
  expect(api).toHaveBeenCalledWith("/customers/c1/space-history?scope=b1", {
    signal,
  });
  vi.mocked(api).mockResolvedValue({
    customerId: "c2",
    reservations: [],
    assignments: [],
  });
  await expect(getSpaceHistory("c1", "b1", signal)).rejects.toThrow();
});
it("rejects a space row of another customer, a foreign scope and duplicate IDs", async () => {
  const reservation = {
    id: "r1",
    version: 1,
    branchId: "b1",
    status: " 확정".trim(),
    room: { id: "room1", roomNo: "A", name: "룸" },
    customer: { id: "c1", memberNo: "C1", name: "고객" },
    startAt: "2026-11-01T00:00:00Z",
    endAt: "2026-11-01T01:00:00Z",
    billing: null,
    usage: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdBy: { id: "owner", name: "사장님" },
    createdAt: "2026-11-01T00:00:00Z",
    canCancel: false,
  };
  const value = {
    customerId: "c1",
    reservations: [reservation],
    assignments: [],
  };
  vi.mocked(api).mockResolvedValue(value);
  expect((await getSpaceHistory("c1", "b1", signal)).reservations).toHaveLength(
    1,
  );
  for (const reservations of [
    [{ ...reservation, branchId: "b2" }],
    [{ ...reservation, customer: { ...reservation.customer, id: "c2" } }],
    [reservation, reservation],
  ]) {
    vi.mocked(api).mockResolvedValue({ ...value, reservations });
    await expect(getSpaceHistory("c1", "b1", signal)).rejects.toMatchObject({
      detail: { code: "INVALID_RESPONSE" },
    });
  }
});
it("allows a serving manager by role, or a staff grant, including a stopped branch but never a revoked membership", () => {
  const user = structuredClone(
    new MockStore(false).db.employees.find((u) => !u.owner)!,
  );
  user.status = "활성";
  user.memberships = [
    { branchId: "b1", role: "admin", permissions: [], status: "활성" },
  ];
  expect(canReadCrossBranch(user, "b1")).toBe(true);
  expect(canReadCrossBranch(user, "all")).toBe(false);
  expect(canReadCrossBranch(user, "b2")).toBe(false);
  user.memberships[0].role = "staff";
  expect(canReadCrossBranch(user, "b1")).toBe(false);
  user.memberships[0].permissions = ["customers:cross-branch-read"];
  expect(canReadCrossBranch(user, "b1")).toBe(true);
  user.memberships[0].status = "회수";
  expect(canReadCrossBranch(user, "b1")).toBe(false);
});
