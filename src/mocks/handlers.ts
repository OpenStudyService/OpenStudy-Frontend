import { salesHandlers } from "./sales";
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
  inScope,
  leaveBalance,
  rowsFor,
  sales,
  sendMessage,
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
import {
  allowedChatChannel,
  markChatRead,
  unreadMessages,
  reconcileChannelParticipants,
} from "./chat-policy";
import { canManageChannel } from "../features/chat/model";

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
const allowedChannel = (id: string) => {
  return allowedChatChannel(store, id);
};

/** Saved mock AI conversations of this browser session, by employee (#71). Results are rebuilt, never stored. */
const aiConversationStore = new Map<
  string,
  {
    id: string;
    employeeId: string;
    title: string;
    scope: string;
    createdAt: string;
    lastAskedAt: string;
    questions: { question: string; askedAt: string }[];
  }
>();
/** The mock DomainLens answer: every question returns the branch sales comparison of the mock ledger. */
function mockAiAnswer(q: string, s: string, conversationId: string) {
  const reqId = `req-${crypto.randomUUID().slice(0, 8)}`;
  const execId = `exec-${crypto.randomUUID().slice(0, 8)}`;
  const traceId = `trc-${crypto.randomUUID().slice(0, 8)}`;
  const rows = sales(store, s, "2026-10-01", "2026-10-18", "processed");
  return {
    requestId: reqId,
    executionId: execId,
    conversationId,
    traceId,
    status: "COMPLETED",
    httpStatus: 200,
    errorCode: null,
    resultCategory: "EXECUTED",
    behavior: "EXECUTE_ANALYSIS",
    message: null,
    pocCode: "POC-001",
    analysisId: "openstudy.sales.branchComparison",
    intentDomain: "sales",
    semanticStatus: "CONFIRMED_ADR",
    querySpec: {
      id: "qs_openstudy.sales.branchComparison",
      source: "payment",
      grain: "payment",
      mode: "REGISTERED_ANALYSIS",
      analysisId: "openstudy.sales.branchComparison",
    },
    viewSpec: {
      catalogVersion: "openstudy-ui-1.0.0",
      components: [
        {
          id: "comp_bar",
          componentRef: { id: "BAR_CHART", version: "1.0.0" },
          datasetId: "branchSales",
          bindings: {},
          options: {},
          events: [],
        },
      ],
    },
    envelope: {
      requestId: reqId,
      executionId: execId,
      status: "COMPLETED",
      datasets: [
        {
          id: "branchSales",
          columns: [
            {
              alias: "branch_id",
              type: "INTEGER",
              unit: null,
              precision: 0,
            },
            {
              alias: "branch_name",
              type: "STRING",
              unit: null,
              precision: null,
            },
            {
              alias: "approved_krw",
              type: "INTEGER",
              unit: "KRW",
              precision: 0,
            },
            {
              alias: "refund_krw",
              type: "INTEGER",
              unit: "KRW",
              precision: 0,
            },
            {
              alias: "net_krw",
              type: "INTEGER",
              unit: "KRW",
              precision: 0,
            },
          ],
          rows: rows.map((r) => ({
            branch_id: r.branchId,
            branch_name: r.branch,
            approved_krw: r.approved,
            refund_krw: r.refunds,
            net_krw: r.net,
          })),
          totalElements: rows.length,
          page: 0,
          size: 50,
          snapshotAt: AS_OF,
          asOf: AS_OF,
        },
      ],
      view: {
        catalogVersion: "openstudy-ui-1.0.0",
        components: [
          {
            id: "comp_bar",
            componentRef: { id: "BAR_CHART", version: "1.0.0" },
            datasetId: "branchSales",
            bindings: {},
            options: {},
            events: [],
          },
        ],
      },
      warnings: [],
      errorCode: null,
      asOf: AS_OF,
      snapshotVersion: "openstudy-semantic-1.0.0",
      policyVersion: "openstudy-policy-v1",
    },
    summary: {},
    truncation: {
      maxRows: 1000,
      pageSize: 50,
      maxChartCategories: 20,
      isTruncated: false,
      warningCode: null,
      message: null,
    },
    clarificationOptions: [],
    stages: [
      {
        stage: "accepted",
        label: "질문 접수 및 정규화",
        status: "COMPLETED",
        durationMs: 2,
        detail: q,
      },
      {
        stage: "completed",
        label: "ViewSpec 바인딩 및 결과 검증",
        status: "COMPLETED",
        durationMs: 4,
        detail: "BAR_CHART",
      },
    ],
    retrievedCandidates: [
      { id: "payment", kind: "ENTITY", score: 0.942 },
      { id: "sales.net_sales_krw", kind: "METRIC", score: 0.918 },
    ],
    securityGate: { requestedScope: s, outcome: "EXECUTE" },
    legacyExecution: {
      id: execId,
      status: "READY",
      asOf: AS_OF,
      start: "2026-11-01",
      end: "2026-11-03",
      currency: "KRW",
      timeZone: "Asia/Seoul",
      refundBasis: "processed",
      viewSpec: { component: "bar", title: q },
      rows,
    },
  };
}
function ownAiConversation(id: string) {
  const c = aiConversationStore.get(id);
  assert(
    c?.employeeId === store.activeUser().id,
    "AI 대화를 찾을 수 없습니다.",
    404,
    "NOT_FOUND",
  );
  return c!;
}
export const handlers = [
  ...salesHandlers,
  ...attendanceHandlers,
  ...workforceHandlers,
  ...roomHandlers,
  ...lockerHandlers,
  ...customerHistoryHandlers,
  ...collaborationHandlers,
  ...invitationHandlers,
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
        channels: rowsFor(store, "channels", s),
      };
    }),
  ),
  http.get(
    "/api/home",
    response(async (a) => {
      await scenario();
      const s = scope(a);
      return {
        tasks: rowsFor(store, "tasks", s),
        seats: rowsFor(store, "seats", s),
        facilities: rowsFor(store, "facilities", s),
        inquiries: rowsFor(store, "inquiries", s),
        notices: rowsFor(store, "notices", s),
        shifts: store.db.shifts.filter((x) => inScope(store.user(), x, s)),
        attendance: rowsFor(store, "attendance", s),
        messages: rowsFor(store, "messages", s).slice(-5),
      };
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
  http.get(
    "/api/chat/channels",
    response((a) => {
      return rowsFor(store, "channels", scope(a)).map((row) => {
        const c = store.get("channels", row.id);
        return {
          ...c,
          unread: unreadMessages(store, c.id),
        };
      });
    }),
  ),
  http.post(
    "/api/chat/dm",
    response(async (a) => {
      const p = await json(a),
        u = store.user(),
        peer = store.get("employees", String(p.employeeId));
      assert(
        peer.id !== u.id &&
          peer.status === "활성" &&
          (u.owner ||
            peer.owner ||
            u.memberships.some((m) =>
              peer.memberships.some((n) => n.branchId === m.branchId),
            )),
        "이 직원과 대화할 수 없습니다.",
        403,
        "SCOPE_DENIED",
      );
      const prior = store.db.channels.find(
        (c) =>
          c.kind === "dm" &&
          c.participantIds.length === 2 &&
          c.participantIds.includes(u.id) &&
          c.participantIds.includes(peer.id),
      );
      return (
        prior ||
        notify(
          "channels",
          store.add("channels", "all", {
            name: peer.name,
            description: "직원 다이렉트 메시지",
            kind: "dm",
            participantIds: [u.id, peer.id],
            reads: {},
            status: "활성",
          }),
        )
      );
    }),
  ),
  http.get(
    "/api/chat/:channelId/messages",
    response(async (a) => {
      await scenario();
      const c = allowedChannel(String(a.params.channelId)),
        u = new URL(a.request.url),
        cursor = Number(u.searchParams.get("before") || Infinity),
        after = Number(u.searchParams.get("after") || 0),
        parent = u.searchParams.get("parent");
      const all = store.db.messages.filter(
        (m) =>
          m.channelId === c.id &&
          m.sequence < cursor &&
          m.sequence > after &&
          (parent === null || m.parentId === parent),
      );
      const items = all.slice(-30);
      return {
        items: items.map((m) =>
          m.taskId ? { ...m, text: "업무를 공유했어요." } : m,
        ),
        nextCursor: all.length > 30 ? String(items[0].sequence) : undefined,
        total: all.length,
      };
    }),
  ),
  http.post(
    "/api/chat/:channelId/messages",
    response(async (a) => {
      const p = await json(a);
      if (store.scenario === "message-failure")
        throw new DomainError(
          503,
          "SEND_FAILED",
          "메시지 전송에 실패했습니다. 같은 내용으로 재전송할 수 있어요.",
        );
      return notify(
        "messages",
        transact(a, p, () =>
          sendMessage(store, { ...p, channelId: String(a.params.channelId) }),
        ),
      );
    }),
  ),
  http.post(
    "/api/chat/:channelId/read",
    response(async (a) => {
      const p = await json(a);
      const seq = z.number().int().nonnegative().parse(p.sequence);
      const parentId = typeof p.parentId === "string" ? p.parentId : "";
      const c = markChatRead(store, String(a.params.channelId), parentId, seq);
      store.emit("channels", c.id, c.branchId, "read");
      return { ok: true };
    }),
  ),
  http.get(
    "/api/catalog/readiness",
    response(() => ({
      ready: store.scenario !== "ai-unavailable",
      mode: "mock",
      message:
        "DomainLens 응답을 모킹하고 있습니다. 실제 엔진은 연결되지 않았습니다.",
    })),
  ),
  http.get(
    "/api/components",
    response(() => ({ components: ["table", "bar", "line"] })),
  ),
  // DomainLens AI chat (synchronous /ai/queries), from the OpenStudy-DomainLenz port.
  http.get(
    "/api/ai/readiness",
    response(() => ({
      ready: store.scenario !== "ai-unavailable",
      mode: "mock",
      catalogVersion: "openstudy-semantic-1.0.0",
      policyVersion: "openstudy-policy-v1",
      embeddingModel: "koen-e5-tiny-q8",
      embeddingDimensions: 384,
      asOf: AS_OF,
    })),
  ),
  http.post(
    "/api/ai/queries",
    response(async (a) => {
      const p = await json(a);
      const q = String(p.question || "").trim();
      const s = String(p.scope || "all");
      const employeeId = store.activeUser().id;
      const asked = String(p.conversationId || "");
      const saved = asked ? aiConversationStore.get(asked) : undefined;
      assert(
        !asked || saved?.employeeId === employeeId,
        "AI 대화를 찾을 수 없습니다.",
        404,
        "NOT_FOUND",
      );
      const now = new Date().toISOString();
      const conversation = saved ?? {
        id: `conv-${crypto.randomUUID().slice(0, 8)}`,
        employeeId,
        title: q.slice(0, 40),
        scope: s,
        createdAt: now,
        lastAskedAt: now,
        questions: [],
      };
      conversation.lastAskedAt = now;
      conversation.questions.push({ question: q, askedAt: now });
      aiConversationStore.set(conversation.id, conversation);
      return mockAiAnswer(q, s, conversation.id);
    }),
  ),
  http.get(
    "/api/ai/conversations",
    response(() => {
      const employeeId = store.activeUser().id;
      return [...aiConversationStore.values()]
        .filter((c) => c.employeeId === employeeId)
        .sort((x, y) => y.lastAskedAt.localeCompare(x.lastAskedAt))
        .map(({ id, title, scope, createdAt, lastAskedAt }) => ({
          id,
          title,
          scope,
          createdAt,
          lastAskedAt,
        }));
    }),
  ),
  http.get(
    "/api/ai/conversations/:id",
    response((a) => {
      const c = ownAiConversation(String(a.params.id));
      const s = new URL(a.request.url).searchParams.get("scope") || c.scope;
      return {
        id: c.id,
        title: c.title,
        scope: s,
        turns: c.questions.map((t) => ({
          question: t.question,
          askedAt: t.askedAt,
          response: {
            ...mockAiAnswer(t.question, s, c.id),
            resultCategory: "REOPENED",
            message: "저장된 질문을 현재 권한과 기준 시각으로 다시 조회했어요.",
          },
        })),
      };
    }),
  ),
  http.patch(
    "/api/ai/conversations/:id",
    response(async (a) => {
      const c = ownAiConversation(String(a.params.id));
      const title = String((await json(a)).title || "").trim();
      assert(
        title.length > 0 && title.length <= 200,
        "대화 제목은 1~200자로 입력해 주세요.",
        422,
        "VALIDATION_FAILED",
      );
      c.title = title;
      return { id: c.id, title };
    }),
  ),
  http.delete(
    "/api/ai/conversations/:id",
    response((a) => {
      const c = ownAiConversation(String(a.params.id));
      aiConversationStore.delete(c.id);
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
      if (r === "channels") {
        const user = store.activeUser();
        assert(
          canManageChannel(user, "all") ||
            user.memberships.some(
              (m) =>
                canManageChannel(user, m.branchId) &&
                (scope(a) === "all" || scope(a) === m.branchId),
            ),
          "채널 관리 권한이 없습니다.",
          403,
          "SCOPE_DENIED",
        );
        reconcileChannelParticipants(store);
        rows = store.db.channels.filter(
          (c) =>
            c.kind === "channel" &&
            canManageChannel(store.activeUser(), c.branchId) &&
            (scope(a) === "all" ||
              c.branchId === scope(a) ||
              c.branchId === "all"),
        );
      }
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
      if (r === "channels") {
        const channel = store.get("channels", String(a.params.id));
        assert(
          canManageChannel(store.activeUser(), channel.branchId) &&
            (s === "all" ||
              channel.branchId === "all" ||
              s === channel.branchId),
          "채널 관리 권한이 없습니다.",
          403,
          "SCOPE_DENIED",
        );
        return channel;
      }
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
