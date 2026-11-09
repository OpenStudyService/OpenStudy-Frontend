import type { RequestConflict } from "../features/attendance/request-api";
/** Contract-shaped demo only. Live never imports MSW or this ledger adapter. */
import { http, HttpResponse } from "msw/http";
import { z } from "zod";
import { admin, businessDate, can, overlap } from "../shared/domain/schema";
import type { Employee, ResourceMap } from "../shared/domain/schema";
import type { Shift, Conflict } from "../features/attendance/api";
import { weekDays } from "../features/attendance/api";
import { assert, DomainError, store } from "./store";
import { attendanceRecord } from "./attendance";
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
    attendance: store.db.attendance
      .filter((a) => a.canonical?.shiftId === s.id)
      .map(attendanceRecord)
      .map((a) => ({
        id: a.id,
        status: a.status,
        clockInAt: a.clockInAt,
        clockOutAt: a.clockOutAt,
        workedMinutes: a.workedMinutes,
      })),
    canEdit: admin(u, s.branchId) && s.status !== "취소",
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
            ...(e instanceof RequestClash ? e.detail : {}),
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
function validate(
  p: z.infer<typeof create>,
  u: Employee,
  omit?: string,
  rules = { requireManager: true, allowStopped: false },
) {
  assert(
    !rules.requireManager || admin(u, p.branchId),
    "근무 지점 관리자만 변경할 수 있습니다.",
    403,
    "FORBIDDEN",
  );
  assert(
    rules.allowStopped ||
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
type Correction = NonNullable<ResourceMap["corrections"]["canonical"]>;
type Swap = NonNullable<ResourceMap["substitutions"]["canonical"]>;
const reason = z.string().trim().min(1).max(500);
const version = z.number().int().nonnegative();
const correctionBody = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("출퇴근"),
    clockInAt: time,
    clockOutAt: time,
    reason,
  }),
  z.strictObject({
    kind: z.literal("휴게"),
    breakId: z.string().min(1),
    breakStartedAt: time,
    breakEndedAt: time,
    reason,
  }),
]);
const swapBody = z.strictObject({
  replacementEmployeeId: z.string().min(1),
  proposedStartsAt: time,
  proposedEndsAt: time,
  reason,
});

class RequestClash extends DomainError {
  constructor(
    code: string,
    message: string,
    public detail: Partial<RequestConflict>,
  ) {
    super(409, code, message);
  }
}

const pending = "신청";
const activeMember = (u: Employee, branchId: string) =>
  u.memberships.some(
    (m) => m.branchId === branchId && (!m.status || m.status === "활성"),
  );
const requestVisible = (u: Employee, branch: string, people: string[]) =>
  admin(u, branch) || (activeMember(u, branch) && people.includes(u.id));
const flags = (
  row: { status: string; branchId: string },
  u: Employee,
  owner: string,
) => {
  const manager = u.id !== owner && admin(u, row.branchId);
  return {
    canApprove: row.status === pending && manager,
    canReject: row.status === pending && manager,
    canCancel: row.status === pending && u.id === owner,
  };
};
const emptyTimes = {
  clockInAt: null,
  clockOutAt: null,
  breakStartedAt: null,
  breakEndedAt: null,
};
const correctionView = (row: Correction, u: Employee) => ({
  ...row,
  ...flags(row, u, row.employee.id),
});
function swapView(row: Swap, u: Employee) {
  const s = store.get("shifts", row.shiftId);
  const future =
    s.status !== "취소" && Date.parse(s.startsAt) > Date.parse(store.now());
  const permissions = flags(row, u, row.requester.id);
  return {
    ...row,
    ...(row.status === pending
      ? { originalStartsAt: s.startsAt, originalEndsAt: s.endsAt }
      : {}),
    shiftVersion: s.version,
    ...permissions,
    canApprove:
      permissions.canApprove && future && s.version === row.shiftVersion,
    canCancelApproval:
      row.status === "승인" &&
      future &&
      s.version === row.shiftVersion &&
      u.id !== row.requester.id &&
      admin(u, row.branchId),
  };
}
function list<T extends { createdAt: string; branchId: string }>(
  rows: T[],
  a: Args,
  order = (left: T, right: T) => right.createdAt.localeCompare(left.createdAt),
) {
  const p = new URL(a.request.url).searchParams;
  const page = Number(p.get("page") || 1);
  const pageSize = Number(p.get("pageSize") || 20);
  const selected = rows
    .filter((r) => scope(a) === "all" || scope(a) === r.branchId)
    .sort(order);
  return {
    items: selected.slice((page - 1) * pageSize, page * pageSize),
    meta: { page, pageSize, total: selected.length },
  };
}

function validateCorrection(
  target: ResourceMap["attendance"],
  after: Correction["after"],
  breakId: string | null,
  u: Employee,
) {
  const start = after.clockInAt ?? target.startedAt;
  const end = after.clockOutAt ?? target.endedAt;
  const times = [start, end, after.breakStartedAt, after.breakEndedAt].filter(
    (at) => at !== null,
  );
  const duration = Date.parse(end) - Date.parse(start);
  assert(
    duration > 0 &&
      duration <= 86400000 &&
      times.every(
        (at) =>
          Date.parse(at) % 1000 === 0 &&
          Date.parse(at) <= Date.parse(store.now()),
      ),
    "정정 시각을 확인해 주세요.",
    422,
    "CORRECTION_TIME_INVALID",
  );
  const breaks = target.breaks.map((item, index) =>
    String(index) === breakId
      ? { start: after.breakStartedAt!, end: after.breakEndedAt! }
      : item,
  );
  if (breakId !== null)
    assert(
      Date.parse(after.breakStartedAt!) < Date.parse(after.breakEndedAt!),
      "휴게 시각을 확인해 주세요.",
      422,
      "CORRECTION_TIME_INVALID",
    );
  const breakIds = breaks.flatMap((item, index) =>
    Date.parse(item.start) < Date.parse(start) ||
    Date.parse(item.end) > Date.parse(end) ||
    breaks.some(
      (other, j) =>
        index !== j && overlap(item.start, item.end, other.start, other.end),
    )
      ? [String(index)]
      : [],
  );
  if (breakIds.length)
    throw new RequestClash(
      "CORRECTION_BREAK_OUTSIDE",
      "정정 구간과 휴게가 충돌합니다.",
      { breakIds },
    );
  const attendanceConflicts = store.db.attendance
    .flatMap((item): NonNullable<RequestConflict["attendanceConflicts"]> => {
      const itemEnd = item.endedAt || store.now();
      if (
        item.id === target.id ||
        item.employeeId !== target.employeeId ||
        !overlap(start, end, item.startedAt, itemEnd)
      )
        return [];
      const visible = requestVisible(u, item.branchId, [item.employeeId]);
      return [
        {
          visible,
          label: visible ? "근태" : "다른 지점 근태",
          attendanceRecordId: visible ? item.id : null,
          overlapStartsAt: new Date(
            Math.max(Date.parse(start), Date.parse(item.startedAt)),
          ).toISOString(),
          overlapEndsAt: new Date(
            Math.min(Date.parse(end), Date.parse(itemEnd)),
          ).toISOString(),
        },
      ];
    })
    .sort((a, b) => a.overlapStartsAt.localeCompare(b.overlapStartsAt));
  const merged: typeof attendanceConflicts = [];
  for (const clash of attendanceConflicts) {
    const previous = merged.findLast((item) => !item.visible);
    if (
      !clash.visible &&
      previous &&
      previous.overlapEndsAt >= clash.overlapStartsAt
    ) {
      if (previous.overlapEndsAt < clash.overlapEndsAt)
        previous.overlapEndsAt = clash.overlapEndsAt;
    } else merged.push(clash);
  }
  if (merged.length)
    throw new RequestClash("CORRECTION_OVERLAP", "다른 근태와 겹칩니다.", {
      attendanceConflicts: merged,
    });
}

function requestKey(a: Args) {
  const key = a.request.headers.get("Idempotency-Key");
  assert(key, "요청 키가 필요합니다.", 422, "VALIDATION_FAILED");
  return key;
}

function decisionCheck(
  u: Employee,
  row: { id: string; branchId: string; status: string; version: number },
  owner: string,
  action: string,
  sentVersion: number,
  path: string,
) {
  if (action === "cancel")
    assert(u.id === owner, "본인 신청만 취소할 수 있습니다.", 403, "FORBIDDEN");
  else {
    assert(
      admin(u, row.branchId),
      "신청 지점 관리자만 처리할 수 있습니다.",
      403,
      "FORBIDDEN",
    );
    assert(
      u.id !== owner,
      "본인 신청을 처리할 수 없습니다.",
      403,
      "SELF_DECISION_FORBIDDEN",
    );
  }
  const detail = {
    latestVersion: row.version,
    reloadUrl: `/api/${path}/${row.id}`,
  };
  if (row.status !== (action === "cancel-approval" ? "승인" : pending))
    throw new RequestClash("INVALID_STATE", "이미 처리된 신청입니다.", detail);
  if (row.version !== sentVersion)
    throw new RequestClash(
      "VERSION_CONFLICT",
      "최신 버전을 확인해 주세요.",
      detail,
    );
}

const correctionRows = (u: Employee) =>
  store.db.corrections.flatMap(({ canonical }) =>
    canonical && requestVisible(u, canonical.branchId, [canonical.employee.id])
      ? [canonical]
      : [],
  );
const swapRows = (u: Employee) =>
  store.db.substitutions.flatMap(({ canonical }) =>
    canonical &&
    requestVisible(u, canonical.branchId, [
      canonical.requester.id,
      canonical.replacement.id,
    ])
      ? [canonical]
      : [],
  );

const correctionHandlers = [
  http.get(
    "/api/attendance-corrections",
    route((a, u) =>
      list(
        correctionRows(u).map((row) => correctionView(row, u)),
        a,
      ),
    ),
  ),
  http.get(
    "/api/attendance-corrections/:id",
    route((a, u) => {
      const row = correctionRows(u).find((item) => item.id === a.params.id);
      assert(row, "정정을 찾을 수 없습니다.", 404, "NOT_FOUND");
      return correctionView(row, u);
    }),
  ),
  http.post(
    "/api/attendance-records/:id/corrections",
    route(async (a, u) => {
      const p = correctionBody.parse(await a.request.json());
      return store.transaction(
        requestKey(a),
        { operation: "correction", id: a.params.id, p },
        () => {
          const target = store.get("attendance", String(a.params.id));
          assert(
            requestVisible(u, target.branchId, [target.employeeId]),
            "근태를 찾을 수 없습니다.",
            404,
            "NOT_FOUND",
          );
          assert(
            target.employeeId === u.id,
            "본인만 정정할 수 있습니다.",
            403,
            "FORBIDDEN",
          );
          assert(
            target.endedAt,
            "퇴근한 기록만 정정할 수 있습니다.",
            409,
            "CORRECTION_TARGET_OPEN",
          );
          const prior = store.db.corrections.find(
            (item) =>
              item.attendanceId === target.id && item.status === pending,
          );
          if (prior)
            throw new RequestClash(
              "CORRECTION_PENDING",
              "처리 대기 중인 정정이 있습니다.",
              { pendingCorrectionId: prior.id },
            );
          const item =
            p.kind === "휴게" ? target.breaks[Number(p.breakId)] : undefined;
          if (p.kind === "휴게")
            assert(item?.end, "휴게를 찾을 수 없습니다.", 404, "NOT_FOUND");
          const before = item
            ? {
                ...emptyTimes,
                breakStartedAt: item.start,
                breakEndedAt: item.end,
              }
            : {
                ...emptyTimes,
                clockInAt: target.startedAt,
                clockOutAt: target.endedAt,
              };
          const after =
            p.kind === "휴게"
              ? {
                  ...emptyTimes,
                  breakStartedAt: p.breakStartedAt,
                  breakEndedAt: p.breakEndedAt,
                }
              : {
                  ...emptyTimes,
                  clockInAt: p.clockInAt,
                  clockOutAt: p.clockOutAt,
                };
          assert(
            JSON.stringify(before) !== JSON.stringify(after),
            "변경된 시각이 없습니다.",
            422,
            "CORRECTION_UNCHANGED",
          );
          const breakId = p.kind === "휴게" ? p.breakId : null;
          validateCorrection(target, after, breakId, u);
          const record = store.add("corrections", target.branchId, {
            employeeId: u.id,
            attendanceId: target.id,
            startedAt: after.clockInAt ?? after.breakStartedAt!,
            endedAt: after.clockOutAt ?? after.breakEndedAt!,
            breakMinutes: 0,
            reason: p.reason,
            status: pending,
            decidedBy: "",
            original: "",
          });
          record.canonical = {
            id: record.id,
            version: record.version,
            status: pending,
            kind: p.kind,
            attendanceRecordId: target.id,
            branchId: target.branchId,
            employee: actor(u.id),
            breakId,
            before,
            after,
            reason: p.reason,
            createdAt: record.createdAt,
            decision: null,
            cancellation: null,
            ...flags(record, u, u.id),
          };
          return correctionView(record.canonical, u);
        },
      );
    }, 201),
  ),
  ...(["approve", "reject", "cancel"] as const).map((action) =>
    http.post(
      `/api/attendance-corrections/:id/${action}`,
      route(async (a, u) => {
        const body =
          action === "reject"
            ? z.strictObject({ version, reason }).parse(await a.request.json())
            : z.strictObject({ version }).parse(await a.request.json());
        const row = correctionRows(u).find((item) => item.id === a.params.id);
        assert(row, "정정을 찾을 수 없습니다.", 404, "NOT_FOUND");
        decisionCheck(
          u,
          row,
          row.employee.id,
          action,
          body.version,
          "attendance-corrections",
        );
        if (action === "approve") {
          const target = store.get("attendance", row.attendanceRecordId);
          validateCorrection(target, row.after, row.breakId, u);
          if (row.breakId !== null) {
            const item = target.breaks[Number(row.breakId)];
            item.start = row.after.breakStartedAt!;
            item.end = row.after.breakEndedAt!;
          } else {
            target.startedAt = row.after.clockInAt!;
            target.endedAt = row.after.clockOutAt!;
          }
          target.version++;
          target.workedMinutes = attendanceRecord(target).workedMinutes ?? 0;
        }
        row.status =
          action === "approve" ? "승인" : action === "reject" ? "반려" : "취소";
        row.version++;
        const audit = { by: actor(u.id), at: store.now() };
        if (action === "cancel")
          row.cancellation = { ...audit, kind: "신청 취소" };
        else
          row.decision = {
            ...audit,
            reason: "reason" in body ? (body.reason as string) : null,
          };
        const record = store.get("corrections", row.id);
        record.status = row.status;
        record.version = row.version;
        store.persist();
        return correctionView(row, u);
      }),
    ),
  ),
];

function validateSwap(
  s: ResourceMap["shifts"],
  employeeId: string,
  startsAt: string,
  endsAt: string,
  u: Employee,
  restoring = false,
) {
  assert(s.status !== "취소", "취소된 근무입니다.", 409, "INVALID_STATE");
  assert(
    Date.parse(s.startsAt) > Date.parse(store.now()),
    "이미 시작된 근무입니다.",
    409,
    "SHIFT_ALREADY_STARTED",
  );
  validate(
    {
      branchId: s.branchId,
      employeeId,
      startsAt,
      endsAt,
      plannedBreakMinutes: s.breakMinutes,
    },
    u,
    s.id,
    { requireManager: false, allowStopped: restoring },
  );
}
const swapHandlers = [
  http.get(
    "/api/shift-swaps",
    route((a, u) =>
      list(
        swapRows(u).map((row) => swapView(row, u)),
        a,
      ),
    ),
  ),
  http.get(
    "/api/shift-swaps/:id",
    route((a, u) => {
      const row = swapRows(u).find((item) => item.id === a.params.id);
      assert(row, "대체근무를 찾을 수 없습니다.", 404, "NOT_FOUND");
      return swapView(row, u);
    }),
  ),
  http.post(
    "/api/shifts/:id/swaps",
    route(async (a, u) => {
      const p = swapBody.parse(await a.request.json());
      return store.transaction(
        requestKey(a),
        { operation: "swap", id: a.params.id, p },
        () => {
          const s = store.get("shifts", String(a.params.id));
          assert(visible(s, u), "근무를 찾을 수 없습니다.", 404, "NOT_FOUND");
          assert(
            s.employeeId === u.id,
            "본인만 신청할 수 있습니다.",
            403,
            "FORBIDDEN",
          );
          assert(
            u.id !== p.replacementEmployeeId,
            "다른 직원을 선택해 주세요.",
            422,
            "INVALID_SHIFT_EMPLOYEE",
          );
          const prior = store.db.substitutions.find(
            (item) => item.shiftId === s.id && item.status === pending,
          );
          if (prior)
            throw new RequestClash(
              "SWAP_PENDING",
              "처리 대기 중인 대체근무가 있습니다.",
              { pendingSwapId: prior.id },
            );
          validateSwap(
            s,
            p.replacementEmployeeId,
            p.proposedStartsAt,
            p.proposedEndsAt,
            u,
          );
          const record = store.add("substitutions", s.branchId, {
            employeeId: u.id,
            shiftId: s.id,
            substituteId: p.replacementEmployeeId,
            startsAt: p.proposedStartsAt,
            endsAt: p.proposedEndsAt,
            reason: p.reason,
            status: pending,
            decidedBy: "",
            original: "",
          });
          record.canonical = {
            id: record.id,
            version: record.version,
            status: pending,
            shiftId: s.id,
            branchId: s.branchId,
            requester: actor(u.id),
            replacement: actor(p.replacementEmployeeId),
            originalStartsAt: s.startsAt,
            originalEndsAt: s.endsAt,
            proposedStartsAt: p.proposedStartsAt,
            proposedEndsAt: p.proposedEndsAt,
            shiftVersion: s.version,
            reason: p.reason,
            decision: null,
            cancellation: null,
            createdAt: record.createdAt,
            ...flags(record, u, u.id),
            canCancelApproval: false,
          };
          return swapView(record.canonical, u);
        },
      );
    }, 201),
  ),
  ...(["approve", "reject", "cancel", "cancel-approval"] as const).map(
    (action) =>
      http.post(
        `/api/shift-swaps/:id/${action}`,
        route(async (a, u) => {
          const body =
            action === "approve"
              ? z
                  .strictObject({ version, shiftVersion: version })
                  .parse(await a.request.json())
              : z.strictObject({ version }).parse(await a.request.json());
          const row = swapRows(u).find((item) => item.id === a.params.id);
          assert(row, "대체근무를 찾을 수 없습니다.", 404, "NOT_FOUND");
          decisionCheck(
            u,
            row,
            row.requester.id,
            action,
            body.version,
            "shift-swaps",
          );
          if (action === "approve" || action === "cancel-approval") {
            const restoring = action === "cancel-approval";
            const s = store.get("shifts", row.shiftId);
            if (
              row.shiftVersion !== s.version ||
              (restoring
                ? s.status === "취소"
                : !("shiftVersion" in body) ||
                  body.shiftVersion !== s.version ||
                  row.requester.id !== s.employeeId)
            ) {
              throw new RequestClash(
                restoring ? "SWAP_RESTORE_CONFLICT" : "SHIFT_VERSION_CONFLICT",
                "원래 근무가 변경됐습니다.",
                {
                  shiftId: s.id,
                  latestVersion: s.version,
                  reloadUrl: `/api/shifts/${s.id}`,
                  ...(restoring ? { approvedVersion: row.shiftVersion } : {}),
                },
              );
            }
            const employeeId = restoring
              ? row.requester.id
              : row.replacement.id;
            const startsAt = restoring
              ? row.originalStartsAt
              : row.proposedStartsAt;
            const endsAt = restoring ? row.originalEndsAt : row.proposedEndsAt;
            validateSwap(s, employeeId, startsAt, endsAt, u, restoring);
            Object.assign(s, {
              employeeId,
              startsAt,
              endsAt,
              version: s.version + 1,
              updatedAt: store.now(),
              canonical: undefined,
            });
            s.canonical = shift(s, u);
            row.shiftVersion = s.version;
          }
          row.status =
            action === "approve"
              ? "승인"
              : action === "reject"
                ? "반려"
                : "취소";
          row.version++;
          const audit = { by: actor(u.id), at: store.now() };
          if (row.status === "취소")
            row.cancellation = {
              ...audit,
              kind: action === "cancel" ? "신청 취소" : "승인 취소",
            };
          else row.decision = audit;
          const record = store.get("substitutions", row.id);
          record.status = row.status;
          record.version = row.version;
          store.persist();
          return swapView(row, u);
        }),
      ),
  ),
];

type LeaveRecord = ResourceMap["leaveRequests"];
type GrantRecord = ResourceMap["leaveGrants"];
type Leave = NonNullable<LeaveRecord["canonical"]>;
type GrantEvent = NonNullable<GrantRecord["events"]>[number];
const today = () => businessDate(store.now());
const date = z.iso.date();
const validDays = (days: number) => days >= 0.5 && Number.isInteger(days * 2);
const grantBody = z.strictObject({
  employeeId: z.string().min(1),
  originBranchId: z.string().min(1),
  grantYear: z.number().int(),
  validFrom: date,
  validThrough: date,
  grantedDays: z.number(),
  reason,
});
const leaveBody = z.strictObject({
  branchId: z.string().min(1),
  startsOn: date,
  endsOn: date,
  requestedDays: z.number(),
  reason,
});
const branchActive = (id: string) =>
  store.db.branches.some(
    (branch) => branch.id === id && branch.status === "운영 중",
  );
const seesLeave = (u: Employee, branchId: string, employeeId: string) =>
  u.id === employeeId || admin(u, branchId);
const grantEvents = (row: GrantRecord): GrantEvent[] =>
  row.events ?? [
    {
      type: "부여",
      deltaDays: row.amount,
      leaveRequestId: null,
      reason: row.reason,
      actor: actor(row.grantedBy ?? "owner"),
      createdAt: row.createdAt,
    },
  ];
const remaining = (row: GrantRecord) =>
  grantEvents(row).reduce((sum, event) => sum + event.deltaDays, 0);
const grantOrder = (a: GrantRecord, b: GrantRecord) =>
  a.endsOn.localeCompare(b.endsOn) || a.id.localeCompare(b.id);
function grantView(row: GrantRecord, u: Employee) {
  return {
    id: row.id,
    version: row.version,
    originBranchId: row.branchId,
    employee: actor(row.employeeId),
    grantYear: row.grantYear ?? Number(row.startsOn.slice(0, 4)),
    validFrom: row.startsOn,
    validThrough: row.endsOn,
    grantedDays: row.amount,
    remainingDays: remaining(row),
    expired: row.endsOn < today(),
    reason: row.reason,
    grantedBy: actor(row.grantedBy ?? "owner"),
    createdAt: row.createdAt,
    canAdjust: admin(u, row.branchId),
  };
}
function balanceView(id: string, u: Employee) {
  const grants = store.db.leaveGrants
    .filter((row) => row.employeeId === id)
    .sort(grantOrder)
    .map((row) => {
      const view = grantView(row, u);
      return {
        grantId: view.id,
        originBranchId: view.originBranchId,
        grantYear: view.grantYear,
        validFrom: view.validFrom,
        validThrough: view.validThrough,
        grantedDays: view.grantedDays,
        remainingDays: view.remainingDays,
        expired: view.expired,
      };
    });
  return {
    employee: actor(id),
    asOf: store.now(),
    grants,
    totalRemainingDays: grants
      .filter((grant) => !grant.expired)
      .reduce((sum, grant) => sum + grant.remainingDays, 0),
  };
}
function leaveView(row: Leave, u: Employee) {
  return {
    ...row,
    ...flags(row, u, row.employee.id),
    canCancelApproval:
      row.status === "승인" &&
      today() < row.startsOn &&
      u.id !== row.employee.id &&
      admin(u, row.branchId),
  };
}
function leaveRows(u: Employee) {
  return store.db.leaveRequests.flatMap(({ canonical }) =>
    canonical && seesLeave(u, canonical.branchId, canonical.employee.id)
      ? [canonical]
      : [],
  );
}
function leaveOverlap(
  employeeId: string,
  start: string,
  end: string,
  u: Employee,
  approving?: string,
) {
  const matches = store.db.leaveRequests.filter(
    (row) =>
      row.id !== approving &&
      row.employeeId === employeeId &&
      (row.status === "승인" || (!approving && row.status === pending)) &&
      start <= row.endsOn &&
      row.startsOn <= end,
  );
  if (!matches.length) return;
  const overlappingRequestIds = matches
    .filter((row) => seesLeave(u, row.branchId, row.employeeId))
    .map((row) => row.id);
  throw new RequestClash(
    "LEAVE_OVERLAP",
    "겹치는 휴가가 있습니다.",
    overlappingRequestIds.length ? { overlappingRequestIds } : {},
  );
}
function usableGrants(
  employeeId: string,
  start: string,
  end: string,
  requiredDays: number,
) {
  const grants = store.db.leaveGrants
    .filter(
      (row) =>
        row.employeeId === employeeId &&
        row.startsOn <= start &&
        end <= row.endsOn &&
        remaining(row) > 0,
    )
    .sort(grantOrder);
  const availableDays = grants.reduce(
    (sum, grant) => sum + remaining(grant),
    0,
  );
  if (availableDays < requiredDays)
    throw new RequestClash(
      "LEAVE_BALANCE_INSUFFICIENT",
      "사용 가능한 휴가가 부족합니다.",
      { requiredDays, availableDays },
    );
  return grants;
}
function leaveShiftConflicts(row: Leave, u: Employee) {
  const start = Date.parse(`${row.startsOn}T00:00:00+09:00`);
  const end = Date.parse(`${row.endsOn}T00:00:00+09:00`) + 86400000;
  const conflicts: Conflict[] = [];
  const shifts = store.db.shifts
    .filter(
      (item) =>
        item.employeeId === row.employee.id &&
        item.status !== "취소" &&
        Date.parse(item.startsAt) < end &&
        start < Date.parse(item.endsAt),
    )
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  for (const item of shifts) {
    const allowed = visible(item, u);
    const overlapStartsAt = new Date(
      Math.max(start, Date.parse(item.startsAt)),
    ).toISOString();
    const overlapEndsAt = new Date(
      Math.min(end, Date.parse(item.endsAt)),
    ).toISOString();
    const lastHidden = conflicts.findLast((conflict) => !conflict.visible);
    if (!allowed && lastHidden && lastHidden.overlapEndsAt >= overlapStartsAt) {
      if (lastHidden.overlapEndsAt < overlapEndsAt)
        lastHidden.overlapEndsAt = overlapEndsAt;
    } else
      conflicts.push({
        kind: "근무",
        visible: allowed,
        label: allowed ? "근무" : "다른 지점 근무",
        overlapStartsAt,
        overlapEndsAt,
        shift: allowed
          ? {
              id: item.id,
              branchId: item.branchId,
              startsAt: item.startsAt,
              endsAt: item.endsAt,
            }
          : null,
      });
  }
  if (conflicts.length)
    throw new RequestClash(
      "LEAVE_SHIFT_CONFLICT",
      "휴가 기간에 예정 근무가 있습니다.",
      { conflicts },
    );
}
function addGrantEvent(
  grant: GrantRecord,
  row: Leave,
  type: "사용" | "복원",
  deltaDays: number,
  u: Employee,
) {
  grant.events = [
    ...grantEvents(grant),
    {
      type,
      deltaDays,
      leaveRequestId: row.id,
      reason: null,
      actor: actor(u.id),
      createdAt: store.now(),
    },
  ];
  grant.version++;
}
const leaveHandlers = [
  http.get(
    "/api/me/leave-balance",
    route((_a, u) => balanceView(u.id, u)),
  ),
  http.get(
    "/api/employees/:id/leave-balance",
    route((a, u) => {
      const employee = store.db.employees.find(
        (person) => person.id === a.params.id,
      );
      assert(
        employee &&
          (u.owner ||
            employee.memberships.some(
              (membership) =>
                activeMember(employee, membership.branchId) &&
                admin(u, membership.branchId),
            )),
        "직원을 찾을 수 없습니다.",
        404,
        "NOT_FOUND",
      );
      return balanceView(employee.id, u);
    }),
  ),
  http.get(
    "/api/leave-grants",
    route((a, u) => {
      const p = new URL(a.request.url).searchParams;
      const page = Number(p.get("page") || 1);
      const pageSize = Number(p.get("pageSize") || 20);
      const rows = store.db.leaveGrants
        .filter(
          (row) =>
            seesLeave(u, row.branchId, row.employeeId) &&
            (scope(a) === "all" || scope(a) === row.branchId) &&
            (p.get("includeExpired") === "true" || row.endsOn >= today()),
        )
        .sort(grantOrder);
      return {
        items: rows
          .slice((page - 1) * pageSize, page * pageSize)
          .map((row) => grantView(row, u)),
        meta: { page, pageSize, total: rows.length },
      };
    }),
  ),
  http.get(
    "/api/leave-grants/:id",
    route((a, u) => {
      const row = store.get("leaveGrants", String(a.params.id));
      assert(
        seesLeave(u, row.branchId, row.employeeId),
        "부여를 찾을 수 없습니다.",
        404,
        "NOT_FOUND",
      );
      return { ...grantView(row, u), events: grantEvents(row) };
    }),
  ),
  http.post(
    "/api/leave-grants",
    route(async (a, u) => {
      const p = grantBody.parse(await a.request.json());
      return store.transaction(
        requestKey(a),
        { operation: "leave-grant", p },
        () => {
          assert(
            admin(u, p.originBranchId),
            "부여 지점 관리자만 처리할 수 있습니다.",
            403,
            "FORBIDDEN",
          );
          assert(
            p.validFrom <= p.validThrough &&
              validDays(p.grantedDays) &&
              p.grantedDays <= 366 &&
              p.grantYear >= 2000 &&
              p.grantYear <= 2100,
            "부여 기간을 확인해 주세요.",
            422,
            "LEAVE_GRANT_INVALID",
          );
          assert(
            branchActive(p.originBranchId),
            "운영 중지 지점입니다.",
            409,
            "BRANCH_NOT_ACTIVE",
          );
          assert(
            store.db.employees.some(
              (person) =>
                person.id === p.employeeId &&
                person.status === "활성" &&
                activeMember(person, p.originBranchId),
            ),
            "활성 소속 직원을 선택해 주세요.",
            422,
            "INVALID_LEAVE_EMPLOYEE",
          );
          const row = store.add("leaveGrants", p.originBranchId, {
            employeeId: p.employeeId,
            amount: p.grantedDays,
            startsOn: p.validFrom,
            endsOn: p.validThrough,
            reason: p.reason,
            grantYear: p.grantYear,
            grantedBy: u.id,
          });
          return grantView(row, u);
        },
      );
    }, 201),
  ),
  http.get(
    "/api/leave-requests",
    route((a, u) =>
      list(
        leaveRows(u).map((row) => leaveView(row, u)),
        a,
        (left, right) =>
          right.startsOn.localeCompare(left.startsOn) ||
          right.id.localeCompare(left.id),
      ),
    ),
  ),
  http.get(
    "/api/leave-requests/:id",
    route((a, u) => {
      const row = leaveRows(u).find((item) => item.id === a.params.id);
      assert(row, "휴가 신청을 찾을 수 없습니다.", 404, "NOT_FOUND");
      return leaveView(row, u);
    }),
  ),
  http.post(
    "/api/leave-requests",
    route(async (a, u) => {
      const p = leaveBody.parse(await a.request.json());
      return store.transaction(
        requestKey(a),
        { operation: "leave-request", p },
        () => {
          assert(
            activeMember(u, p.branchId),
            "신청 지점의 활성 소속이 필요합니다.",
            403,
            "FORBIDDEN",
          );
          assert(
            p.startsOn.slice(0, 4) === p.endsOn.slice(0, 4) &&
              validDays(p.requestedDays) &&
              p.requestedDays <=
                (Date.parse(p.endsOn) - Date.parse(p.startsOn)) / 86400000 + 1,
            "휴가 기간과 일수를 확인해 주세요.",
            422,
            "LEAVE_PERIOD_INVALID",
          );
          assert(
            branchActive(p.branchId),
            "운영 중지 지점입니다.",
            409,
            "BRANCH_NOT_ACTIVE",
          );
          leaveOverlap(u.id, p.startsOn, p.endsOn, u);
          usableGrants(u.id, p.startsOn, p.endsOn, p.requestedDays);
          const record = store.add("leaveRequests", p.branchId, {
            employeeId: u.id,
            startsOn: p.startsOn,
            endsOn: p.endsOn,
            amount: p.requestedDays,
            reason: p.reason,
            status: pending,
            decidedBy: "",
          });
          record.canonical = {
            id: record.id,
            version: record.version,
            status: pending,
            branchId: p.branchId,
            employee: actor(u.id),
            startsOn: p.startsOn,
            endsOn: p.endsOn,
            requestedDays: p.requestedDays,
            reason: p.reason,
            createdAt: record.createdAt,
            decision: null,
            cancellation: null,
            allocations: [],
            ...flags(record, u, u.id),
            canCancelApproval: false,
          };
          return leaveView(record.canonical, u);
        },
      );
    }, 201),
  ),
  ...(["approve", "reject", "cancel", "cancel-approval"] as const).map(
    (action) =>
      http.post(
        `/api/leave-requests/:id/${action}`,
        route(async (a, u) => {
          const body = z
            .strictObject({ version })
            .parse(await a.request.json());
          const row = leaveRows(u).find((item) => item.id === a.params.id);
          assert(row, "휴가 신청을 찾을 수 없습니다.", 404, "NOT_FOUND");
          decisionCheck(
            u,
            row,
            row.employee.id,
            action,
            body.version,
            "leave-requests",
          );
          if (action === "approve") {
            leaveOverlap(row.employee.id, row.startsOn, row.endsOn, u, row.id);
            leaveShiftConflicts(row, u);
            const grants = usableGrants(
              row.employee.id,
              row.startsOn,
              row.endsOn,
              row.requestedDays,
            );
            let left = row.requestedDays;
            for (const grant of grants) {
              if (!left) break;
              const days = Math.min(left, remaining(grant));
              addGrantEvent(grant, row, "사용", -days, u);
              row.allocations.push({
                grantId: grant.id,
                days,
                restored: false,
              });
              left -= days;
            }
          }
          if (action === "cancel-approval") {
            assert(
              today() < row.startsOn,
              "시작일이 지난 휴가입니다.",
              409,
              "LEAVE_ALREADY_STARTED",
            );
            for (const allocation of row.allocations) {
              addGrantEvent(
                store.get("leaveGrants", allocation.grantId),
                row,
                "복원",
                allocation.days,
                u,
              );
              allocation.restored = true;
            }
          }
          row.status =
            action === "approve"
              ? "승인"
              : action === "reject"
                ? "반려"
                : "취소";
          row.version++;
          const audit = { by: actor(u.id), at: store.now() };
          if (row.status === "취소")
            row.cancellation = {
              ...audit,
              kind: action === "cancel" ? "신청 취소" : "승인 취소",
            };
          else row.decision = audit;
          const record = store.get("leaveRequests", row.id);
          record.status = row.status;
          record.version = row.version;
          store.persist();
          return leaveView(row, u);
        }),
      ),
  ),
];

export const workforceHandlers = [
  ...leaveHandlers,
  ...correctionHandlers,
  ...swapHandlers,
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
        .map(attendanceRecord);
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
export { visible as shiftVisible };
