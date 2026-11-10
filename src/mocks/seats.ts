import { rememberCustomerLookup } from "./customer-lookup-access";
/** M5 contract adapter over the shared demo seat, usage and pass ledgers. */
import { delay } from "msw";
import { http, HttpResponse } from "msw/http";
import { z } from "zod";
import type { components } from "../shared/api/foundation.generated";
import { admin, can } from "../shared/domain/schema";
import type { Employee, ResourceMap } from "../shared/domain/schema";
import { assert, DomainError, store } from "./store";
import { matchesCustomer, rejectMergedCustomer } from "./customer-identity";
import { recordUsage } from "./pass-history";

type Seat = components["schemas"]["Seat"];
type Session = components["schemas"]["SeatSession"];
type SeatRow = ResourceMap["seats"];
type Usage = ResourceMap["usage"];
type Pass = ResourceMap["passes"];
type Args = {
  request: Request;
  params: Record<string, string | readonly string[] | undefined>;
};
type Metadata = {
  checkedInBy: Session["checkedInBy"];
  checkInReason: string | null;
  moves: Session["moves"];
  deductedMinutes: number;
  deductedKrw: number;
  overageMinutes: number;
  overageKrw: number;
};
type State = {
  accepted: Map<string, { fingerprint: string; result: unknown }>;
};
// Reset replaces the event ledger; a rejected request must not discard accepted keys.
const states = new WeakMap<typeof store.events, State>();
function state(): State {
  let value = states.get(store.events);
  if (!value) {
    value = { accepted: new Map() };
    states.set(store.events, value);
  }
  return value;
}
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const kind = z.enum(["일반", "모니터", "기타"]);
const status = z.enum(["사용 가능", "운영 중단"]);
const zone = z.string().trim().min(1).max(80);
const seatNo = z.string().trim().min(1).max(30);
const id = z.string().min(1);
const reason = z.string().trim().max(500).optional();
const createInput = z
  .object({
    branchId: id,
    zone,
    seatNo,
    kind,
    status: status.default("사용 가능"),
  })
  .strict();
const updateInput = z
  .object({
    version,
    zone: zone.optional(),
    seatNo: seatNo.optional(),
    kind: kind.optional(),
  })
  .strict();
const statusInput = z
  .object({ version, status, reason: z.string().trim().min(1).max(500) })
  .strict();
const checkInInput = z
  .object({ seatId: id, customerId: id, passId: id, reason })
  .strict();
const checkOutInput = z.object({ reason }).strict();
const moveInput = z.object({ toSeatId: id, reason }).strict();
const lookupInput = z
  .object({
    branchId: id,
    memberNo: z.string().trim().min(1).max(40).optional(),
    phone: z
      .string()
      .transform((v) => v.replace(/[\s-]/g, ""))
      .pipe(z.string().regex(/^[0-9]{9,11}$/))
      .optional(),
  })
  .strict()
  .refine((v) => (v.memberNo === undefined) !== (v.phone === undefined), {
    path: ["memberNo"],
    message: "회원번호와 연락처 중 하나만 입력해 주세요.",
  });
const readable = (actor: Employee, branchId: string) =>
  store.db.branches.some((b) => b.id === branchId) && can(actor, branchId);
function writable(actor: Employee, branchId: string, manager = false) {
  assert(
    readable(actor, branchId) &&
      can(actor, branchId, "operations:write") &&
      (!manager || admin(actor, branchId)),
    "좌석 운영 권한이 없습니다.",
    403,
    "FORBIDDEN",
  );
}
function branches(actor: Employee, request: Request) {
  const scope = new URL(request.url).searchParams.get("scope") || "all";
  assert(
    scope === "all" || readable(actor, scope),
    "지점에 접근할 수 없습니다.",
    403,
    "FORBIDDEN",
  );
  return store.db.branches
    .filter((b) => (scope === "all" || b.id === scope) && readable(actor, b.id))
    .map((b) => b.id)
    .sort();
}
const active = (seatId: string) =>
  store.db.usage.find((u) => u.seatId === seatId && u.status === "이용 중");
const customer = (customerId: string) => {
  const row = store.get("members", customerId);
  return {
    id: row.id,
    memberNo: row.memberNo ?? `DEMO-${row.id}`,
    name: row.name,
  };
};
const actorSummary = (actor: Employee) => ({ id: actor.id, name: actor.name });
const ref = (row: SeatRow) => ({
  id: row.id,
  zone: row.zone,
  seatNo: row.name,
});
function seatView(row: SeatRow): Seat {
  const current = active(row.id);
  return {
    id: row.id,
    version: row.version,
    branchId: row.branchId,
    zone: row.zone,
    seatNo: row.name,
    kind: row.kind ?? "일반",
    status: current
      ? "사용 중"
      : row.status === "사용 불가"
        ? "운영 중단"
        : "사용 가능",
    activeSession: current
      ? {
          id: current.id,
          customer: customer(current.memberId),
          checkedInAt: current.startedAt,
        }
      : null,
    createdAt: row.createdAt,
  };
}
function metadata(row: Usage): Metadata {
  let value = row.seatSession;
  if (!value) {
    const pass = store.get("passes", row.passId);
    value = {
      checkedInBy: actorSummary(store.get("employees", "owner")),
      checkInReason: null,
      moves: [],
      deductedMinutes: pass.kind === "시간권" ? row.charged : 0,
      deductedKrw: pass.kind === "정액권" ? row.charged : 0,
      overageMinutes: pass.kind !== "정액권" ? row.excess : 0,
      overageKrw: pass.kind === "정액권" ? row.excess : 0,
    };
    row.seatSession = value;
  }
  return value;
}
function sessionView(row: Usage, command = false, detail = true): Session {
  const pass = store.get("passes", row.passId),
    saved = metadata(row),
    showBalance = command || row.status === "이용 중";
  return {
    id: row.id,
    version: row.version,
    status: row.status === "이용 중" ? "이용 중" : "종료",
    branchId: row.branchId,
    seat: ref(store.get("seats", row.seatId)),
    customer: customer(row.memberId),
    pass: {
      id: pass.id,
      kind: pass.kind,
      productName: pass.name,
      purchaseBranchId: pass.branchId,
    },
    checkedInAt: row.startedAt,
    checkedOutAt: row.endedAt || null,
    usedMinutes: row.minutes,
    deductedMinutes: saved.deductedMinutes,
    deductedKrw: saved.deductedKrw,
    overageMinutes: saved.overageMinutes,
    overageKrw: saved.overageKrw,
    passRemainingMinutes:
      showBalance && pass.kind === "시간권" ? pass.remaining : null,
    passRemainingCreditKrw:
      showBalance && pass.kind === "정액권" ? pass.remaining : null,
    checkedInBy: saved.checkedInBy,
    checkInReason: saved.checkInReason,
    moves: detail ? structuredClone(saved.moves) : [],
  };
}
function readSeat(a: Args, actor: Employee, withScope = true) {
  const allowed = withScope ? branches(actor, a.request) : null;
  const row = store.db.seats.find(
    (s) =>
      s.id === a.params.id &&
      readable(actor, s.branchId) &&
      (!allowed || allowed.includes(s.branchId)),
  );
  assert(row, "좌석을 찾을 수 없습니다.", 404, "NOT_FOUND");
  return row;
}
function readSession(a: Args, actor: Employee, withScope = false) {
  const allowed = withScope ? branches(actor, a.request) : null;
  const row = store.db.usage.find(
    (u) =>
      u.id === a.params.id &&
      readable(actor, u.branchId) &&
      (!allowed || allowed.includes(u.branchId)),
  );
  assert(row, "이용 기록을 찾을 수 없습니다.", 404, "NOT_FOUND");
  return row;
}
function checkVersion(row: SeatRow, expected: number) {
  if (row.version !== expected || store.scenario === "conflict")
    throw new DomainError(
      409,
      "VERSION_CONFLICT",
      "최신 좌석을 확인한 뒤 다시 저장해 주세요.",
      undefined,
      row.version,
      `/api/seats/${row.id}`,
    );
}
function unique(branchId: string, number: string, except?: string) {
  assert(
    !store.db.seats.some(
      (s) => s.branchId === branchId && s.name === number && s.id !== except,
    ),
    "같은 좌석 번호가 있습니다.",
    409,
    "DUPLICATE_SEAT_NO",
  );
}
function running(branchId: string) {
  assert(
    store.get("branches", branchId).status === "운영 중",
    "운영 중지 지점입니다.",
    409,
    "BRANCH_NOT_ACTIVE",
  );
}
function available(row: SeatRow) {
  assert(
    row.status !== "사용 불가",
    "운영 중단 좌석입니다.",
    409,
    "SEAT_BLOCKED",
  );
  assert(!active(row.id), "이미 사용 중인 좌석입니다.", 409, "SEAT_OCCUPIED");
}
function passError(pass: Pass, now: string) {
  if (pass.status === "환불") return "PASS_REFUNDED";
  if (pass.expiresAt && Date.parse(pass.expiresAt) <= Date.parse(now))
    return "PASS_EXPIRED";
  if (pass.status === "소진" || (pass.kind !== "기간권" && pass.remaining <= 0))
    return "PASS_EXHAUSTED";
  return null;
}
function counts(
  branchId: string,
  rows: Seat[],
  asOf: string,
): components["schemas"]["SeatCounts"] {
  const total = rows.length,
    inUse = rows.filter((s) => s.status === "사용 중").length;
  return {
    branchId,
    total,
    inUse,
    available: rows.filter((s) => s.status === "사용 가능").length,
    blocked: rows.filter((s) => s.status === "운영 중단").length,
    occupancyRate: total ? Math.round((inUse / total) * 1000) / 10 : null,
    asOf,
  };
}
function filtered(request: Request, actor: Employee) {
  const query = new URL(request.url).searchParams,
    allowed = branches(actor, request);
  if (query.has("kind")) kind.parse(query.get("kind"));
  if (query.has("status"))
    z.enum(["사용 가능", "사용 중", "운영 중단"]).parse(query.get("status"));
  return (store.scenario === "empty" ? [] : store.db.seats)
    .filter((s) => allowed.includes(s.branchId))
    .map(seatView)
    .filter(
      (s) =>
        (!query.has("zone") || s.zone === query.get("zone")) &&
        (!query.has("kind") || s.kind === query.get("kind")) &&
        (!query.has("status") || s.status === query.get("status")),
    )
    .sort(
      (a, b) =>
        a.zone.localeCompare(b.zone) ||
        a.seatNo.localeCompare(b.seatNo) ||
        a.id.localeCompare(b.id),
    );
}
function page<T>(request: Request, rows: T[]) {
  const query = new URL(request.url).searchParams,
    current = Number(query.get("page") || 1),
    size = Number(query.get("pageSize") || 20);
  assert(
    Number.isSafeInteger(current) &&
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
async function json(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new DomainError(
      422,
      "VALIDATION_FAILED",
      "JSON 입력을 확인해 주세요.",
    );
  }
}
function transact<T>(
  a: Args,
  operation: string,
  scope: string,
  input: unknown,
  action: () => T,
): T {
  const key = a.request.headers.get("Idempotency-Key");
  assert(
    key && key.length >= 16 && key.length <= 128,
    "요청 키를 확인해 주세요.",
    422,
    "VALIDATION_FAILED",
  );
  const index = `${store.persona}:${operation}:${scope}:${key}`,
    fingerprint = JSON.stringify(input),
    previous = state().accepted.get(index);
  if (previous) {
    assert(
      previous.fingerprint === fingerprint,
      "동일 요청 키에 다른 내용이 전달되었습니다.",
      409,
      "IDEMPOTENCY_CONFLICT",
    );
    return structuredClone(previous.result) as T;
  }
  const result = action();
  state().accepted.set(index, { fingerprint, result: structuredClone(result) });
  store.persist();
  return result;
}
const response =
  (
    fn: (a: Args, actor: Employee) => unknown | Promise<unknown>,
    status = 200,
  ) =>
  async (a: Args) => {
    try {
      const actorId = store.activeUser().id;
      if (store.scenario === "slow") await delay(2200);
      const actor = store.activeUser();
      assert(
        actor.id === actorId,
        "계정이 변경되었습니다.",
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
          "CSRF 토큰을 확인해 주세요.",
          403,
          "CSRF_INVALID",
        );
      return HttpResponse.json(
        (await fn(a, actor)) as Record<string, unknown>,
        { status, headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      const failure =
        error instanceof z.ZodError
          ? new DomainError(
              422,
              "VALIDATION_FAILED",
              "입력을 확인해 주세요.",
              Object.fromEntries(
                error.issues.map((i) => [
                  i.path.join(".") || "body",
                  i.message,
                ]),
              ),
            )
          : error instanceof DomainError
            ? error
            : new DomainError(500, "MOCK_ERROR", "요청을 처리하지 못했습니다.");
      return HttpResponse.json(
        {
          code: failure.code,
          message: failure.message,
          fieldErrors: failure.fieldErrors,
          latestVersion: failure.latestVersion,
          reloadUrl: failure.reloadUrl,
          ...failure.target,
          requestId: crypto.randomUUID(),
        },
        { status: failure.status },
      );
    }
  };
function seatChanged(row: SeatRow) {
  row.version++;
  row.updatedAt = store.now();
  store.emit("seats", row.id, row.branchId);
}
function sessionChanged(row: Usage) {
  store.emit("seats", row.seatId, row.branchId);
  store.emit("seat-sessions", row.id, row.branchId);
  // The generic workspace event uses the legacy usage resource for home consumers.
  store.emit("usage", row.id, row.branchId);
}
export const seatHandlers = [
  http.get(
    "/api/seats/board",
    response((a, actor) => {
      const query = new URL(a.request.url).searchParams,
        branchId = id.parse(query.get("branchId"));
      assert(
        readable(actor, branchId),
        "지점에 접근할 수 없습니다.",
        403,
        "FORBIDDEN",
      );
      if (query.has("kind")) kind.parse(query.get("kind"));
      const rows = (store.scenario === "empty" ? [] : store.db.seats)
        .filter((s) => s.branchId === branchId)
        .map(seatView)
        .filter((s) => !query.has("kind") || s.kind === query.get("kind"))
        .sort(
          (a, b) =>
            a.zone.localeCompare(b.zone) ||
            a.seatNo.localeCompare(b.seatNo) ||
            a.id.localeCompare(b.id),
        );
      return {
        counts: counts(branchId, rows, store.now()),
        zones: [...new Set(rows.map((s) => s.zone))].map((zone) => ({
          zone,
          seats: rows.filter((s) => s.zone === zone),
        })),
      };
    }),
  ),
  http.get(
    "/api/seats/occupancy",
    response((a, actor) => {
      const asOf = store.now();
      return {
        items: branches(actor, a.request).map((branchId) =>
          counts(
            branchId,
            (store.scenario === "empty" ? [] : store.db.seats)
              .filter((s) => s.branchId === branchId)
              .map(seatView),
            asOf,
          ),
        ),
      };
    }),
  ),
  http.get(
    "/api/seats",
    response((a, actor) => page(a.request, filtered(a.request, actor))),
  ),
  http.get(
    "/api/seats/:id",
    response((a, actor) => seatView(readSeat(a, actor))),
  ),
  http.post(
    "/api/seats",
    response(async (a, actor) => {
      const input = createInput.parse(await json(a.request));
      assert(
        branches(actor, a.request).includes(input.branchId),
        "지점에 접근할 수 없습니다.",
        403,
        "FORBIDDEN",
      );
      writable(actor, input.branchId);
      return transact(a, "create", input.branchId, input, () => {
        unique(input.branchId, input.seatNo);
        const row = store.add("seats", input.branchId, {
          name: input.seatNo,
          zone: input.zone,
          status: input.status === "운영 중단" ? "사용 불가" : "이용 가능",
          memberId: "",
        });
        row.kind = input.kind;
        store.emit("seats", row.id, row.branchId);
        return seatView(row);
      });
    }, 201),
  ),
  http.patch(
    "/api/seats/:id",
    response(async (a, actor) => {
      const raw = await json(a.request);
      assert(
        !raw ||
          typeof raw !== "object" ||
          !["branchId", "status"].some((k) => k in raw),
        "변경할 수 없는 필드입니다.",
        422,
        "IMMUTABLE_FIELD",
      );
      const input = updateInput.parse(raw),
        row = readSeat(a, actor);
      writable(actor, row.branchId);
      checkVersion(row, input.version);
      if (input.seatNo !== undefined)
        unique(row.branchId, input.seatNo, row.id);
      const before = JSON.stringify(seatView(row));
      if (input.zone !== undefined) row.zone = input.zone;
      if (input.seatNo !== undefined) row.name = input.seatNo;
      if (input.kind !== undefined) row.kind = input.kind;
      if (before !== JSON.stringify(seatView(row))) seatChanged(row);
      return seatView(row);
    }),
  ),
  http.post(
    "/api/seats/:id/status",
    response(async (a, actor) => {
      const input = statusInput.parse(await json(a.request)),
        row = readSeat(a, actor);
      writable(actor, row.branchId, true);
      checkVersion(row, input.version);
      if (input.status === "운영 중단")
        assert(!active(row.id), "사용 중인 좌석입니다.", 409, "SEAT_OCCUPIED");
      const next = input.status === "운영 중단" ? "사용 불가" : "이용 가능";
      if (row.status !== next) {
        row.status = next;
        seatChanged(row);
      }
      return seatView(row);
    }),
  ),
  http.post(
    "/api/customer-lookups/check-in",
    response(async (a, actor) => {
      const input = lookupInput.parse(await json(a.request));
      assert(
        readable(actor, input.branchId),
        "지점에 접근할 수 없습니다.",
        403,
        "FORBIDDEN",
      );
      const now = store.now();
      const matched = (
        store.scenario === "empty" ? [] : store.db.members
      ).filter((m) =>
        input.memberNo !== undefined
          ? customer(m.id).memberNo === input.memberNo
          : m.phone.replace(/[\s-]/g, "") === input.phone,
      );
      const targetIds = new Set(
        matched.map((m) => m.mergedIntoCustomerId ?? m.id),
      );
      return {
        items: store.db.members
          .filter((m) => targetIds.has(m.id) && m.status !== "병합됨")
          .sort((a, b) =>
            customer(a.id).memberNo.localeCompare(customer(b.id).memberNo),
          )
          .slice(0, 10)
          .map((m) => {
            rememberCustomerLookup(actor.id, input.branchId, m.id);
            const current = store.db.usage.find(
              (u) => u.memberId === m.id && u.status === "이용 중",
            );
            return {
              customer: customer(m.id),
              status: m.status,
              activeSession: current
                ? {
                    id: current.id,
                    branchId: current.branchId,
                    checkedInAt: current.startedAt,
                  }
                : null,
              usablePasses: store.db.passes
                .filter(
                  (p) =>
                    matchesCustomer(p.memberId, m.id) && !passError(p, now),
                )
                .map((p) => ({
                  id: p.id,
                  kind: p.kind,
                  productName: p.name,
                  remainingMinutes: p.kind === "시간권" ? p.remaining : null,
                  remainingCreditKrw: p.kind === "정액권" ? p.remaining : null,
                  expiresAt: p.expiresAt || null,
                  purchaseBranchId: p.branchId,
                })),
            };
          }),
      };
    }),
  ),
  http.post(
    "/api/seat-sessions",
    response(async (a, actor) => {
      const input = checkInInput.parse(await json(a.request)),
        seat = readSeat({ ...a, params: { id: input.seatId } }, actor, false);
      return transact(a, "check-in", seat.id, input, () => {
        running(seat.branchId);
        available(seat);
        const member = store.get("members", input.customerId);
        rejectMergedCustomer(member, "CUSTOMER_NOT_ACTIVE");
        const pass = store.db.passes.find(
          (p) =>
            p.id === input.passId &&
            matchesCustomer(p.memberId, input.customerId),
        );
        assert(pass, "이용권을 찾을 수 없습니다.", 404, "NOT_FOUND");
        assert(
          member.status === "정상",
          "입실할 수 없는 고객입니다.",
          409,
          "CUSTOMER_NOT_ACTIVE",
        );
        assert(
          !store.db.usage.some(
            (u) => u.memberId === member.id && u.status === "이용 중",
          ),
          "이미 입실 중인 고객입니다.",
          409,
          "CUSTOMER_ALREADY_CHECKED_IN",
        );
        const now = store.now(),
          failure = passError(pass, now);
        assert(
          !failure,
          "사용할 수 없는 이용권입니다.",
          409,
          failure || "INVALID_STATE",
        );
        const row = store.add("usage", seat.branchId, {
          memberId: member.id,
          passId: pass.id,
          seatId: seat.id,
          startedAt: now,
          endedAt: "",
          minutes: 0,
          charged: 0,
          excess: 0,
          status: "이용 중",
        });
        row.seatSession = {
          checkedInBy: actorSummary(actor),
          checkInReason: input.reason || null,
          moves: [],
          deductedMinutes: 0,
          deductedKrw: 0,
          overageMinutes: 0,
          overageKrw: 0,
        };
        seat.status = "이용 중";
        seat.memberId = member.id;
        pass.used = true;
        sessionChanged(row);
        return sessionView(row, true);
      });
    }, 201),
  ),
  http.get(
    "/api/seat-sessions",
    response((a, actor) => {
      const query = new URL(a.request.url).searchParams,
        allowed = branches(actor, a.request);
      if (query.has("status"))
        z.enum(["이용 중", "종료"]).parse(query.get("status"));
      for (const key of ["from", "to"])
        if (query.has(key))
          z.iso.datetime({ offset: true }).parse(query.get(key));
      assert(
        !query.has("sort") || query.get("sort") === "checkedInAt",
        "정렬 조건을 확인해 주세요.",
        422,
        "VALIDATION_FAILED",
      );
      const direction = query.get("direction") || "desc";
      assert(
        ["asc", "desc"].includes(direction),
        "정렬 조건을 확인해 주세요.",
        422,
        "VALIDATION_FAILED",
      );
      const rows = (store.scenario === "empty" ? [] : store.db.usage)
        .filter(
          (u) =>
            allowed.includes(u.branchId) &&
            (!query.has("status") ||
              (u.status === "이용 중" ? "이용 중" : "종료") ===
                query.get("status")) &&
            (!query.has("seatId") || u.seatId === query.get("seatId")) &&
            (!query.has("customerId") ||
              matchesCustomer(u.memberId, query.get("customerId")!)) &&
            (!query.has("from") ||
              Date.parse(u.startedAt) >= Date.parse(query.get("from")!)) &&
            (!query.has("to") ||
              Date.parse(u.startedAt) < Date.parse(query.get("to")!)),
        )
        .sort(
          (a, b) =>
            (a.startedAt.localeCompare(b.startedAt) ||
              a.id.localeCompare(b.id)) * (direction === "asc" ? 1 : -1),
        );
      return page(
        a.request,
        rows.map((u) => sessionView(u, false, false)),
      );
    }),
  ),
  http.get(
    "/api/seat-sessions/:id",
    response((a, actor) => sessionView(readSession(a, actor, true))),
  ),
  http.post(
    "/api/seat-sessions/:id/check-out",
    response(async (a, actor) => {
      const input = checkOutInput.parse(await json(a.request)),
        row = readSession(a, actor);
      return transact(a, "check-out", row.id, input, () => {
        assert(
          row.status === "이용 중",
          "이미 종료된 이용입니다.",
          409,
          "SESSION_ALREADY_CLOSED",
        );
        const pass = store.get("passes", row.passId),
          seat = store.get("seats", row.seatId),
          now = store.now(),
          used = Math.max(
            0,
            Math.ceil((Date.parse(now) - Date.parse(row.startedAt)) / 60000),
          ),
          beforeExpiry =
            pass.expiresAt && Date.parse(now) > Date.parse(pass.expiresAt)
              ? Math.max(
                  0,
                  Math.min(
                    used,
                    Math.ceil(
                      (Date.parse(pass.expiresAt) - Date.parse(row.startedAt)) /
                        60000,
                    ),
                  ),
                )
              : used,
          afterExpiry = used - beforeExpiry,
          saved = metadata(row);
        if (pass.kind === "시간권") {
          saved.deductedMinutes = Math.min(beforeExpiry, pass.remaining);
          saved.overageMinutes =
            afterExpiry + beforeExpiry - saved.deductedMinutes;
          pass.remaining -= saved.deductedMinutes;
        } else if (pass.kind === "정액권") {
          const charge = Math.ceil((beforeExpiry * pass.hourlyRate) / 60);
          saved.deductedKrw = Math.min(charge, pass.remaining);
          saved.overageKrw = charge - saved.deductedKrw;
          saved.overageMinutes = afterExpiry;
          pass.remaining -= saved.deductedKrw;
        } else saved.overageMinutes = afterExpiry;
        row.minutes = used;
        row.charged = saved.deductedMinutes + saved.deductedKrw;
        row.excess =
          pass.kind === "정액권" ? saved.overageKrw : saved.overageMinutes;
        row.status = "완료";
        row.endedAt = now;
        recordUsage(row, actor, input.reason);
        row.updatedAt = now;
        row.version++;
        if (pass.kind !== "기간권" && pass.remaining === 0)
          pass.status = "소진";
        if (row.charged > 0) {
          pass.version++;
          pass.updatedAt = now;
        }
        seat.status = "이용 가능";
        seat.memberId = "";
        sessionChanged(row);
        store.emit("passes", pass.id, pass.branchId);
        return sessionView(row, true);
      });
    }),
  ),
  http.post(
    "/api/seat-sessions/:id/move",
    response(async (a, actor) => {
      const input = moveInput.parse(await json(a.request)),
        row = readSession(a, actor);
      writable(actor, row.branchId);
      return transact(a, "move", row.id, input, () => {
        assert(
          row.status === "이용 중",
          "이미 종료된 이용입니다.",
          409,
          "SESSION_ALREADY_CLOSED",
        );
        running(row.branchId);
        const destination = store.db.seats.find(
          (s) =>
            s.id === input.toSeatId &&
            s.branchId === row.branchId &&
            s.id !== row.seatId,
        );
        assert(
          destination,
          "같은 지점의 다른 좌석을 선택해 주세요.",
          422,
          "VALIDATION_FAILED",
        );
        available(destination);
        const original = store.get("seats", row.seatId),
          now = store.now();
        metadata(row).moves.push({
          fromSeat: ref(original),
          toSeat: ref(destination),
          movedAt: now,
          movedBy: actorSummary(actor),
          reason: input.reason || null,
        });
        original.status = "이용 가능";
        original.memberId = "";
        destination.status = "이용 중";
        destination.memberId = row.memberId;
        row.seatId = destination.id;
        row.updatedAt = now;
        row.version++;
        store.emit("seats", original.id, original.branchId);
        sessionChanged(row);
        return sessionView(row, true);
      });
    }),
  ),
];
export { seatView, counts as seatCounts };
