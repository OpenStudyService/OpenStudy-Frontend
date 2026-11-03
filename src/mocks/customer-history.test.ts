import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { setupServer } from "msw/node";
import {
  customerHistoryHandlers,
  summaryInteractions,
} from "./customer-history";
import { customerHandlers } from "./customers";
import { lockerHandlers } from "./lockers";
import { store } from "./store";
const server = setupServer(
  ...customerHistoryHandlers,
  ...customerHandlers,
  ...lockerHandlers,
);
beforeAll(() => server.listen());
afterAll(() => server.close());
beforeEach(() => {
  store.reset();
  store.persona = "owner";
  store.scenario = "normal";
});
const request = (path: string, body?: object) =>
  fetch(new URL(`/api${path}`, window.location.origin), {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": "openstudy-mock-csrf",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
it("records each explicit reason and returns only the minimum fields without widening customer visibility", async () => {
  const staff = store.db.employees.find((u) => !u.owner)!;
  staff.status = "활성";
  staff.memberships = [
    {
      branchId: "gangnam",
      role: "staff",
      status: "활성",
      permissions: ["customers:cross-branch-read"],
    },
  ];
  store.persona = staff.id;
  const foreign = store.db.members[0];
  foreign.branchId = "hongdae";
  foreign.registeredBranchId = "hongdae";
  store.db.payments = store.db.payments.filter(
    (p) => p.memberId !== foreign.id,
  );
  store.db.passes = store.db.passes.filter((p) => p.memberId !== foreign.id);
  expect((await request(`/customers/${foreign.id}?scope=gangnam`)).status).toBe(
    404,
  );
  for (let i = 0; i < 2; i++) {
    const r = await request(`/customers/${foreign.id}/cross-branch-summary`, {
      branchId: "gangnam",
      reason: "고객 상담",
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(Object.keys(body).sort()).toEqual([
      "asOf",
      "customerId",
      "passes",
      "usages",
    ]);
    for (const row of body.usages)
      expect(Object.keys(row).sort()).toEqual([
        "branchId",
        "endAt",
        "kind",
        "startAt",
      ]);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
  }
  expect(summaryInteractions()).toHaveLength(2);
  expect(summaryInteractions()[0]).toMatchObject({
    reason: "고객 상담",
    actorId: staff.id,
  });
  expect((await request(`/customers/${foreign.id}?scope=gangnam`)).status).toBe(
    404,
  );
  expect(
    (await request(`/customers/${foreign.id}/space-history?scope=gangnam`))
      .status,
  ).toBe(404);
});
it("checks role and current membership before customer existence, permits managers without the grant, and rejects malformed reasons", async () => {
  const staff = store.db.employees.find((u) => !u.owner)!;
  staff.status = "활성";
  staff.memberships = [
    { branchId: "gangnam", role: "staff", status: "활성", permissions: [] },
  ];
  store.persona = staff.id;
  const path = "/customers/member-1/cross-branch-summary";
  const body = { branchId: "gangnam", reason: "상담" };
  expect((await request(path, body)).status).toBe(403);
  expect(
    (await request("/customers/absent/cross-branch-summary", body)).status,
  ).toBe(403);
  staff.memberships[0].role = "admin";
  expect((await request(path, body)).status).toBe(200);
  expect((await request(path, { ...body, reason: " " })).status).toBe(422);
  expect((await request(path, { ...body, unexpected: true })).status).toBe(422);
  staff.memberships[0].status = "회수";
  expect((await request(path, body)).status).toBe(403);
});
it("shares assignment charges with the locker ledger and redacts them for an ordinary active member", async () => {
  const response = await request("/locker-assignments", {
    branchId: "gangnam",
    lockerId: "gangnam-locker-1",
    customerId: "member-1",
    startDate: "2026-10-17",
    endDate: "2026-11-14",
    method: "카드",
  });
  expect(response.status).toBe(201);
  const assignment = await response.json();
  const owner = await (
    await request("/customers/member-1/space-history?scope=gangnam")
  ).json();
  expect(
    owner.assignments.find((a: { id: string }) => a.id === assignment.id)
      .charges,
  ).toEqual(assignment.charges);
  const staff = store.db.employees.find((u) => !u.owner)!;
  staff.status = "활성";
  staff.memberships = [
    { branchId: "gangnam", role: "staff", status: "활성", permissions: [] },
  ];
  store.persona = staff.id;
  const hidden = await (
    await request("/customers/member-1/space-history?scope=gangnam")
  ).json();
  expect(hidden.assignments[0].charges).toBeNull();
  expect(
    hidden.reservations.every(
      (r: { branchId: string; billing: unknown }) =>
        r.branchId === "gangnam" && r.billing === null,
    ),
  ).toBe(true);
});
