/** M6 room contract adapter over the existing demo ledgers. Never imported in live mode. */
import { closureRows } from "./closures";
import { http, HttpResponse } from "msw/http";
import { delay } from "msw";
import { z } from "zod";
import { businessDate, can } from "../shared/domain/schema";
import type { Employee, ResourceMap } from "../shared/domain/schema";
import type { components } from "../shared/api/foundation.generated";
import { assert, DomainError, store } from "./store";
import { matchesCustomer, rejectMergedCustomer } from "./customer-identity";
type S = components["schemas"];
type Args = {
  request: Request;
  params: Record<string, string | readonly string[] | undefined>;
};
type Booking = S["RoomReservation"];
const actor = (id: string) => {
  const e = store.db.employees.find((e) => e.id === id);
  return e ? { id: e.id, name: e.name } : null;
};
const text = z.string().trim().min(1),
  version = z.number().int().positive(),
  count = z.number().int().min(1).max(65535),
  money = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const state = z.enum(["사용 가능", "운영 중단"]),
  status = z.enum(["확정", "결제 실패", "이용 중", "완료", "취소"]);
function room(row: ResourceMap["rooms"]): S["Room"] {
  return (
    row.canonical ?? {
      id: row.id,
      version: row.version,
      branchId: row.branchId,
      roomNo: row.id.endsWith("-a")
        ? "A"
        : row.id.endsWith("-b")
          ? "B"
          : row.id,
      name: row.name,
      capacity: row.capacity,
      ratePerHourKrw: row.hourlyRate,
      status: row.status === "사용 불가" ? "운영 중단" : "사용 가능",
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  );
}
export function booking(
  row: ResourceMap["reservations"],
  user: Employee,
  internal = false,
): Booking {
  const r = room(store.db.rooms.find((r) => r.id === row.roomId)!),
    c = store.db.members.find((c) => c.id === row.memberId);
  const saved: Booking = row.canonical ?? {
    id: row.id,
    version: row.version,
    status: row.status === "예약 확정" ? "확정" : row.status,
    branchId: row.branchId,
    room: { id: r.id, roomNo: r.roomNo, name: r.name },
    customer: {
      id: row.memberId,
      name: c?.name ?? "고객",
      memberNo: c?.memberNo ?? row.memberId,
    },
    startAt: row.startsAt,
    endAt: row.endsAt,
    billing: row.paymentId
      ? {
          ratePerHourKrw: row.hourlyRate,
          hours: (Date.parse(row.endsAt) - Date.parse(row.startsAt)) / 3600000,
          amountKrw: row.amount,
          paymentId: row.paymentId,
          paymentStatus:
            row.status === "취소"
              ? "환불"
              : row.status === "결제 실패"
                ? "실패"
                : "승인",
        }
      : null,
    usage: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdBy: actor("owner")!,
    createdAt: row.createdAt,
    canCancel: false,
  };
  return {
    ...saved,
    room: { id: r.id, roomNo: r.roomNo, name: r.name },
    billing:
      internal ||
      can(user, row.branchId, "payments:read") ||
      can(user, row.branchId, "payments:write")
        ? saved.billing
        : null,
    canCancel:
      saved.status === "확정" &&
      Date.parse(saved.startAt) > Date.parse(store.now()) &&
      can(user, row.branchId, "payments:write"),
  };
}
function selected(a: Args, u: Employee) {
  const scope = new URL(a.request.url).searchParams.get("scope") ?? "all";
  assert(
    scope === "all" ||
      (store.db.branches.some((b) => b.id === scope) && can(u, scope)),
    "지점에 접근할 수 없습니다.",
    403,
    "FORBIDDEN",
  );
  return store.db.branches
    .filter((b) => (scope === "all" || scope === b.id) && can(u, b.id))
    .map((b) => b.id);
}
function readRoom(a: Args, u: Employee) {
  const row = store.db.rooms.find(
    (r) => r.id === a.params.id && selected(a, u).includes(r.branchId),
  );
  assert(row, "룸을 찾을 수 없습니다.", 404, "NOT_FOUND");
  return row;
}
function readBooking(a: Args, u: Employee) {
  const row = store.db.reservations.find(
    (r) => r.id === a.params.id && selected(a, u).includes(r.branchId),
  );
  assert(row, "예약을 찾을 수 없습니다.", 404, "NOT_FOUND");
  return row;
}
function current(v: unknown, stored: number, path: string) {
  if (version.parse(v) !== stored)
    throw new DomainError(
      409,
      "VERSION_CONFLICT",
      "최신 정보를 확인한 뒤 다시 저장해 주세요.",
      undefined,
      stored,
      path,
    );
}
const respond =
  (fn: (a: Args, u: Employee) => unknown | Promise<unknown>, code = 200) =>
  async (a: Args) => {
    try {
      const before = store.activeUser().id;
      if (store.scenario === "slow") await delay(2200);
      const u = store.activeUser();
      assert(
        u.id === before,
        "권한이 변경되었습니다.",
        403,
        "AUTHORIZATION_CHANGED",
      );
      assert(
        store.scenario !== "error",
        "일시적 서버 오류입니다.",
        503,
        "SERVICE_UNAVAILABLE",
      );
      assert(
        store.scenario !== "forbidden",
        "접근 권한이 없습니다.",
        403,
        "FORBIDDEN",
      );
      if (a.request.method !== "GET")
        assert(
          a.request.headers.get("X-CSRF-Token") === "openstudy-mock-csrf",
          "인증 요청을 확인해 주세요.",
          403,
          "CSRF_INVALID",
        );
      return HttpResponse.json((await fn(a, u)) as Record<string, unknown>, {
        status: code,
      });
    } catch (e) {
      if (e instanceof z.ZodError)
        return HttpResponse.json(
          {
            code: "VALIDATION_FAILED",
            message: "입력을 확인해 주세요.",
            fieldErrors: Object.fromEntries(
              e.issues.map((i) => [i.path.join("."), i.message]),
            ),
          },
          { status: 422 },
        );
      if (e instanceof DomainError)
        return HttpResponse.json(
          {
            ...(e.target
              ? { ...e.target, requestId: crypto.randomUUID() }
              : {}),
            code: e.code,
            message: e.message,
            fieldErrors: e.fieldErrors,
            latestVersion: e.latestVersion,
            reloadUrl: e.reloadUrl,
          },
          { status: e.status },
        );
      throw e;
    }
  };
function page<T>(a: Args, rows: T[]) {
  const p = new URL(a.request.url).searchParams,
    current = Number(p.get("page") ?? 1),
    size = Number(p.get("pageSize") ?? 20);
  assert(
    Number.isInteger(current) &&
      current > 0 &&
      Number.isInteger(size) &&
      size > 0 &&
      size <= 100,
    "페이지를 확인해 주세요.",
    422,
    "VALIDATION_FAILED",
  );
  return {
    items: rows.slice((current - 1) * size, current * size),
    meta: { page: current, pageSize: size, total: rows.length },
  };
}
function keyed<T>(a: Args, operation: string, body: unknown, fn: () => T) {
  const key = a.request.headers.get("Idempotency-Key");
  assert(
    key && key.length >= 16 && key.length <= 128,
    "요청 키가 필요합니다.",
    422,
    "VALIDATION_FAILED",
  );
  return store.transaction(`${operation}:${key}`, body, fn);
}
function saveRoom(data: S["Room"]) {
  let raw = store.db.rooms.find((r) => r.id === data.id);
  if (!raw) {
    raw = { ...data, hourlyRate: data.ratePerHourKrw, status: "이용 가능" };
    store.db.rooms.push(raw);
  }
  Object.assign(raw, {
    canonical: data,
    name: data.name,
    capacity: data.capacity,
    hourlyRate: data.ratePerHourKrw,
    status: data.status === "운영 중단" ? "사용 불가" : "이용 가능",
    version: data.version,
    updatedAt: data.updatedAt,
  });
  store.emit("rooms", data.id, data.branchId);
  return data;
}
function saveBooking(data: Booking, partySize: number) {
  let raw = store.db.reservations.find((r) => r.id === data.id);
  if (!raw) {
    raw = {
      id: data.id,
      version: data.version,
      branchId: data.branchId,
      memberId: data.customer.id,
      roomId: data.room.id,
      startsAt: data.startAt,
      endsAt: data.endAt,
      people: partySize,
      amount: data.billing?.amountKrw ?? 0,
      hourlyRate: data.billing?.ratePerHourKrw ?? 0,
      paymentId: data.billing?.paymentId ?? "",
      status: "예약 확정",
      createdAt: data.createdAt,
      updatedAt: store.now(),
    };
    store.db.reservations.push(raw);
  }
  Object.assign(raw, {
    canonical: data,
    status: data.status === "확정" ? "예약 확정" : data.status,
    version: data.version,
    updatedAt: store.now(),
  });
  store.emit("reservations", data.id, data.branchId);
  return raw;
}
function running(branch: string) {
  assert(
    store.db.branches.find((b) => b.id === branch)?.status === "운영 중",
    "운영 중지된 지점입니다.",
    409,
    "BRANCH_NOT_ACTIVE",
  );
}
function filtered(a: Args, u: Employee) {
  const p = new URL(a.request.url).searchParams,
    branches = selected(a, u);
  if (p.has("status")) status.parse(p.get("status"));
  const from = p.get("from"),
    to = p.get("to");
  validRange(from, to, false);
  return (store.scenario === "empty" ? [] : store.db.reservations)
    .filter(
      (r) =>
        branches.includes(r.branchId) &&
        (!p.get("roomId") || r.roomId === p.get("roomId")) &&
        (!p.get("customerId") ||
          matchesCustomer(r.memberId, p.get("customerId")!)),
    )
    .map((r) => booking(r, u))
    .filter(
      (r) =>
        (!p.get("status") || r.status === p.get("status")) &&
        (!from || Date.parse(r.endAt) > Date.parse(from)) &&
        (!to || Date.parse(r.startAt) < Date.parse(to)),
    )
    .sort(
      (a, b) => b.startAt.localeCompare(a.startAt) || b.id.localeCompare(a.id),
    );
}
function validRange(from: string | null, to: string | null, calendar: boolean) {
  if (calendar)
    assert(from && to, "기간을 입력해 주세요.", 422, "VALIDATION_FAILED");
  if (from) z.iso.datetime({ offset: true }).parse(from);
  if (to) z.iso.datetime({ offset: true }).parse(to);
  if (from && to)
    assert(
      Date.parse(to) > Date.parse(from) &&
        (!calendar || Date.parse(to) - Date.parse(from) <= 62 * 86400000),
      "기간은 시작 이후 최대 62일입니다.",
      422,
      "VALIDATION_FAILED",
    );
}
const roomFields = {
  roomNo: text.max(40),
  name: text.max(120),
  capacity: count,
  ratePerHourKrw: money,
};
const createRoom = z
  .object({ branchId: text, ...roomFields, status: state.optional() })
  .strict();
const updateRoom = z
  .object({
    version,
    ...Object.fromEntries(
      Object.entries(roomFields).map(([k, v]) => [k, v.optional()]),
    ),
  })
  .strict();
const createBooking = z
  .object({
    branchId: text,
    roomId: text,
    customerId: text,
    startAt: z.iso.datetime({ offset: true }),
    endAt: z.iso.datetime({ offset: true }),
    partySize: count,
    method: z.enum(["현금", "카드", "계좌이체", "기타"]),
    mockOutcome: z.enum(["APPROVED", "FAILED"]).optional(),
  })
  .strict();
export const roomHandlers = [
  http.get(
    "/api/rooms",
    respond((a, u) => {
      const p = new URL(a.request.url).searchParams,
        branches = selected(a, u);
      if (p.has("status")) state.parse(p.get("status"));
      return page(
        a,
        (store.scenario === "empty" ? [] : store.db.rooms)
          .filter((r) => branches.includes(r.branchId))
          .map(room)
          .filter((r) => !p.get("status") || r.status === p.get("status"))
          .sort(
            (a, b) =>
              a.roomNo.localeCompare(b.roomNo) || a.id.localeCompare(b.id),
          ),
      );
    }),
  ),
  http.get(
    "/api/rooms/:id",
    respond((a, u) => room(readRoom(a, u))),
  ),
  http.post(
    "/api/rooms",
    respond(async (a, u) => {
      const b = createRoom.parse(await a.request.json());
      selected(a, u);
      assert(
        can(u, b.branchId, "operations:write"),
        "룸 관리 권한이 없습니다.",
        403,
        "FORBIDDEN",
      );
      return keyed(a, `rooms:create:${b.branchId}`, b, () => {
        assert(
          !store.db.rooms.some(
            (r) => r.branchId === b.branchId && room(r).roomNo === b.roomNo,
          ),
          "같은 지점의 룸 번호가 중복됩니다.",
          409,
          "DUPLICATE_ROOM_NO",
        );
        const now = store.now();
        return saveRoom({
          ...b,
          id: crypto.randomUUID(),
          version: 1,
          status: b.status ?? "사용 가능",
          createdAt: now,
          updatedAt: now,
        });
      });
    }, 201),
  ),
  http.patch(
    "/api/rooms/:id",
    respond(async (a, u) => {
      const raw = readRoom(a, u),
        r = room(raw),
        input = (await a.request.json()) as Record<string, unknown>;
      assert(
        !("status" in input) && !("branchId" in input),
        "지점·운영 상태는 이 요청으로 바꿀 수 없습니다.",
        422,
        "IMMUTABLE_FIELD",
      );
      const b = updateRoom.parse(input);
      assert(
        can(u, r.branchId, "operations:write"),
        "룸 관리 권한이 없습니다.",
        403,
        "FORBIDDEN",
      );
      current(b.version, r.version, `/api/rooms/${r.id}`);
      assert(
        Object.keys(b).length > 1,
        "변경할 항목이 필요합니다.",
        422,
        "VALIDATION_FAILED",
      );
      const data = { ...r, ...b } as S["Room"];
      assert(
        !store.db.rooms.some(
          (x) =>
            x.id !== r.id &&
            x.branchId === r.branchId &&
            room(x).roomNo === data.roomNo,
        ),
        "같은 지점의 룸 번호가 중복됩니다.",
        409,
        "DUPLICATE_ROOM_NO",
      );
      return JSON.stringify(data) === JSON.stringify(r)
        ? r
        : saveRoom({ ...data, version: r.version + 1, updatedAt: store.now() });
    }),
  ),
  http.post(
    "/api/rooms/:id/status",
    respond(async (a, u) => {
      const r = room(readRoom(a, u)),
        b = z
          .object({ version, status: state, reason: text.max(500) })
          .strict()
          .parse(await a.request.json());
      assert(
        can(u, r.branchId, "operations:write"),
        "룸 관리 권한이 없습니다.",
        403,
        "FORBIDDEN",
      );
      current(b.version, r.version, `/api/rooms/${r.id}`);
      return r.status === b.status
        ? r
        : saveRoom({
            ...r,
            status: b.status,
            version: r.version + 1,
            updatedAt: store.now(),
          });
    }),
  ),
  http.get(
    "/api/room-reservations",
    respond((a, u) => page(a, filtered(a, u))),
  ),
  http.get(
    "/api/room-reservations/calendar",
    respond((a, u) => {
      const p = new URL(a.request.url).searchParams,
        branch = p.get("branchId"),
        roomId = p.get("roomId"),
        from = p.get("from"),
        to = p.get("to");
      assert(branch, "지점을 선택해 주세요.", 422, "VALIDATION_FAILED");
      assert(
        store.db.branches.some((b) => b.id === branch) && can(u, branch),
        "지점에 접근할 수 없습니다.",
        403,
        "FORBIDDEN",
      );
      validRange(from, to, true);
      if (roomId)
        assert(
          store.db.rooms.some((r) => r.id === roomId && r.branchId === branch),
          "룸을 찾을 수 없습니다.",
          404,
          "NOT_FOUND",
        );
      const url = new URL(a.request.url);
      url.searchParams.set("scope", branch);
      return {
        from,
        to,
        closedDates: closureRows(branch)
          .filter(({ date }) => {
            const midnight = Date.parse(date + "T00:00:00+09:00");
            return (
              midnight < Date.parse(to!) &&
              midnight + 86400000 > Date.parse(from!)
            );
          })
          .map(({ date }) => date),
        items: filtered({ ...a, request: new Request(url) }, u)
          .filter((row) => row.status !== "결제 실패")
          .sort(
            (a, b) =>
              a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id),
          ),
      };
    }),
  ),
  http.get(
    "/api/room-reservations/:id",
    respond((a, u) => booking(readBooking(a, u), u)),
  ),
  http.post(
    "/api/room-reservations",
    respond(async (a, u) => {
      const b = createBooking.parse(await a.request.json());
      selected(a, u);
      assert(
        can(u, b.branchId, "payments:write"),
        "예약 권한이 없습니다.",
        403,
        "FORBIDDEN",
      );
      return keyed(a, `reservations:create:${b.branchId}`, b, () => {
        const raw = store.db.rooms.find(
          (r) => r.id === b.roomId && can(u, r.branchId),
        );
        assert(raw, "룸을 찾을 수 없습니다.", 404, "NOT_FOUND");
        const r = room(raw);
        assert(
          r.branchId === b.branchId,
          "요청한 지점의 룸이 아닙니다.",
          422,
          "ROOM_BRANCH_MISMATCH",
        );
        running(b.branchId);
        assert(
          r.status === "사용 가능",
          "운영 중단된 룸입니다.",
          422,
          "ROOM_NOT_AVAILABLE",
        );
        const start = Date.parse(b.startAt),
          end = Date.parse(b.endAt),
          hours = (end - start) / 3600000;
        assert(
          start > Date.parse(store.now()) &&
            start % 3600000 === 0 &&
            end % 3600000 === 0 &&
            Number.isInteger(hours) &&
            hours >= 1 &&
            hours <= 24,
          "정시에 시작하고 1시간 단위로 24시간 이내여야 합니다.",
          422,
          "RESERVATION_TIME_INVALID",
        );
        assert(
          b.partySize <= r.capacity,
          "인원이 룸 정원을 넘습니다.",
          422,
          "RESERVATION_CAPACITY_EXCEEDED",
        );
        const c = store.db.members.find((c) => c.id === b.customerId);
        assert(
          c &&
            (u.owner ||
              c.branchIds.some((id) => can(u, id)) ||
              store.db.payments.some(
                (p) => p.memberId === c.id && can(u, p.branchId),
              )),
          "고객을 찾을 수 없습니다.",
          404,
          "NOT_FOUND",
        );
        rejectMergedCustomer(c, "CUSTOMER_NOT_ACTIVE");
        assert(
          c.status === "정상",
          "정상 상태 고객만 예약할 수 있습니다.",
          409,
          "CUSTOMER_NOT_ACTIVE",
        );
        assert(
          !store.db.reservations.some(
            (x) =>
              x.roomId === r.id &&
              ["예약 확정", "이용 중"].includes(x.status) &&
              Date.parse(x.startsAt) < end &&
              Date.parse(x.endsAt) > start,
          ),
          "다른 예약과 시간이 겹칩니다.",
          409,
          "ROOM_TIME_CONFLICT",
        );
        const closedDate = businessDate(b.startAt);
        if (closureRows(b.branchId).some((row) => row.date === closedDate))
          throw new DomainError(
            409,
            "BRANCH_CLOSED_DAY",
            "지점 휴무일에는 새 예약을 시작할 수 없어요.",
            undefined,
            undefined,
            undefined,
            { closedDate },
          );
        const now = store.now(),
          id = crypto.randomUUID(),
          approved = b.mockOutcome !== "FAILED",
          paymentId = crypto.randomUUID(),
          amount = r.ratePerHourKrw * hours;
        assert(
          Number.isSafeInteger(amount),
          "결제 금액이 허용 범위를 넘습니다.",
          422,
          "VALIDATION_FAILED",
        );
        store.db.payments.push({
          id: paymentId,
          version: 1,
          branchId: b.branchId,
          memberId: c.id,
          productId: "",
          reservationId: id,
          amount,
          method: b.method === "현금" ? "Mock 현금" : "Mock 카드",
          status: approved ? "승인" : "실패",
          refundAt: "",
          refundBranchId: "",
          reason: "",
          approvedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        const data: Booking = {
          id,
          version: 1,
          status: approved ? "확정" : "결제 실패",
          branchId: b.branchId,
          room: { id: r.id, roomNo: r.roomNo, name: r.name },
          customer: { id: c.id, memberNo: c.memberNo ?? c.id, name: c.name },
          startAt: new Date(start).toISOString(),
          endAt: new Date(end).toISOString(),
          billing: {
            ratePerHourKrw: r.ratePerHourKrw,
            hours,
            amountKrw: amount,
            paymentId,
            paymentStatus: approved ? "승인" : "실패",
          },
          usage: null,
          cancelledAt: null,
          cancelledBy: null,
          cancelReason: null,
          createdBy: actor(u.id)!,
          createdAt: now,
          canCancel: approved,
        };
        return booking(saveBooking(data, b.partySize), u);
      });
    }, 201),
  ),
  http.post(
    "/api/room-reservations/:id/cancel",
    respond(async (a, u) => {
      const raw = readBooking(a, u),
        b = z
          .object({ version, reason: text.max(500) })
          .strict()
          .parse(await a.request.json());
      assert(
        can(u, raw.branchId, "payments:write"),
        "취소 권한이 없습니다.",
        403,
        "FORBIDDEN",
      );
      return keyed(a, `reservations:cancel:${raw.id}`, b, () => {
        const data = booking(raw, u, true);
        current(b.version, data.version, `/api/room-reservations/${data.id}`);
        assert(
          data.status === "확정" &&
            Date.parse(data.startAt) > Date.parse(store.now()),
          "시작 시각 전의 확정 예약만 취소할 수 있습니다.",
          409,
          "RESERVATION_NOT_CANCELLABLE",
        );
        const now = store.now(),
          payment = store.db.payments.find(
            (p) => p.id === data.billing?.paymentId,
          );
        if (payment) {
          payment.status = "환불";
          payment.refundAt = now;
          payment.refundBranchId = raw.branchId;
          payment.reason = b.reason;
          payment.version++;
        }
        const result = {
          ...data,
          version: data.version + 1,
          status: "취소" as const,
          cancelledAt: now,
          cancelledBy: actor(u.id),
          cancelReason: b.reason,
          billing: data.billing
            ? { ...data.billing, paymentStatus: "환불" as const }
            : null,
          canCancel: false,
        };
        return booking(saveBooking(result, raw.people), u);
      });
    }),
  ),
  ...(["start", "complete"] as const).map((action) =>
    http.post(
      `/api/room-reservations/:id/${action}`,
      respond(async (a, u) => {
        const raw = readBooking(a, u),
          data = booking(raw, u, true),
          b = z
            .object({ version })
            .strict()
            .parse(await a.request.json());
        current(b.version, data.version, `/api/room-reservations/${data.id}`);
        const now = store.now();
        if (action === "start") {
          assert(
            data.status === "확정",
            "확정 예약만 이용을 시작할 수 있습니다.",
            409,
            "INVALID_STATE",
          );
          running(data.branchId);
          assert(
            room(store.db.rooms.find((r) => r.id === raw.roomId)!).status ===
              "사용 가능",
            "운영 중단된 룸입니다.",
            409,
            "ROOM_BLOCKED",
          );
          assert(
            !store.db.reservations.some(
              (r) => r.roomId === raw.roomId && r.status === "이용 중",
            ),
            "같은 룸에 이용 중인 예약이 있습니다.",
            409,
            "ROOM_IN_USE",
          );
          return booking(
            saveBooking(
              {
                ...data,
                version: data.version + 1,
                status: "이용 중",
                canCancel: false,
                usage: {
                  startedAt: now,
                  startedBy: actor(u.id),
                  endedAt: null,
                  endedBy: null,
                },
              },
              raw.people,
            ),
            u,
          );
        }
        assert(
          data.status === "이용 중" && data.usage,
          "이용 중인 예약만 완료할 수 있습니다.",
          409,
          "INVALID_STATE",
        );
        return booking(
          saveBooking(
            {
              ...data,
              version: data.version + 1,
              status: "완료",
              usage: { ...data.usage, endedAt: now, endedBy: actor(u.id) },
            },
            raw.people,
          ),
          u,
        );
      }),
    ),
  ),
];
