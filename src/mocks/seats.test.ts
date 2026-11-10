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
import { handlers } from "./handlers";
import { store } from "./store";
import type { components } from "../shared/api/foundation.generated";

const server = setupServer(...handlers);
beforeAll(() => server.listen());
beforeEach(() => {
  store.reset();
  store.persona = "owner";
  store.scenario = "normal";
});
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
  store.scenario = "normal";
  store.reset();
});
afterAll(() => {
  server.close();
  vi.unstubAllGlobals();
});

type Session = components["schemas"]["SeatSession"];

it("returns zero and unavailable seat occupancy as separate ratio states", async () => {
  vi.spyOn(store, "now").mockReturnValue("2026-11-10T01:00:00.000Z");
  store.db.usage = [];
  const result = await request("/seats/occupancy-trend?branchId=gangnam");
  expect(result.status).toBe(200);
  const trend =
    (await result.json()) as components["schemas"]["SeatOccupancyTrend"];
  expect(trend.items).toHaveLength(24);
  expect(trend.items[0].occupancy).toMatchObject({
    state: "value",
    percent: 0,
  });
  expect(trend.items.at(-1)?.occupancy).toMatchObject({
    state: "notApplicable",
    percent: null,
  });
  expect(trend.totals.occupancy.state).toBe("value");
  const daily = await (
    await request("/seats/occupancy-trend?branchId=gangnam&granularity=day")
  ).json();
  expect(daily.items).toHaveLength(1);
  expect(daily.items[0]).toMatchObject({ label: "2026-11-10", partial: true });
});
async function request(
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
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function checkIn(seatId = "gangnam-seat-1", memberId = "member-2") {
  const pass = store.db.passes.find(
    (p) => p.memberId === memberId && p.status === "활성",
  )!;
  const response = await request("/seat-sessions", "POST", {
    seatId,
    customerId: memberId,
    passId: pass.id,
  });
  expect(response.status).toBe(201);
  return (await response.json()) as Session;
}

it("serves canonical seats before generic resources and keeps board counts atomic", async () => {
  const board = await (await request("/seats/board?branchId=gangnam")).json();
  const seats = board.zones.flatMap((z: { seats: unknown[] }) => z.seats);
  expect(seats).toHaveLength(32);
  expect(board.counts).toMatchObject({
    branchId: "gangnam",
    total: 32,
    inUse: 1,
    available: 30,
    blocked: 1,
    occupancyRate: 3.1,
  });
  expect(
    seats.find((s: { id: string }) => s.id === "gangnam-seat-12"),
  ).toMatchObject({
    seatNo: "A-12",
    kind: "일반",
    status: "사용 중",
    activeSession: { id: "usage-seed", customer: { id: "member-1" } },
  });
  const occupancy = await (await request("/seats/occupancy")).json();
  expect(occupancy.items[0].asOf).toBe(occupancy.items[1].asOf);
  const list = await (
    await request("/seats?scope=gangnam&status=사용 중")
  ).json();
  expect(list.meta.total).toBe(1);
  expect(list.items[0].activeSession.customer).not.toHaveProperty("phone");
});

it("calculates filtered board counts and represents a zero-seat branch with a null rate", async () => {
  const created = await (
    await request("/seats?scope=gangnam", "POST", {
      branchId: "gangnam",
      zone: " 모니터존 ",
      seatNo: " M-01 ",
      kind: "모니터",
      status: "운영 중단",
    })
  ).json();
  expect(created).toMatchObject({
    zone: "모니터존",
    seatNo: "M-01",
    kind: "모니터",
    status: "운영 중단",
  });
  const board = await (
    await request("/seats/board?branchId=gangnam&kind=모니터")
  ).json();
  expect(board.counts).toMatchObject({
    total: 1,
    blocked: 1,
    available: 0,
    inUse: 0,
    occupancyRate: 0,
  });
  const empty = await (
    await request("/seats/board?branchId=seongsu&kind=기타")
  ).json();
  expect(empty).toMatchObject({
    counts: { total: 0, occupancyRate: null },
    zones: [],
  });
});

it("requires same-branch membership, write permission, and manager status separately", async () => {
  store.persona = "junho";
  expect((await request("/seats/gangnam-seat-1?scope=gangnam")).status).toBe(
    200,
  );
  expect((await request("/seats/seongsu-seat-1")).status).toBe(404);
  expect((await request("/seats?scope=seongsu")).status).toBe(403);
  expect(
    (await request("/seats/gangnam-seat-1", "PATCH", { version: 1, zone: "A" }))
      .status,
  ).toBe(403);
  const actor = store.user();
  actor.memberships[0].permissions.push("operations:write");
  expect(
    (await request("/seats/gangnam-seat-1", "PATCH", { version: 1, zone: "A" }))
      .status,
  ).toBe(200);
  expect(
    (
      await request("/seats/gangnam-seat-1/status", "POST", {
        version: 2,
        status: "운영 중단",
        reason: "점검",
      })
    ).status,
  ).toBe(403);
  actor.memberships[0].role = "admin";
  expect(
    (
      await request("/seats/gangnam-seat-1/status", "POST", {
        version: 2,
        status: "운영 중단",
        reason: "점검",
      })
    ).status,
  ).toBe(200);
  actor.memberships[0].status = "회수";
  expect((await request("/seats/gangnam-seat-1")).status).toBe(404);
});

it("rejects duplicate numbers, immutable status, stale versions and blocking occupied seats", async () => {
  expect(
    (
      await request("/seats", "POST", {
        branchId: "gangnam",
        zone: "A",
        seatNo: "A-01",
        kind: "일반",
      })
    ).status,
  ).toBe(409);
  const stale = await request("/seats/gangnam-seat-1", "PATCH", {
    version: 9,
    zone: "A",
  });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({
    code: "VERSION_CONFLICT",
    latestVersion: 1,
    reloadUrl: "/api/seats/gangnam-seat-1",
  });
  expect(
    await (
      await request("/seats/gangnam-seat-1", "PATCH", {
        version: 1,
        status: "운영 중단",
      })
    ).json(),
  ).toMatchObject({ code: "IMMUTABLE_FIELD" });
  expect(
    await (
      await request("/seats/gangnam-seat-12/status", "POST", {
        version: 1,
        status: "운영 중단",
        reason: "점검",
      })
    ).json(),
  ).toMatchObject({ code: "SEAT_OCCUPIED" });
});

it("uses exact body-only lookup without broadening customer or pass visibility", async () => {
  store.persona = "junho";
  const member = store.get("members", "member-5");
  const pass = store.db.passes.find((p) => p.memberId === member.id)!;
  pass.status = "활성";
  pass.expiresAt = "";
  pass.remaining = 90;
  expect((await request(`/customers/${member.id}?scope=gangnam`)).status).toBe(
    404,
  );
  const lookup = await request("/customer-lookups/check-in", "POST", {
    branchId: "gangnam",
    phone: member.phone,
  });
  expect(lookup.status).toBe(200);
  const result = await lookup.json();
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({
    customer: { id: member.id, memberNo: `DEMO-${member.id}` },
    usablePasses: [{ id: pass.id, purchaseBranchId: "seongsu" }],
  });
  expect(JSON.stringify(result)).not.toContain(member.phone);
  expect(JSON.stringify(result)).not.toContain(member.email);
  expect((await request(`/customers/${member.id}?scope=gangnam`)).status).toBe(
    404,
  );
  expect((await request(`/passes/${pass.id}?scope=gangnam`)).status).toBe(404);
  const partial = await (
    await request("/customer-lookups/check-in", "POST", {
      branchId: "gangnam",
      memberNo: "DEMO-member",
    })
  ).json();
  expect(partial.items).toEqual([]);
  expect(
    (
      await request("/customer-lookups/check-in", "POST", {
        branchId: "gangnam",
        memberNo: `DEMO-${member.id}`,
        phone: member.phone,
      })
    ).status,
  ).toBe(422);
});

it("lets ordinary staff check in a customer with an other-branch pass and check out after branch shutdown", async () => {
  store.persona = "junho";
  const member = store.get("members", "member-5"),
    pass = store.db.passes.find((p) => p.memberId === member.id)!;
  pass.status = "활성";
  pass.expiresAt = "";
  pass.remaining = 120;
  const start = "2026-10-17T01:00:00.000Z";
  vi.spyOn(store, "now").mockReturnValue(start);
  const session = await checkIn("gangnam-seat-1", member.id);
  expect(session.pass.purchaseBranchId).toBe("seongsu");
  expect((await request(`/seat-sessions/${session.id}`)).status).toBe(200);
  store.get("branches", "gangnam").status = "운영 중지";
  member.status = "이용 제한";
  vi.mocked(store.now).mockReturnValue("2026-10-17T02:30:20.000Z");
  const closed = await request(
    `/seat-sessions/${session.id}/check-out`,
    "POST",
    {},
  );
  expect(closed.status).toBe(200);
  const result = await closed.json();
  expect(result).toMatchObject({ status: "종료", usedMinutes: 91 });
  expect(store.get("seats", "gangnam-seat-1").status).toBe("이용 가능");
  expect(store.events.some((e) => e.resource === "seat-sessions")).toBe(true);
});

it("stores first checkout response for retries but nulls closed-session GET balances", async () => {
  const pass = store.db.passes.find((p) => p.memberId === "member-2")!;
  pass.kind = "시간권";
  pass.remaining = 120;
  pass.expiresAt = "";
  vi.spyOn(store, "now").mockReturnValue("2026-10-17T01:00:00.000Z");
  const session = await checkIn();
  vi.mocked(store.now).mockReturnValue("2026-10-17T02:30:20.000Z");
  const key = crypto.randomUUID(),
    first = await request(
      `/seat-sessions/${session.id}/check-out`,
      "POST",
      {},
      key,
    );
  expect(first.status).toBe(200);
  const result = await first.json();
  expect(result).toMatchObject({
    usedMinutes: 91,
    deductedMinutes: 91,
    passRemainingMinutes: 29,
  });
  const events = store.events.length;
  pass.remaining = 999;
  expect(
    await (
      await request(`/seat-sessions/${session.id}/check-out`, "POST", {}, key)
    ).json(),
  ).toEqual(result);
  expect(store.events).toHaveLength(events);
  expect(
    await (
      await request(`/seat-sessions/${session.id}/check-out`, "POST", {})
    ).json(),
  ).toMatchObject({ code: "SESSION_ALREADY_CLOSED" });
  expect(
    await (
      await request(
        `/seat-sessions/${session.id}/check-out`,
        "POST",
        { reason: "변경" },
        key,
      )
    ).json(),
  ).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  expect(
    await (await request(`/seat-sessions/${session.id}`)).json(),
  ).toMatchObject({ passRemainingMinutes: null, passRemainingCreditKrw: null });
  const list = await (
    await request(`/seat-sessions?status=종료&customerId=member-2`)
  ).json();
  expect(list.items[0]).toMatchObject({
    passRemainingMinutes: null,
    passRemainingCreditKrw: null,
    moves: [],
  });
});

it("moves once, preserves stay and pass, and returns the original result for same-key retry", async () => {
  const session = await checkIn(),
    key = crypto.randomUUID();
  const moved = await request(
    `/seat-sessions/${session.id}/move`,
    "POST",
    { toSeatId: "gangnam-seat-2", reason: "모니터" },
    key,
  );
  expect(moved.status).toBe(200);
  const result = await moved.json();
  expect(result).toMatchObject({
    id: session.id,
    checkedInAt: session.checkedInAt,
    pass: session.pass,
    seat: { id: "gangnam-seat-2" },
    moves: [
      {
        fromSeat: { id: "gangnam-seat-1" },
        toSeat: { id: "gangnam-seat-2" },
        reason: "모니터",
      },
    ],
  });
  const events = store.events.length;
  expect(
    await (
      await request(
        `/seat-sessions/${session.id}/move`,
        "POST",
        { toSeatId: "gangnam-seat-2", reason: "모니터" },
        key,
      )
    ).json(),
  ).toEqual(result);
  expect(store.events).toHaveLength(events);
  expect(store.get("seats", "gangnam-seat-1").status).toBe("이용 가능");
  expect(store.get("seats", "gangnam-seat-2").status).toBe("이용 중");
  expect(
    (
      await request(`/seat-sessions/${session.id}/move`, "POST", {
        toSeatId: "seongsu-seat-1",
      })
    ).status,
  ).toBe(422);
  store.persona = "junho";
  expect(
    (
      await request(`/seat-sessions/${session.id}/move`, "POST", {
        toSeatId: "gangnam-seat-3",
      })
    ).status,
  ).toBe(403);
});

it.each([
  ["시간권", 120, 0, "2026-10-17T01:30:30.000Z", 31, 0, 29, 0, 89],
  ["시간권", 10, 0, "", 10, 0, 50, 0, 0],
  ["정액권", 500, 1000, "", 0, 500, 0, 500, 0],
  ["정액권", 10000, 1000, "2026-10-17T01:30:30.000Z", 0, 517, 29, 0, 9483],
  ["기간권", 0, 0, "2026-10-17T01:30:30.000Z", 0, 0, 29, 0, 0],
] as const)(
  "settles %s using expiry, rounding and nonnegative balances",
  async (
    kind,
    balance,
    rate,
    expiry,
    minutes,
    krw,
    overageMinutes,
    overageKrw,
    remaining,
  ) => {
    const pass = store.db.passes.find((p) => p.memberId === "member-2")!;
    pass.kind = kind;
    pass.remaining = balance;
    pass.hourlyRate = rate;
    pass.expiresAt = expiry;
    vi.spyOn(store, "now").mockReturnValue("2026-10-17T01:00:00.000Z");
    const session = await checkIn();
    vi.mocked(store.now).mockReturnValue("2026-10-17T02:00:00.000Z");
    const closed = await request(
      `/seat-sessions/${session.id}/check-out`,
      "POST",
      {},
    );
    expect(closed.status).toBe(200);
    expect(await closed.json()).toMatchObject({
      usedMinutes: 60,
      deductedMinutes: minutes,
      deductedKrw: krw,
      overageMinutes,
      overageKrw,
    });
    expect(pass.remaining).toBe(remaining);
    if (kind !== "기간권" && remaining === 0) expect(pass.status).toBe("소진");
  },
);

it("replays check-in before occupancy checks and scopes idempotency by operation", async () => {
  const pass = store.db.passes.find((p) => p.memberId === "member-2")!,
    key = crypto.randomUUID(),
    body = {
      seatId: "gangnam-seat-1",
      customerId: "member-2",
      passId: pass.id,
    };
  const first = await request("/seat-sessions", "POST", body, key),
    original = await first.json();
  expect(first.status).toBe(201);
  expect(
    await (await request("/seat-sessions", "POST", body, key)).json(),
  ).toEqual(original);
  expect(store.db.usage.filter((u) => u.memberId === "member-2")).toHaveLength(
    1,
  );
  expect(
    await (
      await request(
        "/seat-sessions",
        "POST",
        { ...body, reason: "different" },
        key,
      )
    ).json(),
  ).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  expect(
    (await request(`/seat-sessions/${original.id}/check-out`, "POST", {}, key))
      .status,
  ).toBe(200);
});

it("preserves canonical kind and session metadata in a restored shared ledger", async () => {
  const created = await (
    await request("/seats", "POST", {
      branchId: "gangnam",
      zone: "M",
      seatNo: "M-1",
      kind: "모니터",
    })
  ).json();
  const session = await checkIn();
  await request(`/seat-sessions/${session.id}/move`, "POST", {
    toSeatId: created.id,
    reason: "자리 변경",
  });
  // A browser reload restores plain JSON, not object identity or WeakMap entries.
  store.db = JSON.parse(JSON.stringify(store.db));
  expect(await (await request(`/seats/${created.id}`)).json()).toMatchObject({
    kind: "모니터",
    status: "사용 중",
  });
  expect(
    await (await request(`/seat-sessions/${session.id}`)).json(),
  ).toMatchObject({
    checkedInBy: { id: "owner" },
    moves: [{ toSeat: { id: created.id }, reason: "자리 변경" }],
  });
});

it.each([
  ["blocked", "SEAT_BLOCKED"],
  ["occupied", "SEAT_OCCUPIED"],
  ["refunded", "PASS_REFUNDED"],
  ["expired", "PASS_EXPIRED"],
  ["exhausted", "PASS_EXHAUSTED"],
  ["customer", "CUSTOMER_NOT_ACTIVE"],
])(
  "rejects %s check-in without changing any ledger",
  async (condition, code) => {
    const pass = store.db.passes.find((p) => p.memberId === "member-2")!;
    let seatId = "gangnam-seat-1";
    if (condition === "blocked") seatId = "gangnam-seat-16";
    if (condition === "occupied") seatId = "gangnam-seat-12";
    if (condition === "refunded") pass.status = "환불";
    if (condition === "expired") pass.expiresAt = "2020-01-01T00:00:00Z";
    if (condition === "exhausted") {
      pass.kind = "시간권";
      pass.remaining = 0;
    }
    if (condition === "customer")
      store.get("members", "member-2").status = "이용 제한";
    const before = structuredClone(store.db);
    const response = await request("/seat-sessions", "POST", {
      seatId,
      customerId: "member-2",
      passId: pass.id,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code });
    expect(store.db).toEqual(before);
  },
);

it("checks CSRF and active authorization before replaying a successful key", async () => {
  const key = crypto.randomUUID(),
    body = { branchId: "gangnam", zone: "C", seatNo: "C-01", kind: "일반" };
  expect((await request("/seats", "POST", body, key)).status).toBe(201);
  const noCsrf = await fetch(new URL("/api/seats", window.location.origin), {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
  expect(noCsrf.status).toBe(403);
  store.persona = "minji";
  expect(
    (await request("/seats", "POST", { ...body, seatNo: "C-02" }, key)).status,
  ).toBe(201);
  store.user().memberships[0].permissions = [];
  expect(
    (await request("/seats", "POST", { ...body, seatNo: "C-02" }, key)).status,
  ).toBe(403);
});

it("looks up the target and allows it to check in with an absorbed customer's pass", async () => {
  const absorbed = store.get("members", "member-2");
  const target = store.get("members", "member-3");
  target.status = "정상";
  const pass = store.db.passes.find(
    (row) => row.memberId === absorbed.id && row.status === "활성",
  )!;
  expect(pass).toBeDefined();
  const merge = await request(`/customers/${target.id}/merge`, "POST", {
    version: target.version,
    absorbedCustomerId: absorbed.id,
    absorbedVersion: absorbed.version,
    reason: "중복 등록",
  });
  expect(merge.status).toBe(200);
  const lookup = await request("/customer-lookups/check-in", "POST", {
    branchId: "gangnam",
    phone: absorbed.phone.replace(/[\s-]/g, ""),
  });
  expect(lookup.status).toBe(200);
  expect((await lookup.json()).items).toEqual([
    expect.objectContaining({
      customer: expect.objectContaining({ id: target.id }),
      usablePasses: expect.arrayContaining([
        expect.objectContaining({ id: pass.id }),
      ]),
    }),
  ]);
  const checkIn = {
    seatId: "gangnam-seat-1",
    customerId: absorbed.id,
    passId: pass.id,
  };
  const denied = await request("/seat-sessions", "POST", checkIn);
  expect(denied.status).toBe(409);
  expect(await denied.json()).toMatchObject({
    code: "CUSTOMER_NOT_ACTIVE",
    mergedIntoCustomerId: target.id,
  });

  const result = await request("/seat-sessions", "POST", {
    ...checkIn,
    customerId: target.id,
  });
  expect(result.status).toBe(201);
  expect(await result.json()).toMatchObject({
    customer: { id: target.id },
    pass: { id: pass.id },
  });
  expect(store.get("passes", pass.id).memberId).toBe(absorbed.id);
});
