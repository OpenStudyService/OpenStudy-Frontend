import { z } from "zod";
import {
  admin,
  businessDate,
  can,
  charge,
  overlap,
  schemas,
  text,
} from "../shared/domain/schema";
import type {
  Database,
  Employee,
  Entity,
  Resource,
} from "../shared/domain/schema";
import { catalog, readPermission } from "../shared/domain/catalog";
import { assert, DomainError, MockStore } from "./store";

export const bodySchema = z.record(z.string(), z.unknown());
const str = (p: Record<string, unknown>, k: string) => String(p[k] ?? "");
const num = (p: Record<string, unknown>, k: string) => Number(p[k] ?? 0);
const dayPlus = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);
export function inScope(user: Employee, row: Entity, scope = "all") {
  if ("memberships" in row)
    return (
      user.owner ||
      row.memberships.some(
        (m) =>
          can(user, m.branchId) && (scope === "all" || scope === m.branchId),
      )
    );
  if (row.branchId === "all") return true;
  if (scope !== "all" && row.branchId !== scope) return false;
  return can(user, row.branchId);
}
export function checkRead(store: MockStore, resource: Resource, scope: string) {
  const user = store.activeUser();
  assert(
    can(user, scope),
    "이 지점에 접근할 권한이 없습니다.",
    403,
    "SCOPE_DENIED",
  );
  const def = catalog[resource],
    permission = readPermission(resource);
  if (def?.admin && !["shifts", "channels"].includes(resource))
    assert(
      admin(user, scope),
      "관리자만 접근할 수 있습니다.",
      403,
      "SCOPE_DENIED",
    );
  if (permission)
    assert(
      can(user, scope, permission),
      "이 정보를 조회할 권한이 없습니다.",
      403,
      "SCOPE_DENIED",
    );
  return user;
}
export function rowsFor(store: MockStore, resource: Resource, scope: string) {
  const user = checkRead(store, resource, scope);
  let rows: Entity[] = (store.db[resource] as Entity[]).filter((row) =>
    inScope(user, row, scope),
  );
  const permission = readPermission(resource);
  if (permission)
    rows = rows.filter((row) => can(user, row.branchId, permission));
  if (
    catalog[resource]?.admin &&
    !["shifts", "channels", "employees"].includes(resource)
  )
    rows = rows.filter((row) => admin(user, row.branchId));
  if (resource === "employees")
    rows = rows.filter(
      (row) =>
        user.owner ||
        store
          .get("employees", row.id)
          .memberships.some(
            (m) => can(user, m.branchId) && admin(user, m.branchId),
          ),
    );
  if (resource === "members")
    rows = store.db.members.filter((m) =>
      m.branchIds.some((b) => can(user, b) && (scope === "all" || b === scope)),
    );
  if (resource === "notices" && !admin(user, scope))
    rows = rows.filter((r) => text(r, "status") === "게시 중");
  if (
    ["attendance", "corrections", "leaveRequests", "substitutions"].includes(
      resource,
    ) &&
    !admin(user, scope)
  )
    rows = rows.filter((r) => text(r, "employeeId") === user.id);
  if (resource === "channels")
    rows = rows.filter((r) =>
      store.get("channels", r.id).participantIds.includes(user.id),
    );
  if (resource === "messages")
    rows = rows.filter((r) =>
      store
        .get("channels", text(r, "channelId"))
        .participantIds.includes(user.id),
    );
  if (resource === "passes")
    rows = rows.map((row) => {
      const pass = schemas.passes.parse(row);
      return pass.status !== "환불" &&
        Date.parse(pass.expiresAt) <= Date.parse(store.now())
        ? { ...pass, status: "만료" as const }
        : pass;
    });
  if (resource === "lockers")
    rows = rows.map((row) => {
      const locker = schemas.lockers.parse(row);
      return locker.memberId && locker.endsOn < businessDate(store.now())
        ? { ...locker, status: "기간 만료" as const }
        : locker;
    });
  return rows;
}
export function writable(
  store: MockStore,
  resource: Resource,
  branchId: string,
) {
  const user = store.activeUser();
  assert(can(user, branchId), "지점 권한이 없습니다.", 403, "SCOPE_DENIED");
  const def = catalog[resource];
  assert(def, "지원하지 않는 작업입니다.", 404, "NOT_FOUND");
  if (def.admin || resource === "tasks")
    assert(
      admin(user, branchId),
      "관리자만 등록·배정할 수 있습니다.",
      403,
      "SCOPE_DENIED",
    );
  if (def.permission)
    assert(
      can(user, branchId, def.permission),
      "변경 권한이 없습니다.",
      403,
      "SCOPE_DENIED",
    );
  if (resource === "products")
    assert(
      user.owner,
      "전사 상품은 전체 관리자만 변경할 수 있습니다.",
      403,
      "SCOPE_DENIED",
    );
  return user;
}
function activeBranch(store: MockStore, id: string) {
  assert(id !== "all", "변경할 지점을 선택해 주세요.", 422, "VALIDATION_ERROR");
  assert(
    store.get("branches", id).status === "운영 중",
    "운영 중지 지점입니다.",
  );
}
function memberOk(store: MockStore, id: string, branchId: string) {
  const m = store.get("members", id);
  assert(m.status === "정상", "이용 제한 또는 비활성 회원입니다.");
  if (!m.branchIds.includes(branchId)) m.branchIds.push(branchId);
  return m;
}
function staffOk(store: MockStore, id: string, branchId: string) {
  const u = store.get("employees", id);
  assert(
    u.status === "활성" &&
      (u.owner || u.memberships.some((m) => m.branchId === branchId)),
    "해당 지점의 활성 직원을 선택해 주세요.",
    422,
    "VALIDATION_ERROR",
  );
}
function interval(start: string, end: string) {
  assert(
    Number.isFinite(Date.parse(start)) &&
      Number.isFinite(Date.parse(end)) &&
      Date.parse(start) < Date.parse(end),
    "시작보다 늦은 종료 일시를 입력해 주세요.",
    422,
    "VALIDATION_ERROR",
  );
}
function shiftConflict(
  store: MockStore,
  employeeId: string,
  start: string,
  end: string,
  except = "",
) {
  assert(
    !store.db.shifts.some(
      (s) =>
        s.id !== except &&
        s.employeeId === employeeId &&
        s.status !== "취소" &&
        overlap(start, end, s.startsAt, s.endsAt),
    ),
    "직원의 근무 시간이 겹칩니다.",
  );
  assert(
    !store.db.leaveRequests.some(
      (l) =>
        l.employeeId === employeeId &&
        l.status === "승인" &&
        overlap(
          start,
          end,
          `${l.startsOn}T00:00:00+09:00`,
          `${dayPlus(l.endsOn, 1)}T00:00:00+09:00`,
        ),
    ),
    "승인된 휴가와 근무가 겹칩니다.",
  );
}
export function leaveBalance(store: MockStore, employeeId: string, on: string) {
  return (
    store.db.leaveGrants
      .filter(
        (g) =>
          g.employeeId === employeeId && g.startsOn <= on && g.endsOn >= on,
      )
      .reduce((s, g) => s + g.amount, 0) -
    store.db.leaveRequests
      .filter(
        (l) =>
          l.employeeId === employeeId &&
          l.status === "승인" &&
          l.startsOn <= on.slice(0, 4) + "-12-31",
      )
      .reduce((s, l) => s + l.amount, 0)
  );
}
function audit(
  store: MockStore,
  resource: Resource,
  id: string,
  action: string,
  before: unknown,
  after: unknown,
  branchId: string,
) {
  store.add("audit", branchId, {
    actorId: store.user().id,
    resource,
    targetId: id,
    action,
    before: JSON.stringify(before ?? null),
    after: JSON.stringify(after),
  });
}
const defaults: Partial<Record<Resource, Record<string, unknown>>> = {
  branches: { status: "운영 중" },
  tasks: {
    status: "할 일",
    priority: "보통",
    category: "운영",
    checks: [],
    history: [],
  },
  members: { email: "", status: "정상", note: "", branchIds: [] },
  products: { kind: "시간권", status: "판매 중", hourlyRate: 0, days: 90 },
  seats: { memberId: "", status: "이용 가능" },
  lockers: {
    memberId: "",
    startsOn: "",
    endsOn: "",
    status: "이용 가능",
    history: [],
  },
  rooms: { status: "이용 가능" },
  facilities: { condition: "점검 필요", status: "할 일", result: "" },
  inquiries: { reply: "", status: "접수" },
  notices: { pinned: false, status: "게시 중" },
  shifts: { breakMinutes: 0, status: "예정" },
  corrections: { status: "신청", decidedBy: "", original: "" },
  leaveRequests: { status: "신청", decidedBy: "" },
  substitutions: { status: "신청", decidedBy: "", original: "" },
  channels: { kind: "channel", reads: {}, status: "활성" },
};
export function create(
  store: MockStore,
  resource: Resource,
  p: Record<string, unknown>,
): Entity {
  const b = resource === "products" ? "all" : str(p, "branchId");
  const user = writable(store, resource, b);
  const inputFields = new Set([
    ...(catalog[resource]?.fields.map((f) => f.key) || []),
    "branchId",
  ]);
  assert(
    Object.keys(p).every((key) => inputFields.has(key)),
    "허용되지 않은 등록 필드입니다.",
    422,
    "VALIDATION_ERROR",
  );
  if (resource === "members") {
    const existing = store.db.members.find(
      (m) => m.phone.replace(/\D/g, "") === str(p, "phone").replace(/\D/g, ""),
    );
    if (existing) {
      assert(
        existing.name === str(p, "name").trim(),
        "같은 연락처의 고객이 있습니다. 등록 정보를 확인해 주세요.",
      );
      assert(
        !existing.branchIds.includes(b),
        "이미 이 지점에 등록된 고객입니다.",
      );
      activeBranch(store, b);
      const before = structuredClone(existing);
      existing.branchIds.push(b);
      existing.version++;
      existing.updatedAt = store.now();
      audit(
        store,
        resource,
        existing.id,
        "공통 고객 지점 연결",
        before,
        existing,
        b,
      );
      return existing;
    }
  }
  if (resource === "payments") return purchase(store, p);
  if (resource === "reservations") return reserve(store, p);
  if (resource === "invitations") {
    activeBranch(store, b);
    const email = z.email().parse(p.email);
    assert(
      !store.db.invitations.some(
        (i) =>
          i.email === email &&
          i.branchId === b &&
          ["초대 대기", "승인 대기"].includes(i.status),
      ),
      "같은 지점에 대기 중인 초대가 있습니다.",
    );
    assert(
      !store.db.employees.some(
        (e) => e.email === email && e.memberships.some((m) => m.branchId === b),
      ),
      "이미 소속된 직원입니다.",
    );
    return store.add("invitations", b, {
      email,
      name: z.string().trim().min(1).parse(p.name),
      role: z.enum(["staff", "admin"]).parse(p.role),
      status: "초대 대기",
      delivery:
        store.scenario === "email-failure" ? "발송 실패" : "발송 시뮬레이션",
      expiresAt: new Date(Date.parse(store.now()) + 86400000).toISOString(),
      token: crypto.randomUUID(),
      employeeId: "",
    });
  }
  assert(
    catalog[resource]?.create,
    "직접 등록할 수 없는 항목입니다.",
    405,
    "METHOD_NOT_ALLOWED",
  );
  if (resource === "branches") {
    assert(
      user.owner,
      "전체 관리자만 지점을 추가할 수 있습니다.",
      403,
      "SCOPE_DENIED",
    );
  } else if (
    resource !== "products" &&
    !(resource === "notices" && b === "all")
  )
    activeBranch(store, b);
  if (resource === "notices" && b === "all")
    assert(
      user.owner,
      "전체 공지는 전체 관리자만 작성할 수 있습니다.",
      403,
      "SCOPE_DENIED",
    );
  const at = store.now();
  const raw = {
    ...defaults[resource],
    ...p,
    id: crypto.randomUUID(),
    branchId: b || crypto.randomUUID(),
    version: 1,
    createdAt: at,
    updatedAt: at,
  };
  if (resource === "members") Object.assign(raw, { branchIds: [b] });
  if (resource === "channels") {
    const ids = z.array(z.string()).min(1).parse(p.participantIds);
    ids.forEach((id) => staffOk(store, id, b));
    Object.assign(raw, { participantIds: [...new Set([...ids, user.id])] });
  }
  if (resource === "tasks") {
    staffOk(store, str(p, "assigneeId"), b);
    Object.assign(raw, {
      history: [{ at, actorId: user.id, text: "업무 등록" }],
    });
  }
  if (resource === "facilities") {
    staffOk(store, str(p, "assigneeId"), b);
    Object.assign(raw, {
      nextCheck: dayPlus(str(p, "lastChecked"), num(p, "cycleDays")),
    });
  }
  if (resource === "inquiries") {
    memberOk(store, str(p, "memberId"), b);
    staffOk(store, str(p, "assigneeId"), b);
  }
  if (resource === "notices") Object.assign(raw, { authorId: user.id });
  if (resource === "branches") Object.assign(raw, { branchId: raw.id });
  if (resource === "shifts") {
    staffOk(store, str(p, "employeeId"), b);
    interval(str(p, "startsAt"), str(p, "endsAt"));
    shiftConflict(
      store,
      str(p, "employeeId"),
      str(p, "startsAt"),
      str(p, "endsAt"),
    );
    assert(
      num(p, "breakMinutes") <
        (Date.parse(str(p, "endsAt")) - Date.parse(str(p, "startsAt"))) / 60000,
      "휴게가 근무 시간보다 짧아야 합니다.",
      422,
      "VALIDATION_ERROR",
    );
  }
  if (resource === "leaveGrants") {
    staffOk(store, str(p, "employeeId"), b);
    assert(
      str(p, "startsOn") <= str(p, "endsOn"),
      "적용 기간을 확인해 주세요.",
      422,
      "VALIDATION_ERROR",
    );
  }
  if (["corrections", "leaveRequests", "substitutions"].includes(resource))
    Object.assign(raw, { employeeId: user.id });
  if (resource === "corrections") {
    const a = store.get("attendance", str(p, "attendanceId"));
    assert(
      a.employeeId === user.id && a.branchId === b,
      "본인의 근태만 정정할 수 있습니다.",
      403,
      "SCOPE_DENIED",
    );
    interval(str(p, "startedAt"), str(p, "endedAt"));
    assert(
      num(p, "breakMinutes") <=
        (Date.parse(str(p, "endedAt")) - Date.parse(str(p, "startedAt"))) /
          60000,
      "휴게 시간이 근무 시간을 초과합니다.",
      422,
      "VALIDATION_ERROR",
    );
    Object.assign(raw, { original: JSON.stringify(a) });
  }
  if (resource === "leaveRequests") {
    assert(
      str(p, "startsOn") <= str(p, "endsOn"),
      "휴가 기간을 확인해 주세요.",
      422,
      "VALIDATION_ERROR",
    );
    assert(
      !store.db.leaveRequests.some(
        (l) =>
          l.employeeId === user.id &&
          ["신청", "승인"].includes(l.status) &&
          l.startsOn <= str(p, "endsOn") &&
          str(p, "startsOn") <= l.endsOn,
      ),
      "이미 신청하거나 승인된 휴가 기간입니다.",
    );
  }
  if (resource === "substitutions") {
    const shift = store.get("shifts", str(p, "shiftId"));
    assert(
      shift.employeeId === user.id && shift.branchId === b,
      "본인 근무만 변경 신청할 수 있습니다.",
      403,
      "SCOPE_DENIED",
    );
    staffOk(store, str(p, "substituteId"), b);
    interval(str(p, "startsAt"), str(p, "endsAt"));
    Object.assign(raw, { original: JSON.stringify(shift) });
  }
  const row = schemas[resource].parse(raw) as Entity;
  (store.db[resource] as Entity[]).push(row);
  audit(store, resource, row.id, "등록", null, row, row.branchId);
  return row;
}
export function update(
  store: MockStore,
  resource: Resource,
  id: string,
  p: Record<string, unknown>,
): Entity {
  const row = store.get(resource, id),
    user = store.activeUser();
  assert(inScope(user, row), "지점 접근 권한이 없습니다.", 403, "SCOPE_DENIED");
  assert(
    catalog[resource]?.edit,
    "직접 수정할 수 없는 항목입니다.",
    405,
    "METHOD_NOT_ALLOWED",
  );
  assert(
    num(p, "version") === row.version,
    "다른 사용자가 변경했습니다. 최신 내용을 확인해 주세요.",
    409,
    "VERSION_CONFLICT",
  );
  const before = structuredClone(row);
  if (resource === "tasks" && !admin(user, row.branchId)) {
    assert(
      store.get("tasks", id).assigneeId === user.id,
      "본인 배정 업무만 처리할 수 있습니다.",
      403,
      "SCOPE_DENIED",
    );
    assert(
      Object.keys(p).every((k) => ["version", "status", "checks"].includes(k)),
      "담당 직원은 상태와 체크리스트만 변경할 수 있습니다.",
      403,
      "SCOPE_DENIED",
    );
  } else writable(store, resource, row.branchId);
  const allowed = new Set([
    ...(catalog[resource]?.fields.map((f) => f.key) ?? []),
    "version",
  ]);
  assert(
    Object.keys(p).every((k) => allowed.has(k)),
    "허용되지 않은 변경 필드입니다.",
    422,
    "VALIDATION_ERROR",
  );
  assert(
    p.branchId === undefined || p.branchId === row.branchId,
    "소속 지점은 직접 변경할 수 없습니다.",
    422,
    "VALIDATION_ERROR",
  );
  if (resource === "employees")
    assert(
      !store.get("employees", id).owner || user.owner,
      "전체 관리자 계정은 변경할 수 없습니다.",
      403,
      "SCOPE_DENIED",
    );
  const merged = {
    ...row,
    ...p,
    version: row.version + 1,
    updatedAt: store.now(),
  };
  if (resource === "channels") {
    assert(
      store.get("channels", id).kind === "channel",
      "DM 참여자는 변경할 수 없습니다.",
    );
    const ids = z
      .array(z.string())
      .min(1)
      .parse(schemas.channels.parse(merged).participantIds);
    ids.forEach((person) => staffOk(store, person, row.branchId));
    Object.assign(merged, { participantIds: [...new Set([...ids, user.id])] });
  }
  if (resource === "tasks") {
    const t = schemas.tasks.parse(merged);
    staffOk(store, t.assigneeId, t.branchId);
    t.history.push({
      at: store.now(),
      actorId: user.id,
      text: `업무 변경 · ${t.status}`,
    });
    Object.assign(merged, t);
  }
  if (resource === "seats") {
    const seat = store.get("seats", id);
    assert(seat.status !== "이용 중", "이용 중 좌석은 퇴실 후 변경해 주세요.");
  }
  if (resource === "lockers")
    assert(
      !store.get("lockers", id).memberId,
      "사용 중 사물함은 배정 명령으로 처리해 주세요.",
    );
  if (resource === "rooms")
    assert(
      !store.db.reservations.some(
        (r) => r.roomId === id && ["예약 확정", "이용 중"].includes(r.status),
      ) || p.status !== "사용 불가",
      "예정 예약을 먼저 처리해 주세요.",
    );
  if (resource === "facilities") {
    const x = schemas.facilities.parse(merged);
    staffOk(store, x.assigneeId, x.branchId);
    Object.assign(merged, { nextCheck: dayPlus(x.lastChecked, x.cycleDays) });
  }
  if (resource === "shifts") {
    const x = schemas.shifts.parse(merged);
    staffOk(store, x.employeeId, x.branchId);
    interval(x.startsAt, x.endsAt);
    shiftConflict(store, x.employeeId, x.startsAt, x.endsAt, id);
  }
  const parsed = schemas[resource].parse(merged);
  Object.assign(row, parsed);
  audit(store, resource, id, "수정", before, row, row.branchId);
  return row;
}
function purchase(store: MockStore, p: Record<string, unknown>) {
  const b = str(p, "branchId");
  activeBranch(store, b);
  memberOk(store, str(p, "memberId"), b);
  const product = store.get("products", str(p, "productId"));
  assert(product.status === "판매 중", "판매 중지 상품입니다.");
  const payment = store.add("payments", b, {
    memberId: str(p, "memberId"),
    productId: product.id,
    reservationId: "",
    amount: product.price,
    method: z.enum(["Mock 카드", "Mock 현금"]).parse(p.method),
    status:
      p.simulateFailure || store.scenario === "payment-failure"
        ? "실패"
        : "승인",
    refundAt: "",
    refundBranchId: "",
    reason: "",
    approvedAt: store.now(),
  });
  if (payment.status === "승인")
    store.add("passes", b, {
      memberId: payment.memberId,
      productId: product.id,
      name: product.name,
      kind: product.kind,
      remaining: product.amount,
      hourlyRate: product.hourlyRate,
      expiresAt: new Date(
        Date.parse(store.now()) + product.days * 86400000,
      ).toISOString(),
      used: false,
      paymentId: payment.id,
      status: "활성",
    });
  audit(store, "payments", payment.id, "Mock 결제", null, payment, b);
  return payment;
}
function reserve(store: MockStore, p: Record<string, unknown>) {
  const b = str(p, "branchId");
  activeBranch(store, b);
  memberOk(store, str(p, "memberId"), b);
  const room = store.get("rooms", str(p, "roomId"));
  assert(
    room.branchId === b && room.status === "이용 가능",
    "이 지점에서 이용 가능한 룸을 선택해 주세요.",
  );
  const start = str(p, "startsAt"),
    end = str(p, "endsAt");
  interval(start, end);
  assert(
    [start, end].every(
      (t) =>
        new Date(t).getUTCMinutes() % 30 === 0 &&
        new Date(t).getUTCSeconds() === 0,
    ),
    "예약은 30분 단위입니다.",
    422,
    "VALIDATION_ERROR",
  );
  assert(
    num(p, "people") > 0 &&
      Number.isInteger(num(p, "people")) &&
      num(p, "people") <= room.capacity,
    "룸 정원을 확인해 주세요.",
    422,
    "VALIDATION_ERROR",
  );
  assert(
    !store.db.reservations.some(
      (r) =>
        r.roomId === room.id &&
        ["예약 확정", "이용 중"].includes(r.status) &&
        overlap(start, end, r.startsAt, r.endsAt),
    ),
    "이미 예약된 시간입니다.",
    409,
    "RESERVATION_CONFLICT",
  );
  const amount = Math.ceil(
      (room.hourlyRate * (Date.parse(end) - Date.parse(start))) / 3600000,
    ),
    fail = Boolean(p.simulateFailure) || store.scenario === "payment-failure";
  const r = store.add("reservations", b, {
    memberId: str(p, "memberId"),
    roomId: room.id,
    startsAt: start,
    endsAt: end,
    people: num(p, "people"),
    amount,
    hourlyRate: room.hourlyRate,
    paymentId: "",
    status: fail ? "결제 실패" : "예약 확정",
  });
  const payment = store.add("payments", b, {
    memberId: r.memberId,
    productId: "",
    reservationId: r.id,
    amount,
    method: "Mock 카드",
    status: fail ? "실패" : "승인",
    refundAt: "",
    refundBranchId: "",
    reason: "",
    approvedAt: store.now(),
  });
  r.paymentId = payment.id;
  audit(store, "reservations", r.id, "예약·Mock 결제", null, r, b);
  return r;
}

export function command(
  store: MockStore,
  resource: Resource,
  id: string,
  action: string,
  p: Record<string, unknown>,
): unknown {
  const row = store.get(resource, id),
    user = store.activeUser();
  assert(inScope(user, row), "지점 권한이 없습니다.", 403, "SCOPE_DENIED");
  assert(
    num(p, "version") === row.version,
    "최신 내용과 충돌했습니다. 다시 확인해 주세요.",
    409,
    "VERSION_CONFLICT",
  );
  const before = structuredClone(row),
    at = store.now();
  if (resource === "members" && action === "history")
    return customerHistory(store, id);
  if (resource === "tasks") {
    const t = store.get("tasks", id);
    assert(
      admin(user, t.branchId) || t.assigneeId === user.id,
      "본인 배정 업무만 처리할 수 있습니다.",
      403,
      "SCOPE_DENIED",
    );
    if (action === "share") {
      const channel = store.db.channels.find(
        (c) =>
          c.branchId === t.branchId &&
          c.kind === "channel" &&
          c.participantIds.includes(user.id),
      );
      assert(channel, "공유 가능한 운영 채널이 없습니다.");
      return sendMessage(store, {
        channelId: channel.id,
        text: `업무를 공유합니다: ${t.title}`,
        taskId: id,
        parentId: "",
        clientMessageId: str(p, "clientMessageId") || crypto.randomUUID(),
      });
    }
    const next = { progress: "진행 중", complete: "완료", reopen: "할 일" }[
      action
    ];
    assert(next, "지원하지 않는 작업입니다.", 422, "VALIDATION_ERROR");
    t.status = next as typeof t.status;
    t.history.push({ at, actorId: user.id, text: `상태 변경 · ${next}` });
  } else if (resource === "payments" && action === "refund") {
    const payment = store.get("payments", id);
    assert(
      admin(user, payment.branchId),
      "환불은 관리자 전용입니다.",
      403,
      "SCOPE_DENIED",
    );
    assert(payment.status === "승인", "환불 가능한 승인 거래가 아닙니다.");
    if (payment.reservationId) {
      const r = store.get("reservations", payment.reservationId);
      assert(r.status === "예약 확정", "미사용 예약만 환불할 수 있습니다.");
      r.status = "취소";
    } else {
      const pass = store.db.passes.find((x) => x.paymentId === id);
      assert(
        pass &&
          !pass.used &&
          pass.status !== "환불" &&
          !store.db.usage.some((u) => u.passId === pass.id),
        "실제 사용 이력이 있는 이용권은 환불할 수 없습니다.",
      );
      pass.status = "환불";
    }
    payment.status = "환불";
    payment.refundAt = at;
    payment.refundBranchId = str(p, "refundBranchId") || payment.branchId;
    assert(
      can(user, payment.refundBranchId),
      "환불 처리 지점 권한이 없습니다.",
      403,
      "SCOPE_DENIED",
    );
    payment.reason = z
      .string()
      .trim()
      .min(1, "환불 사유를 입력해 주세요.")
      .parse(p.reason);
  } else if (resource === "passes" && action === "adjust") {
    assert(
      admin(user, row.branchId),
      "이용권 조정은 관리자 전용입니다.",
      403,
      "SCOPE_DENIED",
    );
    const pass = store.get("passes", id);
    assert(pass.status !== "환불", "환불된 권은 조정할 수 없습니다.");
    assert(
      str(p, "reason").trim(),
      "조정 사유를 입력해 주세요.",
      422,
      "VALIDATION_ERROR",
    );
    pass.remaining = z.number().int().nonnegative().parse(p.remaining);
    assert(
      Number.isFinite(Date.parse(str(p, "expiresAt"))),
      "유효기간을 확인해 주세요.",
      422,
      "VALIDATION_ERROR",
    );
    pass.expiresAt = str(p, "expiresAt");
    pass.status =
      pass.remaining === 0 && pass.kind !== "기간권"
        ? "소진"
        : Date.parse(pass.expiresAt) <= Date.parse(at)
          ? "만료"
          : "활성";
  } else if (resource === "seats") {
    writable(store, resource, row.branchId);
    const seat = store.get("seats", id);
    if (action === "assign") {
      activeBranch(store, seat.branchId);
      assert(seat.status === "이용 가능", "배정할 수 없는 좌석입니다.");
      const member = memberOk(store, str(p, "memberId"), seat.branchId);
      const pass = store.get("passes", str(p, "passId"));
      assert(
        pass.memberId === member.id &&
          pass.status === "활성" &&
          Date.parse(pass.expiresAt) > Date.parse(at) &&
          (pass.kind === "기간권" || pass.remaining > 0),
        "유효한 보유 이용권을 선택해 주세요.",
      );
      assert(
        !store.db.usage.some(
          (u) => u.memberId === member.id && u.status === "이용 중",
        ),
        "이미 다른 좌석을 이용하고 있습니다.",
      );
      store.add("usage", seat.branchId, {
        memberId: member.id,
        passId: pass.id,
        seatId: seat.id,
        startedAt: at,
        endedAt: "",
        minutes: 0,
        charged: 0,
        excess: 0,
        status: "이용 중",
      });
      seat.status = "이용 중";
      seat.memberId = member.id;
      pass.used = true;
    } else {
      const usage = store.db.usage.find(
        (u) => u.seatId === id && u.status === "이용 중",
      );
      assert(usage, "이용 중인 좌석이 아닙니다.");
      if (action === "move") {
        const target = store.get("seats", str(p, "targetSeatId"));
        assert(
          target.branchId === seat.branchId && target.status === "이용 가능",
          "같은 지점의 빈 좌석을 선택해 주세요.",
        );
        target.status = "이용 중";
        target.memberId = seat.memberId;
        usage.seatId = target.id;
      } else if (action === "checkout") {
        const pass = store.get("passes", usage.passId),
          end = str(p, "endedAt") || at;
        assert(
          Date.parse(end) >= Date.parse(usage.startedAt) &&
            Date.parse(end) <= Date.parse(at),
          "퇴실 시각을 확인해 주세요.",
          422,
          "VALIDATION_ERROR",
        );
        const result = charge(usage.startedAt, end, pass.kind, pass.hourlyRate);
        usage.minutes = result.minutes;
        usage.charged = Math.min(pass.remaining, result.charged);
        usage.excess = Math.max(0, result.charged - pass.remaining);
        usage.endedAt = end;
        usage.status = "완료";
        if (pass.kind !== "기간권") {
          pass.remaining = Math.max(0, pass.remaining - result.charged);
          if (pass.remaining === 0) pass.status = "소진";
        }
      } else
        throw new DomainError(
          422,
          "VALIDATION_ERROR",
          "지원하지 않는 좌석 작업입니다.",
        );
      seat.status = "이용 가능";
      seat.memberId = "";
    }
  } else if (resource === "lockers") {
    writable(store, resource, row.branchId);
    const l = store.get("lockers", id);
    if (action === "assign") {
      activeBranch(store, l.branchId);
      assert(l.status === "이용 가능", "배정할 수 없는 사물함입니다.");
      memberOk(store, str(p, "memberId"), l.branchId);
      assert(
        str(p, "startsOn") <= str(p, "endsOn"),
        "기간을 확인해 주세요.",
        422,
        "VALIDATION_ERROR",
      );
      l.memberId = str(p, "memberId");
      l.startsOn = str(p, "startsOn");
      l.endsOn = str(p, "endsOn");
      l.status = "사용 중";
    } else if (action === "extend") {
      assert(
        l.status === "사용 중" && str(p, "endsOn") > l.endsOn,
        "현재 종료일보다 늦은 날짜를 선택해 주세요.",
      );
      l.endsOn = str(p, "endsOn");
    } else if (action === "return") {
      assert(l.status === "사용 중", "사용 중인 사물함이 아닙니다.");
      l.status = "이용 가능";
      l.memberId = "";
    } else
      throw new DomainError(
        422,
        "VALIDATION_ERROR",
        "지원하지 않는 작업입니다.",
      );
    l.history.push(`${at} · ${user.name} · ${action} · ${JSON.stringify(p)}`);
  } else if (resource === "reservations") {
    writable(store, resource, row.branchId);
    const r = store.get("reservations", id);
    if (action === "cancel") {
      assert(
        r.status === "예약 확정",
        "미사용 확정 예약만 취소할 수 있습니다.",
      );
      const pay = store.get("payments", r.paymentId);
      assert(pay.status === "승인", "결제 상태를 확인해 주세요.");
      r.status = "취소";
      pay.status = "환불";
      pay.refundAt = at;
      pay.refundBranchId = r.branchId;
      pay.reason = str(p, "reason") || "미사용 예약 취소";
    } else if (action === "start") {
      assert(r.status === "예약 확정", "확정 예약만 시작할 수 있습니다.");
      assert(
        store.get("rooms", r.roomId).status === "이용 가능",
        "이용 불가 룸입니다.",
      );
      assert(
        !store.db.reservations.some(
          (x) => x.id !== id && x.roomId === r.roomId && x.status === "이용 중",
        ),
        "룸을 사용 중인 다른 예약이 있습니다.",
      );
      memberOk(store, r.memberId, r.branchId);
      r.status = "이용 중";
    } else if (action === "finish") {
      assert(r.status === "이용 중", "이용 중인 예약만 완료할 수 있습니다.");
      r.status = "완료";
    } else
      throw new DomainError(
        422,
        "VALIDATION_ERROR",
        "예약 변경은 취소·환불 후 새 예약으로 등록해 주세요.",
      );
  } else if (resource === "facilities" && action === "inspect") {
    writable(store, resource, row.branchId);
    const x = store.get("facilities", id);
    x.result = z
      .string()
      .trim()
      .min(1, "점검 결과를 입력해 주세요.")
      .parse(p.result);
    x.condition = z
      .enum(["정상", "점검 필요", "고장", "사용 중지"])
      .parse(p.condition);
    x.lastChecked = businessDate(at);
    x.nextCheck = dayPlus(x.lastChecked, x.cycleDays);
    x.status = "완료";
  } else if (resource === "attendance") {
    const a = store.get("attendance", id);
    assert(
      a.employeeId === user.id,
      "본인의 근태만 기록할 수 있습니다.",
      403,
      "SCOPE_DENIED",
    );
    if (action === "break") {
      assert(a.status === "근무 중", "근무 중에만 휴게를 시작할 수 있습니다.");
      a.breaks.push({ start: at, end: "" });
      a.status = "휴게 중";
    } else if (action === "resume") {
      assert(a.status === "휴게 중", "진행 중 휴게가 없습니다.");
      a.breaks.at(-1)!.end = at;
      a.status = "근무 중";
    } else if (action === "clockout") {
      assert(a.status === "근무 중", "휴게를 종료한 뒤 퇴근해 주세요.");
      a.endedAt = at;
      a.status = "퇴근";
      a.workedMinutes = worked(
        a.startedAt,
        at,
        a.breaks.reduce(
          (s, b) => s + (Date.parse(b.end) - Date.parse(b.start)) / 60000,
          0,
        ),
      );
    } else
      throw new DomainError(
        422,
        "VALIDATION_ERROR",
        "지원하지 않는 근태 작업입니다.",
      );
  } else if (
    ["corrections", "leaveRequests", "substitutions"].includes(resource)
  ) {
    const status = text(row, "status"),
      isAdmin = admin(user, row.branchId);
    assert(
      ["approve", "reject", "cancel"].includes(action),
      "지원하지 않는 승인 작업입니다.",
      422,
      "VALIDATION_ERROR",
    );
    if (action === "cancel")
      assert(
        (text(row, "employeeId") === user.id && status === "신청") || isAdmin,
        "본인의 신청 또는 관리자만 취소할 수 있습니다.",
        403,
        "SCOPE_DENIED",
      );
    else assert(isAdmin, "승인·반려는 관리자 전용입니다.", 403, "SCOPE_DENIED");
    assert(
      action === "cancel"
        ? ["신청", "승인"].includes(status)
        : status === "신청",
      "이미 처리된 요청입니다.",
    );
    if (resource === "corrections") {
      const c = store.get("corrections", id);
      assert(
        !(action === "cancel" && status === "승인"),
        "승인된 정정은 새 정정 요청으로 처리해 주세요.",
      );
      if (action === "approve") {
        const a = store.get("attendance", c.attendanceId);
        interval(c.startedAt, c.endedAt);
        assert(
          c.breakMinutes <=
            (Date.parse(c.endedAt) - Date.parse(c.startedAt)) / 60000,
          "휴게가 근무 시간을 초과합니다.",
        );
        a.startedAt = c.startedAt;
        a.endedAt = c.endedAt;
        a.breaks = c.breakMinutes
          ? [
              {
                start: c.startedAt,
                end: new Date(
                  Date.parse(c.startedAt) + c.breakMinutes * 60000,
                ).toISOString(),
              },
            ]
          : [];
        a.workedMinutes = worked(c.startedAt, c.endedAt, c.breakMinutes);
        a.status = "퇴근";
      }
      c.status =
        action === "approve" ? "승인" : action === "reject" ? "반려" : "취소";
      c.decidedBy = user.id;
    } else if (resource === "leaveRequests") {
      const l = store.get("leaveRequests", id);
      if (action === "approve") {
        assert(
          leaveBalance(store, l.employeeId, l.startsOn) >= l.amount,
          "잔여 휴가가 부족합니다.",
        );
        assert(
          !store.db.leaveRequests.some(
            (x) =>
              x.id !== id &&
              x.employeeId === l.employeeId &&
              x.status === "승인" &&
              x.startsOn <= l.endsOn &&
              l.startsOn <= x.endsOn,
          ),
          "승인된 휴가와 겹칩니다.",
        );
      }
      l.status =
        action === "approve" ? "승인" : action === "reject" ? "반려" : "취소";
      l.decidedBy = user.id;
    } else {
      const s = store.get("substitutions", id),
        shift = store.get("shifts", s.shiftId);
      if (action === "approve") {
        const original = JSON.parse(s.original) as Database["shifts"][number];
        assert(
          shift.version === original.version &&
            shift.employeeId === s.employeeId,
          "원근무가 변경되었습니다. 다시 신청해 주세요.",
        );
        staffOk(store, s.substituteId, s.branchId);
        shiftConflict(store, s.substituteId, s.startsAt, s.endsAt, shift.id);
        shift.employeeId = s.substituteId;
        shift.startsAt = s.startsAt;
        shift.endsAt = s.endsAt;
        shift.status = "변경";
        shift.version++;
      }
      if (action === "cancel" && status === "승인") {
        const original = JSON.parse(s.original) as Database["shifts"][number];
        assert(
          shift.employeeId === s.substituteId &&
            shift.startsAt === s.startsAt &&
            shift.endsAt === s.endsAt,
          "변경 후 근무가 다시 수정되어 취소할 수 없습니다.",
        );
        shiftConflict(
          store,
          original.employeeId,
          original.startsAt,
          original.endsAt,
          shift.id,
        );
        Object.assign(shift, original, { version: shift.version + 1 });
      }
      s.status =
        action === "approve" ? "승인" : action === "reject" ? "반려" : "취소";
      s.decidedBy = user.id;
    }
  } else if (resource === "invitations") {
    assert(
      admin(user, row.branchId),
      "초대 관리는 관리자 전용입니다.",
      403,
      "SCOPE_DENIED",
    );
    const i = store.get("invitations", id);
    if (action === "reissue") {
      assert(i.status === "초대 대기", "수락 전 초대만 재발급할 수 있습니다.");
      i.token = crypto.randomUUID();
      i.expiresAt = new Date(Date.parse(at) + 86400000).toISOString();
      i.delivery =
        store.scenario === "email-failure" ? "발송 실패" : "발송 시뮬레이션";
    } else if (action === "approve") {
      assert(
        i.status === "승인 대기",
        "수락 후 승인 대기 중인 초대만 승인할 수 있습니다.",
      );
      const e = store.get("employees", i.employeeId);
      assert(
        !e.memberships.some((m) => m.branchId === i.branchId),
        "이미 소속된 직원입니다.",
      );
      e.memberships.push({
        branchId: i.branchId,
        role: i.role,
        permissions: [],
      });
      e.status = "활성";
      i.status = "활성";
    } else if (action === "cancel" || action === "reject") {
      assert(
        ["초대 대기", "승인 대기"].includes(i.status),
        "이미 처리된 초대입니다.",
      );
      i.status = action === "cancel" ? "취소" : "거절";
      i.token = crypto.randomUUID();
    } else
      throw new DomainError(
        422,
        "VALIDATION_ERROR",
        "지원하지 않는 작업입니다.",
      );
  } else if (resource === "employees" && action === "permissions") {
    const e = store.get("employees", id);
    assert(
      !e.owner || user.owner,
      "전체 관리자 계정은 변경할 수 없습니다.",
      403,
      "SCOPE_DENIED",
    );
    const memberships = z
      .array(schemas.employees.shape.memberships.element)
      .parse(p.memberships);
    assert(
      new Set(memberships.map((m) => m.branchId)).size === memberships.length,
      "소속 지점을 중복 설정할 수 없습니다.",
      422,
      "VALIDATION_ERROR",
    );
    const branches = new Set(
      [...e.memberships, ...memberships].map((m) => m.branchId),
    );
    for (const b of branches) {
      if (
        JSON.stringify(e.memberships.find((m) => m.branchId === b)) ===
        JSON.stringify(memberships.find((m) => m.branchId === b))
      )
        continue;
      assert(
        admin(user, b),
        "담당하지 않는 지점의 권한은 변경할 수 없습니다.",
        403,
        "SCOPE_DENIED",
      );
      store.get("branches", b);
    }
    e.memberships = memberships;
  } else
    throw new DomainError(422, "VALIDATION_ERROR", "지원하지 않는 작업입니다.");
  row.version++;
  row.updatedAt = at;
  audit(store, resource, id, action, before, row, row.branchId);
  return row;
}
const worked = (start: string, end: string, breakMinutes: number) =>
  Math.max(
    0,
    Math.floor((Date.parse(end) - Date.parse(start)) / 60000 - breakMinutes),
  );
export function clockin(store: MockStore, branchId: string) {
  const user = store.activeUser();
  assert(
    can(user, branchId),
    "소속 지점을 선택해 주세요.",
    403,
    "SCOPE_DENIED",
  );
  activeBranch(store, branchId);
  assert(
    !store.db.attendance.some(
      (a) => a.employeeId === user.id && a.status !== "퇴근",
    ),
    "이미 출근한 근무가 있습니다.",
  );
  return store.add("attendance", branchId, {
    employeeId: user.id,
    startedAt: store.now(),
    endedAt: "",
    breaks: [],
    workedMinutes: 0,
    status: "근무 중",
  });
}
export function sendMessage(store: MockStore, p: Record<string, unknown>) {
  const user = store.activeUser(),
    channel = store.get("channels", str(p, "channelId"));
  assert(
    channel.participantIds.includes(user.id),
    "참여하지 않은 대화입니다.",
    403,
    "SCOPE_DENIED",
  );
  const clientMessageId = z.string().min(1).parse(p.clientMessageId),
    prior = store.db.messages.find(
      (m) => m.authorId === user.id && m.clientMessageId === clientMessageId,
    );
  if (prior) {
    assert(
      prior.channelId === channel.id &&
        prior.text === str(p, "text") &&
        prior.parentId === str(p, "parentId"),
      "전송 식별자가 다른 메시지에 사용되었습니다.",
    );
    return prior;
  }
  const parentId = str(p, "parentId");
  if (parentId) {
    const parent = store.get("messages", parentId);
    assert(
      parent.channelId === channel.id && !parent.parentId,
      "올바른 스레드를 선택해 주세요.",
    );
  }
  const taskId = str(p, "taskId");
  if (taskId)
    assert(
      inScope(user, store.get("tasks", taskId)),
      "이 업무를 공유할 권한이 없습니다.",
      403,
      "SCOPE_DENIED",
    );
  const text = z.string().trim().max(4000).parse(p.text);
  assert(text || taskId, "메시지를 입력해 주세요.", 422, "VALIDATION_ERROR");
  return store.add("messages", channel.branchId, {
    channelId: channel.id,
    authorId: user.id,
    text,
    parentId,
    taskId,
    clientMessageId,
    sequence: Math.max(0, ...store.db.messages.map((m) => m.sequence)) + 1,
  });
}
export function customerHistory(store: MockStore, id: string) {
  const user = store.activeUser(),
    member = store.get("members", id);
  assert(
    member.branchIds.some((b) => can(user, b)),
    "소속 지점에서 응대하는 고객만 조회할 수 있습니다.",
    403,
    "SCOPE_DENIED",
  );
  audit(
    store,
    "members",
    id,
    "전 지점 이용 이력 조회",
    null,
    { id },
    member.branchId,
  );
  return {
    usage: store.db.usage.filter((u) => u.memberId === id),
    reservations: store.db.reservations.filter((r) => r.memberId === id),
    passes: store.db.passes.filter((p) => p.memberId === id),
    payments: can(user, member.branchId, "payments:read")
      ? store.db.payments.filter(
          (p) => p.memberId === id && can(user, p.branchId, "payments:read"),
        )
      : [],
  };
}
export function sales(
  store: MockStore,
  scope: string,
  start: string,
  end: string,
  basis: string,
) {
  const user = store.activeUser();
  assert(
    can(user, scope, "sales:read"),
    "매출 조회 권한이 없습니다.",
    403,
    "SCOPE_DENIED",
  );
  return store.db.branches
    .filter(
      (b) =>
        can(user, b.id, "sales:read") && (scope === "all" || scope === b.id),
    )
    .map((branch) => {
      const rows = store.db.payments.filter(
          (p) => p.branchId === branch.id && p.status !== "실패",
        ),
        inRange = (at: string) =>
          at && businessDate(at) >= start && businessDate(at) < end;
      const approved = rows
        .filter((p) => inRange(p.approvedAt))
        .reduce((s, p) => s + p.amount, 0);
      const refunds = rows
        .filter(
          (p) =>
            p.status === "환불" &&
            inRange(basis === "original" ? p.approvedAt : p.refundAt),
        )
        .reduce((s, p) => s + p.amount, 0);
      return {
        branchId: branch.id,
        branch: branch.name,
        approved,
        refunds,
        net: approved - refunds,
      };
    });
}
