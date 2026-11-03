import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw/http";
import { clearCsrf } from "../../shared/api/client";
import { roomApi } from "./api";
import type { Room, RoomReservation, RoomReservationCreate } from "./model";

const room: Room = {
  id: "room/1",
  version: 1,
  branchId: "b1",
  roomNo: "A1",
  name: "스터디룸",
  capacity: 6,
  ratePerHourKrw: 8000,
  status: "사용 가능",
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
};
const reservation: RoomReservation = {
  id: "reservation/1",
  version: 1,
  branchId: "b1",
  room: { id: room.id, roomNo: room.roomNo, name: room.name },
  customer: { id: "customer1", name: "고객", memberNo: "C001" },
  startAt: "2030-01-01T01:00:00Z",
  endAt: "2030-01-01T03:00:00Z",
  billing: {
    ratePerHourKrw: 8000,
    hours: 2,
    amountKrw: 16000,
    paymentId: "p1",
    paymentStatus: "승인",
  },
  status: "확정",
  usage: null,
  cancelledAt: null,
  cancelledBy: null,
  cancelReason: null,
  createdBy: { id: "owner", name: "사장님" },
  createdAt: "2026-11-01T00:00:00Z",
  canCancel: true,
};
const input: RoomReservationCreate = {
  branchId: "b1",
  roomId: room.id,
  customerId: "customer1",
  startAt: reservation.startAt,
  endAt: reservation.endAt,
  partySize: 2,
  method: "카드",
  mockOutcome: "APPROVED",
};
const server = setupServer(
  http.get("/api/auth/csrf", () => HttpResponse.json({ token: "csrf" })),
);
const signal = () => new AbortController().signal;
beforeAll(() => server.listen());
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  clearCsrf();
});
it("uses canonical paths, encoded IDs, scope and only the room list's documented filters", async () => {
  server.use(
    http.get("/api/rooms", ({ request }) => {
      const url = new URL(request.url);
      expect(url.searchParams.get("scope")).toBe("b1");
      expect(url.searchParams.get("page")).toBe("2");
      expect(url.searchParams.has("sort")).toBe(false);
      return HttpResponse.json({
        items: [room],
        meta: { page: 2, pageSize: 20, total: 21 },
      });
    }),
    http.get("/api/rooms/:id", ({ params }) => {
      expect(params.id).toBe(room.id);
      return HttpResponse.json(room);
    }),
  );
  expect(
    (await roomApi.rooms("b1", { page: 2, status: "사용 가능" }, signal()))
      .items[0],
  ).toEqual(room);
  expect(await roomApi.room("b1", room.id, signal())).toEqual(room);
});
it("sends creation with the logical request key and no client price or invented quote request", async () => {
  const bodies: unknown[] = [],
    keys: (string | null)[] = [];
  server.use(
    http.post("/api/room-reservations", async ({ request }) => {
      bodies.push(await request.json());
      keys.push(request.headers.get("Idempotency-Key"));
      expect(request.headers.get("X-CSRF-Token")).toBe("csrf");
      return HttpResponse.json(reservation, { status: 201 });
    }),
  );
  await roomApi.createReservation("b1", input, signal(), "same-key");
  await roomApi.createReservation("b1", input, signal(), "same-key");
  expect(keys).toEqual(["same-key", "same-key"]);
  expect(bodies).toEqual([input, input]);
  expect(bodies[0]).not.toHaveProperty("amountKrw");
});
it("preserves a failed payment as a server result instead of claiming confirmation", async () => {
  server.use(
    http.post("/api/room-reservations", () =>
      HttpResponse.json(
        {
          ...reservation,
          status: "결제 실패",
          billing: { ...reservation.billing!, paymentStatus: "실패" },
          canCancel: false,
        },
        { status: 201 },
      ),
    ),
  );
  expect(
    await roomApi.createReservation(
      "b1",
      { ...input, mockOutcome: "FAILED" },
      signal(),
      "key",
    ),
  ).toMatchObject({
    status: "결제 실패",
    billing: { paymentStatus: "실패" },
    canCancel: false,
  });
});
it("retains null billing for a reader without payment permission", async () => {
  server.use(
    http.get("/api/room-reservations/:id", () =>
      HttpResponse.json({ ...reservation, billing: null, canCancel: false }),
    ),
  );
  expect(
    await roomApi.reservation("b1", reservation.id, signal()),
  ).toMatchObject({ billing: null, canCancel: false });
});
it("sends idempotency only for cancellation, with version-only start and complete bodies", async () => {
  const seen: { action: string; body: unknown; key: string | null }[] = [];
  server.use(
    http.post(
      "/api/room-reservations/:id/:action",
      async ({ request, params }) => {
        seen.push({
          action: String(params.action),
          body: await request.json(),
          key: request.headers.get("Idempotency-Key"),
        });
        return HttpResponse.json(reservation);
      },
    ),
  );
  await roomApi.cancel(
    "b1",
    reservation.id,
    { version: 1, reason: "일정 변경" },
    signal(),
    "cancel-key",
  );
  await roomApi.start("b1", reservation.id, { version: 1 }, signal());
  await roomApi.complete("b1", reservation.id, { version: 1 }, signal());
  expect(seen).toEqual([
    {
      action: "cancel",
      body: { version: 1, reason: "일정 변경" },
      key: "cancel-key",
    },
    { action: "start", body: { version: 1 }, key: null },
    { action: "complete", body: { version: 1 }, key: null },
  ]);
});
it("retains 409 conflict metadata and 422 field errors", async () => {
  server.use(
    http.patch("/api/rooms/:id", () =>
      HttpResponse.json(
        {
          code: "VERSION_CONFLICT",
          message: "최신값 확인",
          latestVersion: 2,
          reloadUrl: "/api/rooms/1",
        },
        { status: 409 },
      ),
    ),
    http.post("/api/room-reservations", () =>
      HttpResponse.json(
        {
          code: "VALIDATION_FAILED",
          message: "인원 확인",
          fieldErrors: { partySize: "정원 초과" },
        },
        { status: 422 },
      ),
    ),
  );
  await expect(
    roomApi.updateRoom("b1", room.id, { version: 1, name: "수정" }, signal()),
  ).rejects.toMatchObject({ status: 409, detail: { latestVersion: 2 } });
  await expect(
    roomApi.createReservation("b1", input, signal(), "key"),
  ).rejects.toMatchObject({
    status: 422,
    detail: { fieldErrors: { partySize: "정원 초과" } },
  });
});
it.each([
  { ...reservation, id: "wrong" },
  { ...reservation, branchId: "wrong" },
  { ...reservation, billing: { ...reservation.billing!, amountKrw: 1 } },
  { success: true },
])("rejects a malformed or mismatched success response", async (value) => {
  server.use(
    http.get("/api/room-reservations/:id", () => HttpResponse.json(value)),
  );
  await expect(
    roomApi.reservation("b1", reservation.id, signal()),
  ).rejects.toMatchObject({ detail: { code: "INVALID_RESPONSE" } });
});
it("checks calendar period, branch and selected room without converting it into a paged list", async () => {
  server.use(
    http.get("/api/room-reservations/calendar", ({ request }) => {
      const p = new URL(request.url).searchParams;
      expect(p.get("branchId")).toBe("b1");
      expect(p.has("page")).toBe(false);
      return HttpResponse.json({
        from: reservation.startAt,
        to: reservation.endAt,
        items: [reservation],
      });
    }),
  );
  expect(
    (
      await roomApi.calendar(
        "b1",
        reservation.startAt,
        reservation.endAt,
        room.id,
        signal(),
      )
    ).items,
  ).toHaveLength(1);
  await expect(
    roomApi.calendar(
      "b1",
      reservation.startAt,
      reservation.endAt,
      "other",
      signal(),
    ),
  ).rejects.toMatchObject({ detail: { code: "INVALID_RESPONSE" } });
});
