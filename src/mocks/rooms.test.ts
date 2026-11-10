import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { closureHandlers } from "./closures";
import { roomHandlers } from "./rooms";
import { store } from "./store";
const server = setupServer(...roomHandlers, ...closureHandlers);
beforeAll(() => server.listen());
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
beforeEach(() => {
  store.reset();
  store.persona = "owner";
  store.scenario = "normal";
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
    body: body ? JSON.stringify(body) : undefined,
  });
}
const input = (over: object = {}) => ({
  branchId: "gangnam",
  roomId: "gangnam-room-a",
  customerId: "member-1",
  startAt: "2026-10-18T01:00:00Z",
  endAt: "2026-10-18T03:00:00Z",
  partySize: 2,
  method: "카드",
  ...over,
});
async function create(over: object = {}, key = crypto.randomUUID()) {
  const response = await request(
    "/room-reservations?scope=gangnam",
    "POST",
    input(over),
    key,
  );
  expect(response.status, await response.clone().text()).toBe(201);
  return response.json();
}
it("room management uses canonical fields, prevents duplicate numbers and enforces branch write permissions", async () => {
  const body = {
    branchId: "gangnam",
    roomNo: "C",
    name: "새 룸",
    capacity: 5,
    ratePerHourKrw: 9000,
  };
  const key = crypto.randomUUID();
  const response = await request("/rooms?scope=gangnam", "POST", body, key);
  expect(response.status).toBe(201);
  const row = await response.json();
  expect(row).toMatchObject({ ...body, status: "사용 가능", version: 1 });
  expect(
    await (await request("/rooms?scope=gangnam", "POST", body, key)).json(),
  ).toEqual(row);
  expect((await request("/rooms?scope=gangnam", "POST", body)).status).toBe(
    409,
  );
  store.persona = "junho";
  expect(
    (
      await request(`/rooms/${row.id}?scope=gangnam`, "PATCH", {
        version: row.version,
        name: "denied",
      })
    ).status,
  ).toBe(403);
  expect((await request("/rooms/seongsu-room-a?scope=gangnam")).status).toBe(
    404,
  );
});
it("server-computed booking billing is a snapshot while room labels stay current", async () => {
  const row = await create();
  expect(row).toMatchObject({
    status: "확정",
    billing: {
      amountKrw: 16000,
      hours: 2,
      ratePerHourKrw: 8000,
      paymentStatus: "승인",
    },
    canCancel: true,
  });
  const room = await (
    await request("/rooms/gangnam-room-a?scope=gangnam")
  ).json();
  expect(
    (
      await request(`/rooms/${room.id}?scope=gangnam`, "PATCH", {
        version: room.version,
        name: "새 이름",
        ratePerHourKrw: 10000,
      })
    ).status,
  ).toBe(200);
  const latest = await (
    await request(`/room-reservations/${row.id}?scope=gangnam`)
  ).json();
  expect(latest).toMatchObject({
    room: { name: "새 이름" },
    billing: { amountKrw: 16000, ratePerHourKrw: 8000 },
  });
});
it("input errors differ from overlap conflicts and rejected overlap leaves no extra payment", async () => {
  expect(
    (
      await request(
        "/room-reservations?scope=gangnam",
        "POST",
        input({ startAt: "2026-10-18T01:30:00Z" }),
      )
    ).status,
  ).toBe(422);
  await create();
  const paymentCount = store.db.payments.length;
  const response = await request(
    "/room-reservations?scope=gangnam",
    "POST",
    input(),
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: "ROOM_TIME_CONFLICT" });
  expect(store.db.payments).toHaveLength(paymentCount);
});
it("booking response loss retries one payment and failed Mock payment holds no slot", async () => {
  const key = crypto.randomUUID(),
    first = await create({}, key),
    again = await create({}, key);
  expect(again).toEqual(first);
  expect(
    store.db.payments.filter((p) => p.reservationId === first.id),
  ).toHaveLength(1);
  const failed = await create({
    roomId: "gangnam-room-b",
    mockOutcome: "FAILED",
  });
  expect(failed).toMatchObject({
    status: "결제 실패",
    canCancel: false,
    billing: { paymentStatus: "실패" },
  });
  const later = await create({ roomId: "gangnam-room-b" });
  expect(later.status).toBe("확정");
});
it("cancellation retries reuse the original result and refund while a new booking gets a new record", async () => {
  const row = await create(),
    key = crypto.randomUUID(),
    body = { version: row.version, reason: "고객 요청" };
  const first = await request(
    `/room-reservations/${row.id}/cancel?scope=gangnam`,
    "POST",
    body,
    key,
  );
  expect(first.status).toBe(200);
  const cancelled = await first.json();
  expect(cancelled).toMatchObject({
    status: "취소",
    canCancel: false,
    cancelReason: "고객 요청",
    billing: { paymentStatus: "환불" },
  });
  expect(
    await (
      await request(
        `/room-reservations/${row.id}/cancel?scope=gangnam`,
        "POST",
        body,
        key,
      )
    ).json(),
  ).toEqual(cancelled);
  expect(
    store.db.payments.filter(
      (p) => p.reservationId === row.id && p.status === "환불",
    ),
  ).toHaveLength(1);
  const rebooked = await create();
  expect(rebooked.id).not.toBe(row.id);
  expect(rebooked.billing.paymentId).not.toBe(cancelled.billing.paymentId);
});
it("ordinary staff can start and complete, cannot cancel, and never sees billing", async () => {
  const row = await create();
  store.persona = "junho";
  const current = await (
    await request(`/room-reservations/${row.id}?scope=gangnam`)
  ).json();
  expect(current).toMatchObject({ billing: null, canCancel: false });
  expect(
    (
      await request(
        `/room-reservations/${row.id}/cancel?scope=gangnam`,
        "POST",
        { version: row.version, reason: "denied" },
      )
    ).status,
  ).toBe(403);
  const started = await (
    await request(`/room-reservations/${row.id}/start?scope=gangnam`, "POST", {
      version: row.version,
    })
  ).json();
  expect(started).toMatchObject({
    status: "이용 중",
    usage: { startedBy: { id: "junho" } },
    billing: null,
  });
  const completed = await (
    await request(
      `/room-reservations/${row.id}/complete?scope=gangnam`,
      "POST",
      { version: started.version },
    )
  ).json();
  expect(completed).toMatchObject({
    status: "완료",
    usage: { endedBy: { id: "junho" } },
    billing: null,
  });
  const calendar = await (
    await request(
      "/room-reservations/calendar?branchId=gangnam&from=2026-10-18T00:00:00Z&to=2026-10-19T00:00:00Z",
    )
  ).json();
  expect(calendar.items[0]).toEqual(completed);
  store.persona = "owner";
  expect(
    await (await request(`/room-reservations/${row.id}?scope=gangnam`)).json(),
  ).toMatchObject({ billing: { amountKrw: 16000, paymentStatus: "승인" } });
});
it("stale versions, stopped rooms, current uses and calendar ranges follow the contract", async () => {
  const first = await create(),
    second = await create({
      startAt: "2026-10-18T03:00:00Z",
      endAt: "2026-10-18T04:00:00Z",
    });
  expect(
    (
      await request(
        `/room-reservations/${first.id}/start?scope=gangnam`,
        "POST",
        { version: 9 },
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await request(
        `/room-reservations/${first.id}/start?scope=gangnam`,
        "POST",
        { version: first.version },
      )
    ).status,
  ).toBe(200);
  const overlap = await request(
    `/room-reservations/${second.id}/start?scope=gangnam`,
    "POST",
    { version: second.version },
  );
  expect(await overlap.json()).toMatchObject({ code: "ROOM_IN_USE" });
  const r = await (await request("/rooms/gangnam-room-b?scope=gangnam")).json();
  await request(`/rooms/${r.id}/status?scope=gangnam`, "POST", {
    version: r.version,
    status: "운영 중단",
    reason: "점검",
  });
  expect(
    (
      await request(
        "/room-reservations?scope=gangnam",
        "POST",
        input({ roomId: r.id }),
      )
    ).status,
  ).toBe(422);
  expect(
    (
      await request(
        "/room-reservations/calendar?branchId=gangnam&from=2026-10-01T00:00:00Z&to=2027-01-01T00:00:00Z",
      )
    ).status,
  ).toBe(422);
});

it("calendar excludes failed payments and sorts ascending while the list includes them", async () => {
  const failed = await create({ mockOutcome: "FAILED" });
  const second = await create({
    startAt: "2026-10-18T05:00:00Z",
    endAt: "2026-10-18T06:00:00Z",
  });
  const first = await create();
  const calendar = await (
    await request(
      "/room-reservations/calendar?branchId=gangnam&from=2026-10-18T00:00:00Z&to=2026-10-19T00:00:00Z",
    )
  ).json();
  expect(calendar.items.map((r: { id: string }) => r.id)).toEqual([
    first.id,
    second.id,
  ]);
  const list = await (await request("/room-reservations?scope=gangnam")).json();
  expect(list.items.map((r: { id: string }) => r.id)).toContain(failed.id);
});

it("warns about existing reservations and blocks only bookings starting on the closure date", async () => {
  const old = await create({
    startAt: "2026-10-19T01:00:00Z",
    endAt: "2026-10-19T02:00:00Z",
  });
  const path = "/branches/gangnam/closures";
  const key = crypto.randomUUID();
  const body = { date: "2026-10-19", note: "시설 점검" };
  const registered = await request(path, "POST", body, key);
  expect(registered.status).toBe(201);
  const result = await registered.json();
  expect(result).toMatchObject({
    closure: { ...body, canEdit: true, canDelete: true },
    affectedReservationCount: 1,
    affectedReservations: [{ id: old.id, roomId: "gangnam-room-a" }],
  });
  expect(await (await request(path, "POST", body, key)).json()).toEqual(result);
  const duplicate = await request(path, "POST", body);
  expect(duplicate.status).toBe(409);
  expect(await duplicate.json()).toMatchObject({
    code: "BRANCH_CLOSURE_EXISTS",
    closureId: result.closure.id,
  });
  const calendar = await request(
    "/room-reservations/calendar?branchId=gangnam&from=2026-10-18T15:00:00Z&to=2026-10-19T15:00:00Z",
  );
  expect(await calendar.json()).toMatchObject({
    closedDates: [body.date],
    items: [{ id: old.id }],
  });
  const blocked = await request(
    "/room-reservations?scope=gangnam",
    "POST",
    input({
      startAt: "2026-10-19T03:00:00Z",
      endAt: "2026-10-19T04:00:00Z",
    }),
  );
  expect(blocked.status).toBe(409);
  expect(await blocked.json()).toMatchObject({
    code: "BRANCH_CLOSED_DAY",
    closedDate: body.date,
    requestId: expect.any(String),
  });
  await create({
    startAt: "2026-10-18T14:00:00Z",
    endAt: "2026-10-18T16:00:00Z",
  });

  const item = `/branch-closures/${result.closure.id}`;
  store.persona = "junho";
  expect(await (await request(path)).json()).toMatchObject({
    items: [{ canEdit: false, canDelete: false }],
  });
  expect(
    (await request(item, "PATCH", { version: 1, note: null })).status,
  ).toBe(403);
  expect((await request(item + "?version=1", "DELETE")).status).toBe(403);
  expect((await request(path, "POST", { date: "2026-10-20" })).status).toBe(
    403,
  );
  store.persona = "owner";
  expect(
    await (await request(item, "PATCH", { version: 1, note: null })).json(),
  ).toMatchObject({ version: 2, note: null, date: body.date });
  expect((await request(item + "?version=1", "DELETE")).status).toBe(409);
  const deleted = await request(item + "?version=2", "DELETE");
  expect(deleted.status).toBe(204);
  expect(await deleted.text()).toBe("");
});
