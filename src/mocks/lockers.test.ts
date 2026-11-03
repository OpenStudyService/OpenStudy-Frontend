import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import { setupServer } from "msw/node";
import type { components } from "../shared/api/foundation.generated";
import { lockerHandlers } from "./lockers";
import { paymentHandlers } from "./payments";
import { MockStore, store } from "./store";
type Assignment = components["schemas"]["LockerAssignment"];
const server = setupServer(...lockerHandlers, ...paymentHandlers);
beforeAll(() => server.listen());
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
beforeEach(() => {
  store.reset();
  store.persona = "owner";
  store.scenario = "normal";
});
function request(
  path: string,
  method = "GET",
  body?: object,
  key = crypto.randomUUID(),
) {
  return fetch(new URL(`/api${path}`, window.location.origin), {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": "openstudy-mock-csrf",
      "Idempotency-Key": key,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
const input = (over: object = {}) => ({
  branchId: "gangnam",
  lockerId: "gangnam-locker-1",
  customerId: "member-1",
  startDate: "2026-10-17",
  endDate: "2026-11-14",
  method: "카드",
  mockOutcome: "APPROVED",
  ...over,
});
async function assign(over: object = {}): Promise<Assignment> {
  const r = await request("/locker-assignments", "POST", input(over));
  expect(r.status).toBe(201);
  return r.json();
}
const detail = (id = "gangnam-locker-1") =>
  request(`/lockers/${id}`).then((r) => r.json());

it("persists canonical locker settings and replays create after reload while preserving no-op versions", async () => {
  const body = {
      branchId: "gangnam",
      lockerNo: "L-09",
      ratePer4WeeksKrw: 17000,
    },
    key = crypto.randomUUID();
  const first = await (await request("/lockers", "POST", body, key)).json();
  expect((await request("/lockers", "POST", body, key)).status).toBe(201);
  expect(store.db.lockers.filter((l) => l.id === first.id)).toHaveLength(1);
  expect(
    (await request("/lockers", "POST", { ...body, ratePer4WeeksKrw: 1 }, key))
      .status,
  ).toBe(409);
  const unchanged = await (
    await request(`/lockers/${first.id}`, "PATCH", {
      version: first.version,
      lockerNo: first.lockerNo,
    })
  ).json();
  expect(unchanged.version).toBe(first.version);
  expect(
    (await request(`/lockers/${first.id}`, "PATCH", { version: first.version }))
      .status,
  ).toBe(422);
  expect(
    (
      await request(`/lockers/${first.id}`, "PATCH", {
        version: first.version,
        status: "운영 중단",
      })
    ).status,
  ).toBe(422);
  const saved = new MockStore(true);
  expect(saved.get("lockers", first.id).canonical?.ratePer4WeeksKrw).toBe(
    17000,
  );
  expect(
    Object.values(saved.idempotency).some(
      (v) => (v.result as { id?: string }).id === first.id,
    ),
  ).toBe(true);
});

it("charges the server amount once on concurrent replay and exposes the shared payment without a pass", async () => {
  const key = crypto.randomUUID(),
    before = store.db.payments.length;
  const responses = await Promise.all([
    request("/locker-assignments", "POST", input(), key),
    request("/locker-assignments", "POST", input(), key),
  ]);
  expect(responses.map((r) => r.status)).toEqual([201, 201]);
  const [a, b] = await Promise.all(
    responses.map((r) => r.json() as Promise<Assignment>),
  );
  expect(b).toEqual(a);
  expect(store.db.payments).toHaveLength(before + 1);
  expect(a.charges?.[0]).toMatchObject({
    amountKrw: 10000,
    ratePer4WeeksKrw: 10000,
    terms: 1,
    status: "적용",
  });
  const payment = await (
    await request(`/payments/${a.charges![0].paymentId}`)
  ).json();
  expect(payment).toMatchObject({
    purpose: "사물함",
    lockerAssignmentId: a.id,
    passId: null,
    canRefund: false,
    amountKrw: 10000,
  });
  const list = await (await request("/payments?customerId=member-1")).json();
  expect(list.items.some((p: { id: string }) => p.id === payment.id)).toBe(
    true,
  );
  expect(
    (
      await request(`/payments/${payment.id}/refund`, "POST", {
        reason: "조기 반납",
      })
    ).status,
  ).toBe(409);
  expect(
    (await request("/locker-assignments", "POST", input({ amountKrw: 1 })))
      .status,
  ).toBe(422);
  expect((await detail()).activeAssignment.id).toBe(a.id);
});

it("keeps future periods available, allows touching half-open dates, and distinguishes period and version conflicts", async () => {
  const first = await assign({
    startDate: "2026-10-18",
    endDate: "2026-11-15",
  });
  expect((await detail()).assignmentState).toBe("사용 가능");
  const adjacent = await assign({
    startDate: "2026-11-15",
    endDate: "2026-12-13",
  });
  expect(adjacent.status).toBe("배정");
  const overlap = await request(
    "/locker-assignments",
    "POST",
    input({ startDate: "2026-10-19", endDate: "2026-11-16" }),
  );
  expect(overlap.status).toBe(409);
  expect(await overlap.json()).toMatchObject({
    code: "LOCKER_PERIOD_CONFLICT",
  });
  const badVersion = await request(
    `/locker-assignments/${first.id}/extend`,
    "POST",
    { version: 99, endDate: "2026-12-13", method: "카드" },
  );
  expect(await badVersion.json()).toMatchObject({
    code: "VERSION_CONFLICT",
    latestVersion: first.version,
    reloadUrl: `/api/locker-assignments/${first.id}`,
  });
  const invalid = await request(
    "/locker-assignments",
    "POST",
    input({ lockerId: "gangnam-locker-2", endDate: "2026-11-13" }),
  );
  expect(invalid.status).toBe(422);
  expect(await invalid.json()).toMatchObject({ code: "LOCKER_TERM_INVALID" });
});

it("snapshots each approved extension at the current rate and replays before its stale version check", async () => {
  const a = await assign(),
    key = crypto.randomUUID();
  await request("/branches/gangnam/locker-rate", "POST", {
    ratePer4WeeksKrw: 17000,
  });
  const body = {
    version: a.version,
    endDate: "2026-12-12",
    method: "현금",
    mockOutcome: "APPROVED",
  };
  const extended = await (
    await request(`/locker-assignments/${a.id}/extend`, "POST", body, key)
  ).json();
  expect(extended.version).toBe(a.version + 1);
  expect(
    extended.charges.map((c: { amountKrw: number }) => c.amountKrw),
  ).toEqual([10000, 17000]);
  expect(
    await (
      await request(`/locker-assignments/${a.id}/extend`, "POST", body, key)
    ).json(),
  ).toEqual(extended);
  const persisted = new MockStore(true).get("lockers", "gangnam-locker-1")
    .assignments![0];
  expect(persisted.endDate).toBe("2026-12-12");
  expect(persisted.charges).toHaveLength(2);
});

it("records failed assignment and extension as successful HTTP outcomes without holding or changing the paid period", async () => {
  const failed = await assign({ mockOutcome: "FAILED" });
  expect(failed.status).toBe("결제 실패");
  expect(failed.charges![0].status).toBe("실패");
  expect((await detail()).assignmentState).toBe("사용 가능");
  const a = await assign(),
    response = await request(`/locker-assignments/${a.id}/extend`, "POST", {
      version: a.version,
      endDate: "2026-12-12",
      method: "카드",
      mockOutcome: "FAILED",
    });
  expect(response.status).toBe(200);
  const extended = await response.json();
  expect(extended).toMatchObject({
    version: a.version,
    endDate: a.endDate,
    status: "배정",
  });
  expect(extended.charges.at(-1).status).toBe("실패");
});

it("keeps blocked assignments visible, counts them only blocked, and permits member return without refund on stopped branches", async () => {
  const a = await assign(),
    l = await detail();
  await request(`/lockers/${l.id}/status`, "POST", {
    version: l.version,
    status: "운영 중단",
    reason: "문 수리",
  });
  expect(await detail()).toMatchObject({
    assignmentState: "운영 중단",
    activeAssignment: { id: a.id },
  });
  const counts = await (
    await request("/lockers/occupancy?scope=gangnam")
  ).json();
  expect(counts.items[0]).toMatchObject({
    total: 8,
    inUse: 0,
    available: 7,
    blocked: 1,
    overdue: 0,
  });
  store.get("branches", "gangnam").status = "운영 중지";
  store.persona = "junho";
  store.user().memberships[0].permissions = [];
  const redacted = await (await request(`/locker-assignments/${a.id}`)).json();
  expect(redacted.charges).toBeNull();
  const returned = await (
    await request(`/locker-assignments/${a.id}/return`, "POST", {
      version: a.version,
      reason: "조기 반납",
    })
  ).json();
  expect(returned).toMatchObject({
    status: "반납",
    endDate: a.endDate,
    charges: null,
    lastChangedBy: { id: "junho" },
  });
  expect(store.get("payments", a.charges![0].paymentId).status).toBe("승인");
});

it("refuses overdue reassignment until return and reconciles occupancy at the Korea business day", async () => {
  const a = await assign();
  vi.spyOn(store, "now").mockReturnValue("2026-11-13T15:00:00Z");
  expect(await detail()).toMatchObject({
    assignmentState: "사용 중",
    activeAssignment: { overdue: true },
  });
  const r = await request(
    "/locker-assignments",
    "POST",
    input({ startDate: "2026-11-14", endDate: "2026-12-12" }),
  );
  expect(r.status).toBe(409);
  expect(await r.json()).toMatchObject({ code: "LOCKER_NOT_RETURNED" });
  await request(`/locker-assignments/${a.id}/return`, "POST", {
    version: a.version,
  });
  expect(
    (
      await request(
        "/locker-assignments",
        "POST",
        input({ startDate: "2026-11-14", endDate: "2026-12-12" }),
      )
    ).status,
  ).toBe(201);
});

it("rechecks present permissions before replay, hides other branch detail, and returns empty branch counts", async () => {
  store.persona = "junho";
  store.user().memberships[0].permissions = ["payments:write"];
  const key = crypto.randomUUID(),
    first = await request("/locker-assignments", "POST", input(), key);
  expect(first.status).toBe(201);
  store.user().memberships[0].permissions = [];
  expect(
    (await request("/locker-assignments", "POST", input(), key)).status,
  ).toBe(403);
  expect((await request("/lockers/seongsu-locker-1")).status).toBe(404);
  store.persona = "owner";
  store.db.lockers = store.db.lockers.filter((l) => l.branchId !== "seongsu");
  const result = await (
    await request("/lockers/occupancy?scope=seongsu")
  ).json();
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({
    branchId: "seongsu",
    total: 0,
    available: 0,
    blocked: 0,
    inUse: 0,
  });
});

it("bulk rate applies to blocked lockers and bumps every version even at an identical rate, once per key", async () => {
  const key = crypto.randomUUID(),
    l = await detail();
  const b = { ratePer4WeeksKrw: 10000 };
  expect(
    await (
      await request("/branches/gangnam/locker-rate", "POST", b, key)
    ).json(),
  ).toMatchObject({ updated: 8 });
  expect((await detail()).version).toBe(l.version + 1);
  await request("/branches/gangnam/locker-rate", "POST", b, key);
  expect((await detail()).version).toBe(l.version + 1);
});
