/** Canonical locker API over the shared demo locker, customer and payment ledgers. */
import { delay } from "msw";
import { http, HttpResponse } from "msw/http";
import { z } from "zod";
import type { components } from "../shared/api/foundation.generated";
import { can } from "../shared/domain/schema";
import type { Employee, ResourceMap } from "../shared/domain/schema";
import { assert, DomainError, store } from "./store";

type S = components["schemas"];
type LockerRow = ResourceMap["lockers"];
type Assignment = S["LockerAssignment"];
type Args = {
  request: Request;
  params: Record<string, string | readonly string[] | undefined>;
};
const id = z.string().min(1),
  version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  rate = version,
  lockerNo = z.string().trim().min(1).max(40),
  status = z.enum(["사용 가능", "운영 중단"]),
  reason = z.string().trim().min(1).max(500),
  date = z.iso.date(),
  method = z.enum(["현금", "카드", "계좌이체", "기타"]),
  mockOutcome = z.enum(["APPROVED", "FAILED"]).default("APPROVED");
const createInput = z
  .object({
    branchId: id,
    lockerNo,
    ratePer4WeeksKrw: rate,
    status: status.default("사용 가능"),
  })
  .strict();
const updateInput = z
  .object({
    version,
    lockerNo: lockerNo.optional(),
    ratePer4WeeksKrw: rate.optional(),
  })
  .strict()
  .refine((v) => v.lockerNo !== undefined || v.ratePer4WeeksKrw !== undefined);
const assignInput = z
  .object({
    branchId: id,
    lockerId: id,
    customerId: id,
    startDate: date,
    endDate: date,
    method,
    mockOutcome,
  })
  .strict();
const extendInput = z
  .object({ version, endDate: date, method, mockOutcome })
  .strict();
const today = () =>
  new Date(Date.parse(store.now()) + 9 * 3600000).toISOString().slice(0, 10);
const actor = (u: Employee) => ({ id: u.id, name: u.name });
function customer(id: string) {
  const c = store.get("members", id);
  return { id, name: c.name, memberNo: c.memberNo ?? `DEMO-${id}` };
}
const readable = (u: Employee, branch: string) =>
  store.db.branches.some((b) => b.id === branch) && can(u, branch);
function selected(a: Args, u: Employee) {
  const scope = new URL(a.request.url).searchParams.get("scope") || "all";
  assert(
    scope === "all" || readable(u, scope),
    "지점에 접근할 수 없습니다.",
    403,
    "FORBIDDEN",
  );
  return store.db.branches
    .filter((b) => (scope === "all" || scope === b.id) && readable(u, b.id))
    .map((b) => b.id);
}
function requireWrite(u: Employee, branch: string, billing = false) {
  assert(
    readable(u, branch) &&
      can(u, branch, billing ? "payments:write" : "operations:write"),
    "사물함 운영 권한이 없습니다.",
    403,
    "FORBIDDEN",
  );
}
function stored(row: LockerRow): S["Locker"] {
  return (
    row.canonical ?? {
      id: row.id,
      version: row.version,
      branchId: row.branchId,
      lockerNo: row.name,
      ratePer4WeeksKrw: 10000,
      status: row.status === "사용 불가" ? "운영 중단" : "사용 가능",
      assignmentState: "사용 가능",
      activeAssignment: null,
    }
  );
}
const assignments = () => store.db.lockers.flatMap((l) => l.assignments ?? []);
export function assignmentView(a: Assignment, u: Employee): Assignment {
  const l = stored(store.get("lockers", a.locker.id));
  return {
    ...structuredClone(a),
    locker: { id: l.id, lockerNo: l.lockerNo },
    customer: customer(a.customer.id),
    overdue: a.status === "배정" && a.endDate <= today(),
    charges:
      can(u, a.branchId, "payments:read") ||
      can(u, a.branchId, "payments:write")
        ? structuredClone(a.charges)
        : null,
  };
}
function lockerView(row: LockerRow): S["Locker"] {
  const l = stored(row),
    active = (row.assignments ?? []).find(
      (a) => a.status === "배정" && a.startDate <= today(),
    );
  return {
    ...l,
    assignmentState:
      l.status === "운영 중단" ? "운영 중단" : active ? "사용 중" : "사용 가능",
    activeAssignment: active
      ? {
          id: active.id,
          customer: customer(active.customer.id),
          startDate: active.startDate,
          endDate: active.endDate,
          overdue: active.endDate <= today(),
        }
      : null,
  };
}
function readLocker(a: Args, u: Employee) {
  const branches = selected(a, u),
    row = store.db.lockers.find(
      (l) => l.id === a.params.id && branches.includes(l.branchId),
    );
  assert(row, "사물함을 찾을 수 없습니다.", 404, "NOT_FOUND");
  return row;
}
function readAssignment(a: Args, u: Employee) {
  const branches = selected(a, u),
    row = assignments().find(
      (l) => l.id === a.params.id && branches.includes(l.branchId),
    );
  assert(row, "배정을 찾을 수 없습니다.", 404, "NOT_FOUND");
  return row;
}
function current(expected: number, actual: number, path: string) {
  if (expected !== actual || store.scenario === "conflict")
    throw new DomainError(
      409,
      "VERSION_CONFLICT",
      "최신 정보를 확인한 뒤 다시 저장해 주세요.",
      undefined,
      actual,
      path,
    );
}
function unique(branch: string, no: string, except?: string) {
  assert(
    !store.db.lockers.some(
      (l) =>
        l.branchId === branch && stored(l).lockerNo === no && l.id !== except,
    ),
    "같은 지점에 이미 있는 사물함 번호입니다.",
    409,
    "DUPLICATE_LOCKER_NO",
  );
}
function saveLocker(row: LockerRow, value: S["Locker"], changed = true) {
  row.canonical = value;
  row.name = value.lockerNo;
  row.version = value.version;
  row.status = value.status === "운영 중단" ? "사용 불가" : "이용 가능";
  if (changed) {
    row.updatedAt = store.now();
    store.emit("lockers", row.id, row.branchId);
  }
  return lockerView(row);
}
function changed(a: Assignment) {
  store.emit("locker-assignments", a.id, a.branchId);
  store.emit("lockers", a.locker.id, a.branchId);
}
function keyed<T>(
  a: Args,
  operation: string,
  scope: string,
  input: unknown,
  action: () => T,
): T {
  const key = a.request.headers.get("Idempotency-Key");
  assert(
    key && key.length >= 16 && key.length <= 128,
    "16~128자 요청 키가 필요합니다.",
    422,
    "VALIDATION_FAILED",
  );
  // Keep canonical command snapshots in the existing persisted request ledger. Permissions
  // are checked by each caller before reaching this replay, including after a role change.
  const index = `${store.persona}:locker-api:${operation}:${scope}:${key}`,
    fingerprint = JSON.stringify(input),
    prior = store.idempotency[index];
  if (prior) {
    assert(
      prior.fingerprint === fingerprint,
      "같은 키로 다른 입력을 저장할 수 없습니다.",
      409,
      "IDEMPOTENCY_CONFLICT",
    );
    return structuredClone(prior.result) as T;
  }
  const before = structuredClone(store.db);
  try {
    const result = action();
    store.idempotency[index] = {
      fingerprint,
      result: structuredClone(result),
      authorization: "locker-api",
    };
    store.persist();
    return result;
  } catch (e) {
    store.db = before;
    throw e;
  }
}
function terms(from: string, end: string) {
  const days = (Date.parse(end) - Date.parse(from)) / 86400000;
  assert(
    days > 0 && days % 28 === 0,
    "기간은 28일의 배수여야 합니다.",
    422,
    "LOCKER_TERM_INVALID",
  );
  return days / 28;
}
function canCharge(l: LockerRow) {
  assert(
    store.get("branches", l.branchId).status === "운영 중",
    "운영 중지 지점에서는 배정하거나 연장할 수 없습니다.",
    409,
    "BRANCH_NOT_ACTIVE",
  );
  assert(
    stored(l).status === "사용 가능",
    "운영 중단된 사물함입니다.",
    422,
    "LOCKER_NOT_AVAILABLE",
  );
}
function charge(
  a: Assignment,
  u: Employee,
  start: string,
  end: string,
  paymentMethod: S["Payment"]["method"],
  approved: boolean,
  kind: S["LockerCharge"]["kind"],
) {
  const l = stored(store.get("lockers", a.locker.id)),
    count = terms(start, end),
    amount = l.ratePer4WeeksKrw * count,
    at = store.now();
  assert(
    Number.isSafeInteger(amount),
    "결제 금액이 허용 범위를 넘습니다.",
    422,
    "VALIDATION_FAILED",
  );
  const p = store.add("payments", a.branchId, {
    memberId: a.customer.id,
    productId: "",
    reservationId: "",
    amount,
    method: paymentMethod === "현금" ? "Mock 현금" : "Mock 카드",
    status: approved ? "승인" : "실패",
    refundAt: "",
    refundBranchId: "",
    reason: "",
    approvedAt: approved ? at : "",
  });
  p.canonical = {
    id: p.id,
    version: p.version,
    mock: true,
    purpose: "사물함",
    roomReservationId: null,
    lockerAssignmentId: a.id,
    branchId: a.branchId,
    customer: customer(a.customer.id),
    productId: null,
    productName: null,
    method: paymentMethod,
    amountKrw: amount,
    status: p.status,
    approvedAt: approved ? at : null,
    failedAt: approved ? null : at,
    createdAt: at,
    createdBy: actor(u),
    passId: null,
    canRefund: false,
    refund: null,
  };
  a.charges!.push({
    id: crypto.randomUUID(),
    kind,
    startDate: start,
    endDate: end,
    terms: count,
    ratePer4WeeksKrw: l.ratePer4WeeksKrw,
    amountKrw: amount,
    status: approved ? "적용" : "실패",
    paymentId: p.id,
    createdAt: at,
    appliedAt: approved ? at : null,
  });
  store.emit("payments", p.id, a.branchId);
}
function page<T>(a: Args, rows: T[]) {
  const q = new URL(a.request.url).searchParams,
    page = Number(q.get("page") || 1),
    pageSize = Number(q.get("pageSize") || 20);
  assert(
    Number.isSafeInteger(page) &&
      page > 0 &&
      Number.isInteger(pageSize) &&
      pageSize > 0 &&
      pageSize <= 100,
    "페이지를 확인해 주세요.",
    422,
    "VALIDATION_FAILED",
  );
  return {
    items: rows.slice((page - 1) * pageSize, page * pageSize),
    meta: { page, pageSize, total: rows.length },
  };
}
async function json(request: Request) {
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
const respond =
  (fn: (a: Args, u: Employee) => unknown | Promise<unknown>, code = 200) =>
  async (a: Args) => {
    try {
      const before = store.activeUser().id;
      if (store.scenario === "slow") await delay(2200);
      const u = store.activeUser();
      assert(
        u.id === before,
        "계정이 변경되었습니다.",
        403,
        "AUTHORIZATION_CHANGED",
      );
      assert(
        store.scenario !== "forbidden",
        "접근 권한이 없습니다.",
        403,
        "FORBIDDEN",
      );
      assert(
        store.scenario !== "error",
        "일시적 서버 오류입니다.",
        503,
        "SERVICE_UNAVAILABLE",
      );
      if (a.request.method !== "GET")
        assert(
          a.request.headers.get("X-CSRF-Token") === "openstudy-mock-csrf",
          "CSRF 토큰을 확인해 주세요.",
          403,
          "CSRF_INVALID",
        );
      const result = await fn(a, u);
      store.persist();
      return HttpResponse.json(result as Record<string, unknown>, {
        status: code,
        headers: { "Cache-Control": "no-store" },
      });
    } catch (e) {
      const error =
        e instanceof z.ZodError
          ? new DomainError(
              422,
              "VALIDATION_FAILED",
              "입력을 확인해 주세요.",
              Object.fromEntries(
                e.issues.map((i) => [i.path.join(".") || "body", i.message]),
              ),
            )
          : e instanceof DomainError
            ? e
            : new DomainError(500, "MOCK_ERROR", "요청을 처리하지 못했습니다.");
      return HttpResponse.json(
        {
          code: error.code,
          message: error.message,
          fieldErrors: error.fieldErrors,
          latestVersion: error.latestVersion,
          reloadUrl: error.reloadUrl,
          requestId: crypto.randomUUID(),
        },
        { status: error.status },
      );
    }
  };
export const lockerHandlers = [
  http.get(
    "/api/lockers/occupancy",
    respond((a, u) => ({
      items: selected(a, u)
        .sort()
        .map((branchId) => {
          const rows = (store.scenario === "empty" ? [] : store.db.lockers)
            .filter((l) => l.branchId === branchId)
            .map(lockerView);
          return {
            branchId,
            total: rows.length,
            inUse: rows.filter((l) => l.assignmentState === "사용 중").length,
            available: rows.filter((l) => l.assignmentState === "사용 가능")
              .length,
            blocked: rows.filter((l) => l.assignmentState === "운영 중단")
              .length,
            overdue: rows.filter(
              (l) =>
                l.assignmentState === "사용 중" && l.activeAssignment?.overdue,
            ).length,
            asOf: store.now(),
          };
        }),
    })),
  ),
  http.get(
    "/api/lockers",
    respond((a, u) => {
      const branches = selected(a, u),
        filter = new URL(a.request.url).searchParams.get("assignmentState");
      if (filter !== null)
        z.enum(["사용 가능", "사용 중", "운영 중단"]).parse(filter);
      return page(
        a,
        (store.scenario === "empty" ? [] : store.db.lockers)
          .filter((l) => branches.includes(l.branchId))
          .map(lockerView)
          .filter((l) => !filter || l.assignmentState === filter)
          .sort(
            (a, b) =>
              a.lockerNo.localeCompare(b.lockerNo) || a.id.localeCompare(b.id),
          ),
      );
    }),
  ),
  http.get(
    "/api/lockers/:id",
    respond((a, u) => lockerView(readLocker(a, u))),
  ),
  http.post(
    "/api/lockers",
    respond(async (a, u) => {
      const b = createInput.parse(await json(a.request));
      selected(a, u);
      requireWrite(u, b.branchId);
      return keyed(a, "create", b.branchId, b, () => {
        unique(b.branchId, b.lockerNo);
        const row = store.add("lockers", b.branchId, {
          name: b.lockerNo,
          memberId: "",
          startsOn: "",
          endsOn: "",
          status: "이용 가능",
          history: [],
        });
        return saveLocker(row, {
          id: row.id,
          version: 1,
          ...b,
          assignmentState: "사용 가능",
          activeAssignment: null,
        });
      });
    }, 201),
  ),
  http.patch(
    "/api/lockers/:id",
    respond(async (a, u) => {
      const raw = await json(a.request);
      assert(
        !raw ||
          typeof raw !== "object" ||
          !["branchId", "status"].some((k) => k in raw),
        "지점·운영 상태는 변경할 수 없습니다.",
        422,
        "IMMUTABLE_FIELD",
      );
      const b = updateInput.parse(raw),
        row = readLocker(a, u),
        l = stored(row);
      requireWrite(u, row.branchId);
      current(b.version, l.version, `/api/lockers/${row.id}`);
      if (b.lockerNo !== undefined) unique(row.branchId, b.lockerNo, row.id);
      const next = { ...l, ...b },
        changed =
          next.lockerNo !== l.lockerNo ||
          next.ratePer4WeeksKrw !== l.ratePer4WeeksKrw;
      return saveLocker(
        row,
        { ...next, version: l.version + Number(changed) },
        changed,
      );
    }),
  ),
  http.post(
    "/api/lockers/:id/status",
    respond(async (a, u) => {
      const b = z
          .object({ version, status, reason })
          .strict()
          .parse(await json(a.request)),
        row = readLocker(a, u),
        l = stored(row);
      requireWrite(u, row.branchId);
      current(b.version, l.version, `/api/lockers/${row.id}`);
      return saveLocker(
        row,
        {
          ...l,
          status: b.status,
          version: l.version + Number(l.status !== b.status),
        },
        l.status !== b.status,
      );
    }),
  ),
  http.post(
    "/api/branches/:id/locker-rate",
    respond(async (a, u) => {
      const b = z
          .object({ ratePer4WeeksKrw: rate })
          .strict()
          .parse(await json(a.request)),
        branch = String(a.params.id);
      assert(readable(u, branch), "지점을 찾을 수 없습니다.", 404, "NOT_FOUND");
      requireWrite(u, branch);
      return keyed(a, "rate", branch, b, () => {
        let updated = 0;
        for (const row of store.db.lockers.filter(
          (l) => l.branchId === branch,
        )) {
          const l = stored(row);
          // The backend bulk command bumps every row, including unchanged rates.
          saveLocker(row, { ...l, ...b, version: l.version + 1 });
          updated++;
        }
        return { updated, ...b };
      });
    }),
  ),
  http.get(
    "/api/locker-assignments",
    respond((a, u) => {
      const branches = selected(a, u),
        q = new URL(a.request.url).searchParams,
        filter = q.get("status");
      if (filter !== null)
        z.enum(["배정", "반납", "결제 실패", "취소"]).parse(filter);
      return page(
        a,
        (store.scenario === "empty" ? [] : assignments())
          .filter(
            (l) =>
              branches.includes(l.branchId) &&
              (!q.has("lockerId") || l.locker.id === q.get("lockerId")) &&
              (!q.has("customerId") || l.customer.id === q.get("customerId")) &&
              (!filter || l.status === filter),
          )
          .sort(
            (a, b) =>
              b.createdAt.localeCompare(a.createdAt) ||
              b.id.localeCompare(a.id),
          )
          .map((l) => assignmentView(l, u)),
      );
    }),
  ),
  http.get(
    "/api/locker-assignments/:id",
    respond((a, u) => assignmentView(readAssignment(a, u), u)),
  ),
  http.post(
    "/api/locker-assignments",
    respond(async (a, u) => {
      const b = assignInput.parse(await json(a.request));
      selected(a, u);
      requireWrite(u, b.branchId, true);
      return keyed(a, "assign", b.branchId, b, () => {
        const l = store.db.lockers.find(
          (l) => l.id === b.lockerId && readable(u, l.branchId),
        );
        assert(l, "사물함을 찾을 수 없습니다.", 404, "NOT_FOUND");
        assert(
          l.branchId === b.branchId,
          "요청한 지점의 사물함이 아닙니다.",
          422,
          "LOCKER_BRANCH_MISMATCH",
        );
        canCharge(l);
        assert(
          b.startDate >= today(),
          "기간은 오늘 이후에 시작해야 합니다.",
          422,
          "LOCKER_TERM_INVALID",
        );
        terms(b.startDate, b.endDate);
        const c = store.get("members", b.customerId),
          related = [
            c.registeredBranchId ?? c.branchId,
            ...store.db.payments
              .filter((p) => p.memberId === c.id)
              .map((p) => p.branchId),
          ];
        assert(
          u.owner || related.some((branch) => readable(u, branch)),
          "고객을 찾을 수 없습니다.",
          404,
          "NOT_FOUND",
        );
        assert(
          c.status === "정상",
          "정상 고객만 결제할 수 있습니다.",
          409,
          "CUSTOMER_NOT_ACTIVE",
        );
        const held = (l.assignments ?? []).filter((a) => a.status === "배정");
        assert(
          !held.some((a) => a.endDate <= today()),
          "기간이 끝났지만 반납되지 않은 배정이 있습니다.",
          409,
          "LOCKER_NOT_RETURNED",
        );
        assert(
          !held.some((a) => a.startDate < b.endDate && b.startDate < a.endDate),
          "같은 기간에 이미 배정이 있습니다.",
          409,
          "LOCKER_PERIOD_CONFLICT",
        );
        const at = store.now(),
          result: Assignment = {
            id: crypto.randomUUID(),
            version: 1,
            status: b.mockOutcome === "APPROVED" ? "배정" : "결제 실패",
            branchId: b.branchId,
            locker: { id: l.id, lockerNo: stored(l).lockerNo },
            customer: customer(c.id),
            startDate: b.startDate,
            endDate: b.endDate,
            overdue: false,
            returnedAt: null,
            assignedBy: actor(u),
            lastChangedBy: null,
            reason: null,
            charges: [],
            createdAt: at,
            updatedAt: at,
          };
        charge(
          result,
          u,
          b.startDate,
          b.endDate,
          b.method,
          b.mockOutcome === "APPROVED",
          "최초",
        );
        (l.assignments ??= []).push(result);
        changed(result);
        return assignmentView(result, u);
      });
    }, 201),
  ),
  http.post(
    "/api/locker-assignments/:id/extend",
    respond(async (a, u) => {
      const b = extendInput.parse(await json(a.request)),
        row = readAssignment(a, u);
      requireWrite(u, row.branchId, true);
      return keyed(a, "extend", row.id, b, () => {
        current(b.version, row.version, `/api/locker-assignments/${row.id}`);
        assert(
          row.status === "배정",
          "배정 상태만 연장할 수 있습니다.",
          409,
          "INVALID_STATE",
        );
        const l = store.get("lockers", row.locker.id);
        canCharge(l);
        terms(row.endDate, b.endDate);
        assert(
          !(l.assignments ?? []).some(
            (v) =>
              v.id !== row.id &&
              v.status === "배정" &&
              v.startDate < b.endDate &&
              row.endDate < v.endDate,
          ),
          "같은 기간에 이미 배정이 있습니다.",
          409,
          "LOCKER_PERIOD_CONFLICT",
        );
        charge(
          row,
          u,
          row.endDate,
          b.endDate,
          b.method,
          b.mockOutcome === "APPROVED",
          "연장",
        );
        if (b.mockOutcome === "APPROVED") {
          row.endDate = b.endDate;
          row.version++;
          row.lastChangedBy = actor(u);
          row.updatedAt = store.now();
        }
        changed(row);
        return assignmentView(row, u);
      });
    }),
  ),
  http.post(
    "/api/locker-assignments/:id/return",
    respond(async (a, u) => {
      const b = z
          .object({ version, reason: reason.optional() })
          .strict()
          .parse(await json(a.request)),
        row = readAssignment(a, u);
      current(b.version, row.version, `/api/locker-assignments/${row.id}`);
      assert(
        row.status === "배정",
        "배정 상태만 반납할 수 있습니다.",
        409,
        "INVALID_STATE",
      );
      row.status = "반납";
      row.returnedAt = store.now();
      row.updatedAt = row.returnedAt;
      row.lastChangedBy = actor(u);
      row.reason = b.reason ?? null;
      row.version++;
      changed(row);
      return assignmentView(row, u);
    }),
  ),
];
