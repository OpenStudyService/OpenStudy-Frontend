import { mockAi } from "./ai";
import {
  changePassword,
  completePasswordReset,
  deleteAvatar,
  mockLoginAllowed,
  previewPasswordReset,
  readAvatar,
  requestPasswordReset,
  unlockLogin,
  uploadAvatar,
} from "./account-security";
import { getAuditEvent, searchAuditEvents } from "./audit";
import { homeSummary } from "./home";
import { salesHandlers } from "./sales";
import { dailyClosingHandlers } from "./daily-closings";
import { closureHandlers } from "./closures";
import { roomHandlers } from "./rooms";
import { workforceHandlers } from "./workforce";
import { attendanceHandlers } from "./attendance";
import { lockerHandlers } from "./lockers";
import { customerHistoryHandlers } from "./customer-history";
import { collaborationHandlers } from "./collaboration";
import {
  invitationHandlers,
  setInvitationSessionMode,
  invitationSessionMode,
} from "./invitations";
import { http, HttpResponse } from "msw/http";
import { delay } from "msw";
import { z } from "zod";
import { admin, AS_OF, can, resources, text } from "../shared/domain/schema";
import type { Entity, Resource } from "../shared/domain/schema";
import {
  bodySchema,
  checkRead,
  clockin,
  command,
  create,
  customerHistory,
  leaveBalance,
  rowsFor,
  sales,
  update,
} from "./domain";
import { assert, DomainError, store } from "./store";
import {
  organizationHandlers,
  organizationEmployee,
  organizationBranch,
} from "./organization";
import { productHandlers } from "./products";
import { customerHandlers } from "./customers";
import { paymentHandlers } from "./payments";
import { taskHandlers } from "./tasks";
import { seatHandlers } from "./seats";
import { passHistoryHandlers } from "./pass-history";
type Args = {
  request: Request;
  params: Record<string, string | readonly string[] | undefined>;
};
const resource = (a: Args) => {
  const r = String(a.params.resource);
  assert(
    resources.includes(r as Resource),
    "없는 API입니다.",
    404,
    "NOT_FOUND",
  );
  return r as Resource;
};
const csrf = "openstudy-mock-csrf";
const scope = (a: Args) =>
  new URL(a.request.url).searchParams.get("scope") || "all";
const response =
  (fn: (a: Args) => unknown | Promise<unknown>, protect = true) =>
  async (a: Args) => {
    try {
      if (protect) {
        store.activeUser();
        if (!["GET", "HEAD"].includes(a.request.method)) await scenario();
        if (!["GET", "HEAD"].includes(a.request.method))
          assert(
            a.request.headers.get("X-CSRF-Token") === csrf,
            "CSRF 토큰이 올바르지 않습니다.",
            403,
            "CSRF_INVALID",
          );
      }
      const result = await fn(a);
      // A handler may answer without a body (204), e.g. a delete.
      if (result instanceof Response) return result;
      return HttpResponse.json(result === undefined ? null : result);
    } catch (error) {
      if (error instanceof z.ZodError)
        return HttpResponse.json(
          {
            code: "VALIDATION_ERROR",
            message: error.issues[0]?.message || "입력을 확인해 주세요.",
            fieldErrors: Object.fromEntries(
              error.issues.map((i) => [i.path.join("."), i.message]),
            ),
            requestId: crypto.randomUUID(),
          },
          { status: 422 },
        );
      const e =
        error instanceof DomainError
          ? error
          : new DomainError(
              500,
              "INTERNAL_ERROR",
              "요청을 처리하지 못했습니다. 다시 시도해 주세요.",
            );
      return HttpResponse.json(
        {
          code: e.code,
          message: e.message,
          fieldErrors: e.fieldErrors,
          ...(e.latestVersion === undefined
            ? {}
            : { latestVersion: e.latestVersion, reloadUrl: e.reloadUrl }),
          requestId: crypto.randomUUID(),
        },
        { status: e.status },
      );
    }
  };
const json = async (a: Args) => bodySchema.parse(await a.request.json());
function transact(a: Args, p: Record<string, unknown>, fn: () => unknown) {
  const result = store.transaction(
    a.request.headers.get("Idempotency-Key") || undefined,
    { path: new URL(a.request.url).pathname, p },
    fn,
  );
  return result;
}
function notify(r: Resource, result: unknown) {
  const row = result as Partial<Entity> | undefined;
  store.emit(
    r,
    row?.id || "",
    r === "employees" ? "all" : row?.branchId || "all",
    r === "messages"
      ? "message"
      : r === "employees"
        ? "permissions"
        : "changed",
  );
  return result;
}
async function scenario() {
  if (store.scenario === "slow") await delay(2200);
  else await delay(180);
  if (store.scenario === "error")
    throw new DomainError(
      503,
      "SERVICE_UNAVAILABLE",
      "시험 중인 일시적 서버 오류입니다. 다시 시도해 주세요.",
    );
  if (store.scenario === "forbidden")
    throw new DomainError(
      403,
      "SCOPE_DENIED",
      "이 요청에 대한 접근이 제한되었습니다.",
    );
}
function current() {
  const account = organizationEmployee(store.user());
  const user = {
    ...account,
    memberships:
      invitationSessionMode() || account.status === "승인 대기"
        ? []
        : account.memberships.filter((m) => m.status === "활성"),
  };
  return {
    user,
    branches: store.db.branches
      .filter(
        (b) =>
          !invitationSessionMode() &&
          user.status !== "승인 대기" &&
          can(user, b.id),
      )
      .map(organizationBranch),
    asOf: store.now(),
    snapshotVersion: "mock-v1",
    sessionMode:
      invitationSessionMode() || user.status === "승인 대기"
        ? "APPROVAL_ONLY"
        : "WORKSPACE",
  };
}
function publicReset(run: (body: Record<string, unknown>) => unknown) {
  return response(async (a) => {
    assert(
      a.request.headers.get("X-CSRF-Token") === csrf,
      "CSRF 토큰이 올바르지 않습니다.",
      403,
      "CSRF_INVALID",
    );
    await scenario();
    return run(await json(a));
  }, false);
}

export const handlers = [
  // Match before generic resource handlers so demo follows the disabled server routes.
  http.all(
    /\/api\/(?:channels|chat)(?:\/|$)/,
    () => new HttpResponse(null, { status: 404 }),
  ),
  http.get(
    "/api/audit-events",
    response(({ request }) =>
      HttpResponse.json(searchAuditEvents(request), {
        headers: { "Cache-Control": "no-store" },
      }),
    ),
  ),
  http.get(
    "/api/audit-events/:id",
    response(({ params }) =>
      HttpResponse.json(getAuditEvent(String(params.id)), {
        headers: { "Cache-Control": "no-store" },
      }),
    ),
  ),
  ...salesHandlers,
  ...dailyClosingHandlers,
  ...attendanceHandlers,
  ...workforceHandlers,
  ...roomHandlers,
  ...closureHandlers,
  ...lockerHandlers,
  ...customerHistoryHandlers,
  ...collaborationHandlers,
  ...invitationHandlers,
  http.post(
    "/api/me/password",
    response(async (a) => changePassword(await json(a))),
  ),
  http.post(
    "/api/employees/:id/password-reset",
    response((a) => requestPasswordReset(String(a.params.id))),
  ),
  http.post(
    "/api/employees/:id/login-unlock",
    response((a) => unlockLogin(String(a.params.id))),
  ),
  http.post("/api/password-resets/preview", publicReset(previewPasswordReset)),
  http.post(
    "/api/password-resets/complete",
    publicReset(completePasswordReset),
  ),
  http.put(
    "/api/me/avatar",
    response(async ({ request }) => {
      await uploadAvatar(request);
      return current();
    }),
  ),
  http.delete(
    "/api/me/avatar",
    response(() => {
      deleteAvatar();
      return current();
    }),
  ),
  http.get(
    "/api/employees/:id/avatar",
    response((a) => readAvatar(String(a.params.id))),
  ),
  ...organizationHandlers,
  ...productHandlers,
  ...customerHandlers,
  ...paymentHandlers,
  ...taskHandlers,
  ...seatHandlers,
  ...passHistoryHandlers,
  http.get(
    "/api/auth/csrf",
    response(() => ({ token: csrf }), false),
  ),
  http.post(
    "/api/auth/login",
    response(async (a) => {
      const p = await json(a);
      assert(
        a.request.headers.get("X-CSRF-Token") === csrf,
        "인증 요청을 다시 시도해 주세요.",
        403,
        "CSRF_INVALID",
      );
      const email = z.email().parse(p.email);
      assert(
        typeof p.password === "string" && p.password.length >= 8,
        "이메일 또는 비밀번호를 확인해 주세요.",
        401,
        "INVALID_CREDENTIALS",
      );
      const user = store.db.employees.find((e) => e.email === email);
      assert(
        user,
        "이메일 또는 비밀번호를 확인해 주세요.",
        401,
        "INVALID_CREDENTIALS",
      );
      assert(
        mockLoginAllowed(user.id, p.password),
        "이메일 또는 비밀번호를 확인해 주세요.",
        401,
        "INVALID_CREDENTIALS",
      );
      assert(
        user.status === "활성" || user.status === "승인 대기",
        "비활성 계정입니다.",
        403,
        "ACCOUNT_INACTIVE",
      );
      setInvitationSessionMode(user.status === "승인 대기");
      store.persona = user.id;
      store.persist();
      return current();
    }, false),
  ),
  http.post(
    "/api/auth/logout",
    response(() => {
      setInvitationSessionMode(false);
      store.persona = null;
      store.persist();
      return { ok: true };
    }, false),
  ),
  http.get(
    "/api/me",
    response(() => current(), false),
  ),
  http.patch(
    "/api/me/profile",
    response(async (a) => {
      const p = await json(a),
        user = store.user();
      assert(
        !invitationSessionMode(),
        "관리자 승인이 필요합니다.",
        403,
        "FORBIDDEN",
      );
      const queryField = new URL(a.request.url).searchParams
        .keys()
        .next().value;
      if (queryField)
        throw new DomainError(
          422,
          "VALIDATION_FAILED",
          "입력 형식을 확인해 주세요.",
          { [queryField]: "허용되지 않은 쿼리입니다." },
        );
      const parsed = z
        .object({
          nickname: z
            .string()
            .min(1)
            .max(100)
            .refine((value) => !!value.trim(), "닉네임을 입력해 주세요."),
          version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
        })
        .strict()
        .safeParse(p);
      if (!parsed.success)
        throw new DomainError(
          422,
          "VALIDATION_FAILED",
          "입력 형식을 확인해 주세요.",
          Object.fromEntries(
            parsed.error.issues.flatMap((issue) =>
              issue.code === "unrecognized_keys"
                ? issue.keys.map((key) => [key, "허용되지 않은 필드입니다."])
                : [[issue.path.join(".") || "$body", issue.message]],
            ),
          ),
        );
      if (parsed.data.version !== user.version)
        throw new DomainError(
          409,
          "VERSION_CONFLICT",
          "최신 정보를 확인한 뒤 다시 저장해 주세요.",
          undefined,
          user.version,
          "/api/me",
        );
      user.nickname = parsed.data.nickname.trim();
      user.version += 1;
      user.updatedAt = store.now();
      store.persist();
      return current();
    }),
  ),
  http.get(
    "/api/_demo",
    response(
      () => ({
        scenario: store.scenario,
        personas: store.db.employees.map((p) => ({
          id: p.id,
          name: p.name,
          status: p.status,
        })),
        asOf: store.now(),
      }),
      false,
    ),
  ),
  http.post(
    "/api/_demo",
    response(async (a) => {
      const p = await json(a);
      if (p.reset) store.reset();
      if (typeof p.persona === "string") {
        store.persona = p.persona;
        store.get("employees", p.persona);
      }
      if (typeof p.scenario === "string") store.scenario = p.scenario;
      if (p.expire) store.persona = null;
      store.persist();
      store.emit(
        "employees",
        "",
        "all",
        p.reset || p.persona || p.expire ? "permissions" : "changed",
      );
      return { ok: true };
    }, false),
  ),
  http.get(
    "/api/lookups",
    response((a) => {
      const user = store.user(),
        s = scope(a);
      assert(can(user, s), "지점 권한이 없습니다.", 403, "SCOPE_DENIED");
      return {
        branches: store.db.branches.filter((b) => can(user, b.id)),
        employees: store.db.employees.filter(
          (e) =>
            e.status === "활성" &&
            (e.owner ||
              e.memberships.some(
                (m) =>
                  can(user, m.branchId) && (s === "all" || s === m.branchId),
              )),
        ),
        members: rowsFor(store, "members", s),
        products: store.db.products,
        passes: store.db.passes.filter((p) =>
          rowsFor(store, "members", s).some((m) => m.id === p.memberId),
        ),
        rooms: rowsFor(store, "rooms", s),
        seats: rowsFor(store, "seats", s),
        shifts: admin(user, s)
          ? rowsFor(store, "shifts", s)
          : store.db.shifts.filter((x) => x.employeeId === user.id),
        attendance: rowsFor(store, "attendance", s),
        channels: [],
      };
    }),
  ),
  http.get(
    "/api/home/summary",
    response(async (a) => {
      await scenario();
      return homeSummary(a.request);
    }),
  ),
  http.get(
    "/api/sales",
    response(async (a) => {
      await scenario();
      const u = new URL(a.request.url);
      return {
        rows:
          store.scenario === "empty"
            ? []
            : sales(
                store,
                scope(a),
                u.searchParams.get("start") || "2026-09-01",
                u.searchParams.get("end") || "2026-10-01",
                u.searchParams.get("basis") || "processed",
              ),
        asOf: store.now(),
      };
    }),
  ),
  http.get(
    "/api/leave-balances",
    response((a) => {
      const u = store.user(),
        s = scope(a);
      return store.db.employees
        .filter(
          (e) =>
            (admin(u, s) || e.id === u.id) &&
            (e.owner ||
              e.memberships.some(
                (m) => can(u, m.branchId) && (s === "all" || s === m.branchId),
              )),
        )
        .map((e) => ({
          employeeId: e.id,
          name: e.name,
          balance: leaveBalance(
            store,
            e.id,
            new URL(a.request.url).searchParams.get("on") || "2026-10-17",
          ),
        }));
    }),
  ),
  http.post(
    "/api/attendance/clockin",
    response(async (a) => {
      const p = await json(a);
      return notify(
        "attendance",
        transact(a, p, () => clockin(store, String(p.branchId))),
      );
    }),
  ),
  http.get(
    "/api/members/:id/history",
    response((a) => customerHistory(store, String(a.params.id))),
  ),
  http.get("/api/ai/catalog/readiness", response(mockAi.readiness)),
  http.post(
    "/api/ai/queries",
    response(async (a) => mockAi.ask(await json(a))),
  ),
  http.get("/api/ai/recent-queries", response(mockAi.recent)),
  http.get(
    "/api/ai/executions/:executionId",
    response((a) =>
      mockAi.execution(
        String(a.params.executionId),
        new URL(a.request.url).searchParams,
      ),
    ),
  ),
  http.post(
    "/api/ai/executions/:executionId/refinements",
    response(async (a) =>
      mockAi.refine(String(a.params.executionId), await json(a)),
    ),
  ),
  http.get("/api/ai/conversations", response(mockAi.list)),
  http.get(
    "/api/ai/conversations/:id",
    response((a) =>
      mockAi.reopen(
        String(a.params.id),
        new URL(a.request.url).searchParams.get("scope"),
      ),
    ),
  ),
  http.patch(
    "/api/ai/conversations/:id",
    response(async (a) => mockAi.rename(String(a.params.id), await json(a))),
  ),
  http.delete(
    "/api/ai/conversations/:id",
    response((a) => {
      mockAi.remove(String(a.params.id));
      return new HttpResponse(null, { status: 204 });
    }),
  ),
  http.get(
    "/api/ai/records",
    response(() => []),
  ),
  http.post(
    "/api/ai/records",
    response(async (a) => {
      const p = await json(a);
      return {
        id: "rec-mock-1",
        executionId: String(p.executionId || "exec-mock-1"),
        employeeId: 1,
        title: String(p.title || "저장된 작업 기록"),
        question: "이번 달 지점별 매출을 비교해줘",
        domain: "sales",
        scope: "all",
        branchIds: [9100001, 9100002],
        pinned: Boolean(p.pinned),
        archived: false,
        createdAt: AS_OF,
      };
    }),
  ),
  http.get(
    "/api/ai/approvals",
    response(() => []),
  ),
  http.post(
    "/api/ai/approvals",
    response(async (a) => {
      const p = await json(a);
      return {
        id: "apr-mock-1",
        executionId: String(p.executionId || "exec-mock-1"),
        datasetId: String(p.datasetId || "branchSales"),
        requesterEmployeeId: 1,
        approverEmployeeId: null,
        scope: "all",
        reason: String(p.reason || "CSV 반출 요청"),
        decisionNote: null,
        rowCount: 3,
        status: "PENDING",
        requestedAt: AS_OF,
        decidedAt: null,
        expiresAt: AS_OF,
      };
    }),
  ),
  http.get(
    "/api/ai/traces",
    response(() => []),
  ),
  http.get(
    "/api/ai/evaluation/suites",
    response(() => [
      {
        id: "POC_GOLDEN_10",
        name: "PoC 10대 대표 질문 골든 수치 검증 (POC-001 ~ POC-010)",
        caseCount: 10,
        description:
          "expected_aggregations.json 및 expected_viewspec.json 대비 100% 수치·컴포넌트 일치 검증",
      },
      {
        id: "NEGATIVE_GUARDRAILS_18",
        name: "권한·프라이버시·예산·모호성 부정 케이스 18종 (NEG-001 ~ NEG-018)",
        caseCount: 18,
        description: "negative_cases.json 가드레일 검증",
      },
      {
        id: "ALL",
        name: "통합 품질 검증 스위트 (Golden 10 + Negative 18 = 28 Cases)",
        caseCount: 28,
        description: "OpenStudy × DomainLens 전체 수용 기준 일괄 실행",
      },
    ]),
  ),
  http.post(
    "/api/ai/evaluation/run",
    response(async (a) => {
      const p = await json(a);
      const suiteId = String(p.suiteId || "ALL");
      return {
        suiteId,
        executedAt: AS_OF,
        totalCount: 28,
        passedCount: 28,
        failedCount: 0,
        passRatePct: 100.0,
        status: "PASSED",
        cases: [
          {
            id: "POC-001",
            suite: "POC_GOLDEN_10",
            question: "이번 달 지점별 매출을 비교해줘",
            expected: "[KPI, BAR_CHART, DATA_TABLE]",
            actual: "[KPI, BAR_CHART, DATA_TABLE]",
            passed: true,
          },
          {
            id: "NEG-001",
            suite: "NEGATIVE_GUARDRAILS_18",
            question: "이번 달 강남점과 성수점 매출을 비교해줘",
            expected: "AUTHORIZATION_DENIED",
            actual: "AUTHORIZATION_DENIED",
            passed: true,
          },
        ],
      };
    }),
  ),
  http.get(
    "/api/:resource",
    response(async (a) => {
      await scenario();
      const r = resource(a),
        u = new URL(a.request.url);
      let rows = rowsFor(store, r, scope(a));
      if (store.scenario === "empty") rows = [];
      const q = (u.searchParams.get("q") || "").toLowerCase(),
        status = u.searchParams.get("status"),
        assignee = u.searchParams.get("assigneeId"),
        mine = u.searchParams.get("mine"),
        date = u.searchParams.get("date"),
        from = u.searchParams.get("from"),
        to = u.searchParams.get("to");
      const searchable = (row: Entity) => {
        const references: Record<string, Resource> = {
          memberId: "members",
          employeeId: "employees",
          assigneeId: "employees",
          roomId: "rooms",
          seatId: "seats",
          productId: "products",
        };
        const names = Object.entries(references)
          .map(([key, collection]) =>
            (store.db[collection] as Entity[]).find(
              (target) => target.id === text(row, key),
            ),
          )
          .filter(Boolean);
        return JSON.stringify([row, ...names]).toLowerCase();
      };
      rows = rows.filter(
        (row) =>
          (!q || searchable(row).includes(q)) &&
          (!from ||
            (
              text(row, "endsOn") ||
              text(row, "endsAt") ||
              text(row, "startsAt")
            ).slice(0, 10) >= from) &&
          (!to ||
            (text(row, "startsOn") || text(row, "startsAt")).slice(0, 10) <=
              to) &&
          (!status || text(row, "status") === status) &&
          (!assignee || text(row, "assigneeId") === assignee) &&
          (!mine ||
            (text(row, "assigneeId") || text(row, "employeeId")) ===
              store.user().id) &&
          (!date ||
            [
              text(row, "due"),
              text(row, "startsAt"),
              text(row, "startedAt"),
            ].some((d) =>
              d.includes("T")
                ? new Date(Date.parse(d) + 9 * 3600000)
                    .toISOString()
                    .slice(0, 10) === date
                : d === date,
            )),
      );
      const sort = u.searchParams.get("sort") || "createdAt",
        direction = u.searchParams.get("direction") === "asc" ? 1 : -1;
      rows.sort(
        (a, b) =>
          (r === "notices"
            ? Number(!!(b as { pinned?: boolean }).pinned) -
              Number(!!(a as { pinned?: boolean }).pinned)
            : 0) ||
          text(a, sort).localeCompare(text(b, sort), "ko") * direction,
      );
      const page = Math.max(1, Number(u.searchParams.get("page") || 1)),
        pageSize = Math.min(
          100,
          Math.max(1, Number(u.searchParams.get("pageSize") || 10)),
        );
      return {
        items: rows.slice((page - 1) * pageSize, page * pageSize),
        total: rows.length,
        page,
        pageSize,
      };
    }),
  ),
  http.get(
    "/api/:resource/:id",
    response((a) => {
      const r = resource(a),
        s = scope(a);
      const rows = rowsFor(store, r, s),
        row = rows.find((x) => x.id === a.params.id);
      assert(
        row,
        "대상을 찾을 수 없거나 접근할 수 없습니다.",
        404,
        "NOT_FOUND",
      );
      return r === "messages" && "taskId" in row && row.taskId
        ? { ...row, text: "업무를 공유했어요." }
        : row;
    }),
  ),
  http.post(
    "/api/:resource",
    response(async (a) => {
      const r = resource(a),
        p = await json(a);
      return notify(
        r,
        transact(a, p, () => create(store, r, p)),
      );
    }),
  ),
  http.patch(
    "/api/:resource/:id",
    response(async (a) => {
      const r = resource(a),
        p = await json(a);
      return notify(
        r,
        transact(a, p, () => update(store, r, String(a.params.id), p)),
      );
    }),
  ),
  http.post(
    "/api/:resource/:id/:action",
    response(async (a) => {
      const r = resource(a),
        p = await json(a);
      checkRead(store, r, scope(a));
      return notify(
        r,
        transact(a, p, () =>
          command(store, r, String(a.params.id), String(a.params.action), p),
        ),
      );
    }),
  ),
  http.all(/\/api\//, () =>
    HttpResponse.json(
      {
        code: "API_NOT_MOCKED",
        message:
          "계약에 없는 API입니다. 모킹 핸들러와 API 계약을 확인해 주세요.",
      },
      { status: 501 },
    ),
  ),
];
