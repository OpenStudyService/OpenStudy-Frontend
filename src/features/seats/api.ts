import { z } from "zod";
import { api, ApiError, queryString } from "../../shared/api/client";
import type {
  components,
  operations,
} from "../../shared/api/foundation.generated";

type Schemas = components["schemas"];
export type Seat = Schemas["Seat"];
export type SeatBoard = Schemas["SeatBoard"];
export type SeatCounts = Schemas["SeatCounts"];
export type SeatCreate = Schemas["SeatCreate"];
export type SeatUpdate = Schemas["SeatUpdate"];
export type SeatStatusChange = Schemas["SeatStatusChange"];
export type CheckInLookup = Schemas["CheckInLookup"];
export type CheckInCandidate = Schemas["CheckInCandidate"];
export type UsablePass = Schemas["UsablePass"];
export type SeatSession = Schemas["SeatSession"];
export type CheckIn = Schemas["CheckIn"];
export type CheckOut = Schemas["CheckOut"];
export type SeatSessionMove = Schemas["SeatSessionMove"];

const id = z.string().min(1);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const instant = z.string().refine((value) => !Number.isNaN(Date.parse(value)));
const customer = z.object({ id, memberNo: id, name: z.string() });
const actor = z.object({ id, name: z.string() });
const seatRef = z.object({ id, zone: id, seatNo: id });
const passKind = z.enum(["시간권", "기간권", "정액권"]);
const activeSession = z.object({ id, customer, checkedInAt: instant });
const seatSchema = z
  .object({
    id,
    version: count,
    branchId: id,
    zone: id,
    seatNo: id,
    kind: z.enum(["일반", "모니터", "기타"]),
    status: z.enum(["사용 가능", "사용 중", "운영 중단"]),
    activeSession: activeSession.nullable(),
    createdAt: instant,
  })
  .refine(
    (seat) => (seat.status === "사용 중") === (seat.activeSession !== null),
  );
const countsSchema = z
  .object({
    branchId: id,
    total: count,
    inUse: count,
    available: count,
    blocked: count,
    occupancyRate: z.number().min(0).max(100).nullable(),
    asOf: instant,
  })
  .refine(
    (counts) =>
      counts.total === counts.inUse + counts.available + counts.blocked &&
      counts.occupancyRate ===
        (counts.total === 0
          ? null
          : Math.round((counts.inUse / counts.total) * 1000) / 10),
  );
const boardSchema = z
  .object({
    counts: countsSchema,
    zones: z.array(z.object({ zone: id, seats: z.array(seatSchema) })),
  })
  .refine((board) => {
    const seats = board.zones.flatMap((zone) => zone.seats);
    return (
      new Set(board.zones.map((zone) => zone.zone)).size ===
        board.zones.length &&
      new Set(seats.map((seat) => seat.id)).size === seats.length &&
      board.zones.every((zone) =>
        zone.seats.every(
          (seat) =>
            seat.zone === zone.zone && seat.branchId === board.counts.branchId,
        ),
      ) &&
      seats.length === board.counts.total &&
      seats.filter((seat) => seat.status === "사용 중").length ===
        board.counts.inUse &&
      seats.filter((seat) => seat.status === "사용 가능").length ===
        board.counts.available &&
      seats.filter((seat) => seat.status === "운영 중단").length ===
        board.counts.blocked
    );
  });
const usablePass = z.object({
  id,
  kind: passKind,
  productName: z.string(),
  remainingMinutes: count.nullable(),
  remainingCreditKrw: count.nullable(),
  expiresAt: instant.nullable(),
  purchaseBranchId: id,
});
const lookupSchema = z.object({
  items: z.array(
    z.object({
      customer,
      status: z.enum(["정상", "이용 제한", "비활성"]),
      activeSession: z
        .object({ id, branchId: id, checkedInAt: instant })
        .nullable(),
      usablePasses: z.array(usablePass),
    }),
  ),
});
const sessionSchema = z
  .object({
    id,
    version: count,
    status: z.enum(["이용 중", "종료"]),
    branchId: id,
    seat: seatRef,
    customer,
    pass: z.object({
      id,
      kind: passKind,
      productName: z.string(),
      purchaseBranchId: id,
    }),
    checkedInAt: instant,
    checkedOutAt: instant.nullable(),
    usedMinutes: count,
    deductedMinutes: count,
    deductedKrw: count,
    overageMinutes: count,
    overageKrw: count,
    passRemainingMinutes: count.nullable(),
    passRemainingCreditKrw: count.nullable(),
    checkedInBy: actor.nullable(),
    checkInReason: z.string().nullable(),
    moves: z.array(
      z.object({
        fromSeat: seatRef,
        toSeat: seatRef,
        movedAt: instant,
        movedBy: actor.nullable(),
        reason: z.string().nullable(),
      }),
    ),
  })
  .refine(
    (session) =>
      (session.status === "이용 중") === (session.checkedOutAt === null),
  );
const meta = z.object({
  page: count.min(1),
  pageSize: count.min(1),
  total: count,
});
function requireResponse<T>(value: T, schema: z.ZodType): T {
  if (!schema.safeParse(value).success) {
    throw new ApiError(0, {
      code: "INVALID_RESPONSE",
      message: "좌석 응답을 확인하지 못했습니다. 다시 조회해 주세요.",
    });
  }
  return value;
}
const seatPath = (value: string) => `/seats/${encodeURIComponent(value)}`;
const sessionPath = (value: string) =>
  `/seat-sessions/${encodeURIComponent(value)}`;
const scoped = (path: string, scope: string) =>
  `${path}?${queryString({ scope })}`;

export const seatApi = {
  async history(
    filters: NonNullable<operations["listSeatSessions"]["parameters"]["query"]>,
    signal?: AbortSignal,
  ) {
    const result = requireResponse(
      await api<Schemas["SeatSessionPage"]>(
        `/seat-sessions?${queryString(filters)}`,
        { signal },
      ),
      z.object({ items: z.array(sessionSchema), meta }),
    );
    if (
      result.items.some(
        (row) =>
          (filters.scope &&
            filters.scope !== "all" &&
            row.branchId !== filters.scope) ||
          (row.status === "종료" &&
            (row.passRemainingMinutes !== null ||
              row.passRemainingCreditKrw !== null)),
      )
    ) {
      throw new ApiError(0, {
        code: "INVALID_RESPONSE",
        message: "이용 이력의 조회 범위를 확인해 주세요.",
      });
    }
    return result;
  },
  async board(branchId: string, kind: string, signal: AbortSignal) {
    const result = requireResponse(
      await api<SeatBoard>(`/seats/board?${queryString({ branchId, kind })}`, {
        signal,
      }),
      boardSchema,
    );
    if (
      result.counts.branchId !== branchId ||
      (kind &&
        result.zones.some((zone) =>
          zone.seats.some((seat) => seat.kind !== kind),
        ))
    ) {
      throw new ApiError(0, {
        code: "INVALID_RESPONSE",
        message: "요청한 지점의 좌석 응답을 확인해 주세요.",
      });
    }
    return result;
  },
  async occupancy(scope: string, signal: AbortSignal) {
    return requireResponse(
      await api<Schemas["SeatOccupancy"]>(scoped("/seats/occupancy", scope), {
        signal,
      }),
      z.object({ items: z.array(countsSchema) }),
    );
  },
  async list(scope: string, search: string, signal: AbortSignal) {
    const params = new URLSearchParams({ scope });
    const source = new URLSearchParams(search);
    for (const key of ["zone", "kind", "status", "page", "pageSize"]) {
      const value = source.get(key);
      if (value) params.set(key, value);
    }
    return requireResponse(
      await api<Schemas["SeatPage"]>(`/seats?${params}`, { signal }),
      z.object({ items: z.array(seatSchema), meta }),
    );
  },
  async detail(scope: string, value: string, signal: AbortSignal) {
    return requireResponse(
      await api<Seat>(scoped(seatPath(value), scope), { signal }),
      seatSchema,
    );
  },
  async create(
    scope: string,
    body: SeatCreate,
    signal: AbortSignal,
    key: string,
  ) {
    const { branchId, zone, seatNo, kind, status } = body;
    return requireResponse(
      await api<Seat>(scoped("/seats", scope), {
        method: "POST",
        body: { branchId, zone, seatNo, kind, status },
        signal,
        key,
      }),
      seatSchema,
    );
  },
  async update(
    scope: string,
    value: string,
    body: SeatUpdate,
    signal: AbortSignal,
  ) {
    const { version, zone, seatNo, kind } = body;
    return requireResponse(
      await api<Seat>(scoped(seatPath(value), scope), {
        method: "PATCH",
        body: { version, zone, seatNo, kind },
        signal,
      }),
      seatSchema,
    );
  },
  async status(
    scope: string,
    value: string,
    body: SeatStatusChange,
    signal: AbortSignal,
  ) {
    const { version, status, reason } = body;
    return requireResponse(
      await api<Seat>(scoped(`${seatPath(value)}/status`, scope), {
        method: "POST",
        body: { version, status, reason },
        signal,
      }),
      seatSchema,
    );
  },
  async lookup(body: CheckInLookup, signal: AbortSignal) {
    const { branchId, memberNo, phone } = body;
    return requireResponse(
      await api<Schemas["CheckInLookupResult"]>("/customer-lookups/check-in", {
        method: "POST",
        body: { branchId, memberNo, phone },
        signal,
      }),
      lookupSchema,
    );
  },
  async session(scope: string, value: string, signal: AbortSignal) {
    return requireResponse(
      await api<SeatSession>(scoped(sessionPath(value), scope), { signal }),
      sessionSchema,
    );
  },
  async checkIn(body: CheckIn, signal: AbortSignal, key: string) {
    const { seatId, customerId, passId, reason } = body;
    return requireResponse(
      await api<SeatSession>("/seat-sessions", {
        method: "POST",
        body: { seatId, customerId, passId, reason },
        signal,
        key,
      }),
      sessionSchema,
    );
  },
  async checkOut(
    value: string,
    body: CheckOut,
    signal: AbortSignal,
    key: string,
  ) {
    return requireResponse(
      await api<SeatSession>(`${sessionPath(value)}/check-out`, {
        method: "POST",
        body: { reason: body.reason },
        signal,
        key,
      }),
      sessionSchema,
    );
  },
  async move(
    value: string,
    body: SeatSessionMove,
    signal: AbortSignal,
    key: string,
  ) {
    const { toSeatId, reason } = body;
    return requireResponse(
      await api<SeatSession>(`${sessionPath(value)}/move`, {
        method: "POST",
        body: { toSeatId, reason },
        signal,
        key,
      }),
      sessionSchema,
    );
  },
};
