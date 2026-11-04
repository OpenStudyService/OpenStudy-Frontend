/** Contract-shaped demo only. Live never imports MSW or this ledger adapter. */
import { http, HttpResponse } from "msw/http";
import { z } from "zod";
import { admin, businessDate, can, overlap } from "../shared/domain/schema";
import type { Employee, ResourceMap } from "../shared/domain/schema";
import type { Shift, Conflict } from "../features/attendance/api";
import { weekDays } from "../features/attendance/api";
import { assert, DomainError, store } from "./store";
type Args = {
  request: Request;
  params: Record<string, string | readonly string[] | undefined>;
};
const actor = (id: string) => ({
  id,
  name: store.db.employees.find((e) => e.id === id)?.name || id,
});
const scope = (a: Args) =>
  new URL(a.request.url).searchParams.get("scope") || "all";
function visible(s: ResourceMap["shifts"], u: Employee, selected = "all") {
  return (
    (selected === "all" || selected === s.branchId) &&
    can(u, s.branchId) &&
    (admin(u, s.branchId) || s.employeeId === u.id)
  );
}
function shift(s: ResourceMap["shifts"], u: Employee): Shift {
  return {
    ...(s.canonical ?? {
      id: s.id,
      branchId: s.branchId,
      employee: actor(s.employeeId),
      version: s.version,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      workDate: businessDate(s.startsAt),
      plannedBreakMinutes: s.breakMinutes,
      plannedWorkMinutes:
        (Date.parse(s.endsAt) - Date.parse(s.startsAt)) / 60000 -
        s.breakMinutes,
      status: s.status === "취소" ? "취소" : "예정",
      cancellation: null,
      createdBy: actor(u.id),
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      attendance: [],
      canEdit: false,
    }),
    canEdit: admin(u, s.branchId),
  };
}
class ShiftClash extends DomainError {
  constructor(public conflicts: Conflict[]) {
    super(409, "SHIFT_CONFLICT", "다른 근무 또는 승인 휴가와 겹칩니다.");
  }
}
const route =
  (fn: (a: Args, u: Employee) => unknown | Promise<unknown>, status = 200) =>
  async (a: Args) => {
    try {
      const u = store.activeUser();
      assert(can(u, scope(a)), "접근할 수 없는 지점입니다.", 403, "FORBIDDEN");
      assert(
        store.scenario !== "error",
        "서버를 확인해 주세요.",
        503,
        "SERVICE_UNAVAILABLE",
      );
      assert(
        store.scenario !== "forbidden",
        "접근할 수 없습니다.",
        403,
        "FORBIDDEN",
      );
      if (a.request.method !== "GET")
        assert(
          a.request.headers.get("X-CSRF-Token") === "openstudy-mock-csrf",
          "인증을 확인해 주세요.",
          403,
          "CSRF_INVALID",
        );
      return HttpResponse.json((await fn(a, u)) as Record<string, unknown>, {
        status,
      });
    } catch (e) {
      if (e instanceof z.ZodError)
        return HttpResponse.json(
          { code: "VALIDATION_FAILED", message: "입력을 확인해 주세요." },
          { status: 422 },
        );
      if (e instanceof DomainError)
        return HttpResponse.json(
          {
            code: e.code,
            message: e.message,
            latestVersion: e.latestVersion,
            ...(e instanceof ShiftClash ? { conflicts: e.conflicts } : {}),
          },
          { status: e.status },
        );
      throw e;
    }
  };
const time = z.string().datetime({ offset: true });
const fields = {
  startsAt: time,
  endsAt: time,
  plannedBreakMinutes: z.number().int().nonnegative(),
};
const create = z
  .object({
    branchId: z.string().min(1),
    employeeId: z.string().min(1),
    ...fields,
  })
  .strict();
const update = z
  .object({
    version: z.number().int().nonnegative(),
    ...fields,
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
function validate(p: z.infer<typeof create>, u: Employee, omit?: string) {
  assert(
    admin(u, p.branchId),
    "근무 지점 관리자만 변경할 수 있습니다.",
    403,
    "FORBIDDEN",
  );
  assert(
    store.db.branches.find((b) => b.id === p.branchId)?.status === "운영 중",
    "운영 중지 지점입니다.",
    409,
    "BRANCH_NOT_ACTIVE",
  );
  const employee = store.db.employees.find(
    (e) =>
      e.id === p.employeeId &&
      e.status === "활성" &&
      e.memberships.some(
        (m) => m.branchId === p.branchId && (!m.status || m.status === "활성"),
      ),
  );
  assert(
    employee,
    "활성 소속 직원을 선택해 주세요.",
    422,
    "INVALID_SHIFT_EMPLOYEE",
  );
  const duration = (Date.parse(p.endsAt) - Date.parse(p.startsAt)) / 60000;
  assert(
    duration > 0 &&
      duration <= 1440 &&
      Date.parse(p.startsAt) % 60000 === 0 &&
      Date.parse(p.endsAt) % 60000 === 0,
    "근무 시각을 확인해 주세요.",
    422,
    "SHIFT_TIME_INVALID",
  );
  assert(
    p.plannedBreakMinutes < duration,
    "휴게는 근무 길이보다 짧아야 합니다.",
    422,
    "SHIFT_BREAK_INVALID",
  );
  const conflicts: Conflict[] = store.db.shifts
    .filter(
      (s) =>
        s.id !== omit &&
        s.status !== "취소" &&
        s.employeeId === p.employeeId &&
        overlap(s.startsAt, s.endsAt, p.startsAt, p.endsAt),
    )
    .map((s) => ({
      kind: "근무",
      visible: visible(s, u),
      label: visible(s, u) ? "근무" : "다른 지점 근무",
      overlapStartsAt: new Date(
        Math.max(Date.parse(s.startsAt), Date.parse(p.startsAt)),
      ).toISOString(),
      overlapEndsAt: new Date(
        Math.min(Date.parse(s.endsAt), Date.parse(p.endsAt)),
      ).toISOString(),
      shift: visible(s, u)
        ? {
            id: s.id,
            branchId: s.branchId,
            startsAt: s.startsAt,
            endsAt: s.endsAt,
          }
        : null,
    }));
  for (const l of store.db.leaveRequests.filter(
    (l) => l.employeeId === p.employeeId && l.status === "승인",
  )) {
    const start = `${l.startsOn}T00:00:00+09:00`,
      end = new Date(
        Date.parse(`${l.endsOn}T00:00:00+09:00`) + 86400000,
      ).toISOString();
    if (overlap(start, end, p.startsAt, p.endsAt))
      conflicts.push({
        kind: "휴가",
        visible: false,
        label: "승인 휴가",
        overlapStartsAt: new Date(
          Math.max(Date.parse(start), Date.parse(p.startsAt)),
        ).toISOString(),
        overlapEndsAt: new Date(
          Math.min(Date.parse(end), Date.parse(p.endsAt)),
        ).toISOString(),
        shift: null,
      });
  }
  if (conflicts.length) throw new ShiftClash(conflicts);
}
export const workforceHandlers = [
  http.get(
    "/api/shifts/weekly",
    route((a, u) => {
      const days = weekDays(
        new URL(a.request.url).searchParams.get("weekOf") ||
          businessDate(store.now()),
      );
      const shifts = store.db.shifts
        .filter(
          (s) =>
            visible(s, u, scope(a)) &&
            s.status !== "취소" &&
            days.includes(businessDate(s.startsAt)),
        )
        .map((s) => shift(s, u));
      const attendance = store.db.attendance
        .filter(
          (s) =>
            can(u, s.branchId) &&
            (scope(a) === "all" || s.branchId === scope(a)) &&
            (admin(u, s.branchId) || s.employeeId === u.id) &&
            days.includes(businessDate(s.startedAt)),
        )
        .map((s) => ({
          id: s.id,
          version: s.version,
          status: s.status,
          branchId: s.branchId,
          employee: actor(s.employeeId),
          shiftId: null,
          clockInAt: s.startedAt,
          clockOutAt: s.endedAt || null,
          workDate: businessDate(s.startedAt),
          breaks: s.breaks.map((b, i) => ({
            id: String(i),
            startedAt: b.start,
            endedAt: b.end || null,
          })),
          workedMinutes: s.status === "퇴근" ? s.workedMinutes : null,
        }));
      return {
        weekStart: days[0],
        weekEnd: days[6],
        timeZone: "Asia/Seoul",
        shifts,
        attendance,
        asOf: store.now(),
      };
    }),
  ),
  http.get(
    "/api/shifts",
    route((a, u) => {
      const p = new URL(a.request.url).searchParams,
        page = Number(p.get("page") || 1),
        size = Number(p.get("pageSize") || 20);
      const rows = store.db.shifts
        .filter(
          (s) =>
            visible(s, u, scope(a)) &&
            shift(s, u).status === (p.get("status") || "예정") &&
            (!p.get("from") || businessDate(s.startsAt) >= p.get("from")!) &&
            (!p.get("to") || businessDate(s.startsAt) <= p.get("to")!),
        )
        .sort(
          (a, b) =>
            a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id),
        )
        .map((s) => shift(s, u));
      return {
        items: rows.slice((page - 1) * size, page * size),
        meta: { page, pageSize: size, total: rows.length },
      };
    }),
  ),
  http.get(
    "/api/shifts/:id",
    route((a, u) => {
      const s = store.get("shifts", String(a.params.id));
      assert(visible(s, u), "근무를 찾을 수 없습니다.", 404, "NOT_FOUND");
      return shift(s, u);
    }),
  ),
  http.post(
    "/api/shifts",
    route(async (a, u) => {
      const p = create.parse(await a.request.json()),
        key = a.request.headers.get("Idempotency-Key");
      assert(key, "요청 키가 필요합니다.", 422, "VALIDATION_FAILED");
      assert(
        scope(a) === "all" || scope(a) === p.branchId,
        "선택 지점과 다릅니다.",
        403,
        "FORBIDDEN",
      );
      return store.transaction(key, { operation: "shift-create", p }, () => {
        validate(p, u);
        const s = store.add("shifts", p.branchId, {
          employeeId: p.employeeId,
          startsAt: p.startsAt,
          endsAt: p.endsAt,
          breakMinutes: p.plannedBreakMinutes,
          status: "예정",
        });
        s.canonical = shift(s, u);
        store.emit("shifts", s.id, s.branchId);
        return s.canonical;
      });
    }, 201),
  ),
  http.patch(
    "/api/shifts/:id",
    route(async (a, u) => {
      const p = update.parse(await a.request.json()),
        s = store.get("shifts", String(a.params.id));
      assert(visible(s, u), "근무를 찾을 수 없습니다.", 404, "NOT_FOUND");
      assert(
        admin(u, s.branchId),
        "관리자만 수정할 수 있습니다.",
        403,
        "FORBIDDEN",
      );
      assert(
        p.version === s.version,
        "최신 버전을 확인해 주세요.",
        409,
        "VERSION_CONFLICT",
      );
      assert(s.status !== "취소", "취소된 근무입니다.", 409, "INVALID_STATE");
      validate(
        { ...p, branchId: s.branchId, employeeId: s.employeeId },
        u,
        s.id,
      );
      Object.assign(s, {
        startsAt: p.startsAt,
        endsAt: p.endsAt,
        breakMinutes: p.plannedBreakMinutes,
        version: s.version + 1,
        updatedAt: store.now(),
        canonical: undefined,
      });
      s.canonical = shift(s, u);
      store.persist();
      store.emit("shifts", s.id, s.branchId);
      return s.canonical;
    }),
  ),
  http.post(
    "/api/shifts/:id/cancel",
    route(async (a, u) => {
      const p = z
          .object({
            version: z.number().int().nonnegative(),
            reason: z.string().max(500).optional(),
          })
          .strict()
          .parse(await a.request.json()),
        s = store.get("shifts", String(a.params.id));
      assert(visible(s, u), "근무를 찾을 수 없습니다.", 404, "NOT_FOUND");
      assert(
        admin(u, s.branchId),
        "관리자만 취소할 수 있습니다.",
        403,
        "FORBIDDEN",
      );
      assert(
        p.version === s.version,
        "최신 버전을 확인해 주세요.",
        409,
        "VERSION_CONFLICT",
      );
      assert(
        s.status !== "취소",
        "이미 취소된 근무입니다.",
        409,
        "INVALID_STATE",
      );
      s.status = "취소";
      s.version++;
      s.updatedAt = store.now();
      s.canonical = undefined;
      s.canonical = {
        ...shift(s, u),
        cancellation: {
          cancelledAt: store.now(),
          cancelledBy: actor(u.id),
          reason: p.reason || null,
        },
      };
      store.persist();
      store.emit("shifts", s.id, s.branchId);
      return s.canonical;
    }),
  ),
];
