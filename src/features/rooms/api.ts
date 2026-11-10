import { z } from "zod";
import { api, ApiError, queryString } from "../../shared/api/client";
import type {
  Room,
  RoomCreate,
  RoomUpdate,
  RoomPage,
  SpaceStatusChange,
  RoomReservation,
  RoomReservationCreate,
  RoomReservationCancel,
  RoomUsageChange,
  RoomReservationPage,
  RoomReservationCalendar,
  RoomFilters,
  ReservationFilters,
} from "./model";
export type {
  Room,
  RoomCreate,
  RoomUpdate,
  RoomPage,
  SpaceStatusChange,
  RoomReservation,
  RoomReservationCreate,
  RoomReservationCancel,
  RoomUsageChange,
  RoomReservationPage,
  RoomReservationCalendar,
  RoomFilters,
  ReservationFilters,
} from "./model";
const id = z.string().min(1),
  integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  positive = integer.positive();
const instant = z
  .string()
  .refine((v) => Number.isFinite(Date.parse(v)), "Invalid instant");
const actor = z.object({ id, name: z.string() }),
  customer = z.object({ id, memberNo: z.string(), name: z.string() });
export const roomSchema = z.object({
  id,
  version: integer,
  branchId: id,
  roomNo: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  capacity: positive.max(65535),
  ratePerHourKrw: positive,
  status: z.enum(["사용 가능", "운영 중단"]),
  createdAt: instant,
  updatedAt: instant,
});
const billing = z
  .object({
    ratePerHourKrw: positive,
    hours: positive.max(24),
    amountKrw: positive,
    paymentId: id,
    paymentStatus: z.enum(["승인", "실패", "환불"]),
  })
  .refine(
    (b) =>
      Number.isSafeInteger(b.ratePerHourKrw * b.hours) &&
      b.amountKrw === b.ratePerHourKrw * b.hours,
  );
export const reservationSchema = z
  .object({
    id,
    version: integer,
    branchId: id,
    status: z.enum(["결제 실패", "확정", "이용 중", "완료", "취소"]),
    room: z.object({ id, roomNo: z.string(), name: z.string() }),
    customer,
    startAt: instant,
    endAt: instant,
    billing: billing.nullable(),
    usage: z
      .object({
        startedAt: instant,
        endedAt: instant.nullable(),
        startedBy: actor.nullable(),
        endedBy: actor.nullable(),
      })
      .nullable(),
    cancelledAt: instant.nullable(),
    cancelledBy: actor.nullable(),
    cancelReason: z.string().nullable(),
    createdBy: actor,
    createdAt: instant,
    canCancel: z.boolean(),
  })
  .refine((r) => Date.parse(r.endAt) > Date.parse(r.startAt));
const meta = z.object({ page: positive, pageSize: positive, total: integer });
const roomPage = z.object({ items: z.array(roomSchema), meta }),
  reservationPage = z.object({ items: z.array(reservationSchema), meta });
const calendar = z.object({
  closedDates: z.array(z.iso.date()).optional(),
  from: instant,
  to: instant,
  items: z.array(reservationSchema),
});
function invalid(): never {
  throw new ApiError(0, {
    code: "INVALID_RESPONSE",
    message: "룸·예약 응답을 확인하지 못했습니다. 다시 조회해 주세요.",
  });
}
function parse<T>(schema: z.ZodType, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) invalid();
  return result.data as T;
}
const scoped = (path: string, scope: string) =>
  `${path}?${queryString({ scope })}`;
const roomPath = (id: string) => `/rooms/${encodeURIComponent(id)}`;
const reservationPath = (id: string) =>
  `/room-reservations/${encodeURIComponent(id)}`;
async function readRoom(
  path: string,
  signal: AbortSignal,
  scope: string,
  expected?: string,
) {
  const value = parse<Room>(roomSchema, await api(path, { signal }));
  if (
    (expected && value.id !== expected) ||
    (scope !== "all" && value.branchId !== scope)
  )
    invalid();
  return value;
}
async function readReservation(
  path: string,
  signal: AbortSignal,
  scope: string,
  expected?: string,
) {
  const value = parse<RoomReservation>(
    reservationSchema,
    await api(path, { signal }),
  );
  if (
    (expected && value.id !== expected) ||
    (scope !== "all" && value.branchId !== scope)
  )
    invalid();
  return value;
}
async function roomWrite(
  scope: string,
  id: string | undefined,
  body: RoomCreate | RoomUpdate | SpaceStatusChange,
  signal: AbortSignal,
  key?: string,
  status = false,
) {
  const result = parse<Room>(
    roomSchema,
    await api(
      scoped(
        id ? `${roomPath(id)}${status ? "/status" : ""}` : "/rooms",
        scope,
      ),
      {
        method: !id || status ? "POST" : "PATCH",
        body,
        signal,
        ...(!id ? { key } : {}),
      },
    ),
  );
  if (
    (id && result.id !== id) ||
    (!id && "branchId" in body && result.branchId !== body.branchId) ||
    (scope !== "all" && result.branchId !== scope)
  )
    invalid();
  return result;
}
async function reservationWrite(
  scope: string,
  id: string | undefined,
  action: string,
  body: RoomReservationCreate | RoomReservationCancel | RoomUsageChange,
  signal: AbortSignal,
  key?: string,
) {
  const result = parse<RoomReservation>(
    reservationSchema,
    await api(
      scoped(
        id ? `${reservationPath(id)}/${action}` : "/room-reservations",
        scope,
      ),
      {
        method: "POST",
        body,
        signal,
        ...(!id || action === "cancel" ? { key } : {}),
      },
    ),
  );
  if (
    (id && result.id !== id) ||
    (!id &&
      "roomId" in body &&
      (result.branchId !== body.branchId ||
        result.room.id !== body.roomId ||
        result.customer.id !== body.customerId ||
        Date.parse(result.startAt) !== Date.parse(body.startAt) ||
        Date.parse(result.endAt) !== Date.parse(body.endAt))) ||
    (scope !== "all" && result.branchId !== scope)
  )
    invalid();
  return result;
}
export const roomApi = {
  async rooms(scope: string, filters: RoomFilters, signal: AbortSignal) {
    const result = parse<RoomPage>(
      roomPage,
      await api(
        `/rooms?${queryString({ scope, page: filters.page, pageSize: filters.pageSize, status: filters.status })}`,
        { signal },
      ),
    );
    if (scope !== "all" && result.items.some((r) => r.branchId !== scope))
      invalid();
    return result;
  },
  room(scope: string, id: string, signal: AbortSignal) {
    return readRoom(scoped(roomPath(id), scope), signal, scope, id);
  },
  createRoom(
    scope: string,
    body: RoomCreate,
    signal: AbortSignal,
    key: string,
  ) {
    return roomWrite(scope, undefined, body, signal, key);
  },
  updateRoom(scope: string, id: string, body: RoomUpdate, signal: AbortSignal) {
    return roomWrite(scope, id, body, signal);
  },
  roomStatus(
    scope: string,
    id: string,
    body: SpaceStatusChange,
    signal: AbortSignal,
  ) {
    return roomWrite(scope, id, body, signal, undefined, true);
  },
  async reservations(
    scope: string,
    filters: ReservationFilters,
    signal: AbortSignal,
  ) {
    const result = parse<RoomReservationPage>(
      reservationPage,
      await api(
        `/room-reservations?${queryString({ scope, page: filters.page, pageSize: filters.pageSize, roomId: filters.roomId, customerId: filters.customerId, status: filters.status, from: filters.from, to: filters.to })}`,
        { signal },
      ),
    );
    if (scope !== "all" && result.items.some((r) => r.branchId !== scope))
      invalid();
    return result;
  },
  reservation(scope: string, id: string, signal: AbortSignal) {
    return readReservation(
      scoped(reservationPath(id), scope),
      signal,
      scope,
      id,
    );
  },
  async calendar(
    branchId: string,
    from: string,
    to: string,
    roomId: string | undefined,
    signal: AbortSignal,
  ) {
    const result = parse<RoomReservationCalendar>(
      calendar,
      await api(
        `/room-reservations/calendar?${queryString({ branchId, from, to, roomId })}`,
        { signal },
      ),
    );
    if (
      Date.parse(result.from) !== Date.parse(from) ||
      Date.parse(result.to) !== Date.parse(to) ||
      result.items.some(
        (r) => r.branchId !== branchId || (!!roomId && r.room.id !== roomId),
      )
    )
      invalid();
    return result;
  },
  createReservation(
    scope: string,
    body: RoomReservationCreate,
    signal: AbortSignal,
    key: string,
  ) {
    return reservationWrite(scope, undefined, "", body, signal, key);
  },
  cancel(
    scope: string,
    id: string,
    body: RoomReservationCancel,
    signal: AbortSignal,
    key: string,
  ) {
    return reservationWrite(scope, id, "cancel", body, signal, key);
  },
  start(scope: string, id: string, body: RoomUsageChange, signal: AbortSignal) {
    return reservationWrite(scope, id, "start", body, signal);
  },
  complete(
    scope: string,
    id: string,
    body: RoomUsageChange,
    signal: AbortSignal,
  ) {
    return reservationWrite(scope, id, "complete", body, signal);
  },
};
