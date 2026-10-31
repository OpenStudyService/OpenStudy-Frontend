import {
  invitationHandlers,
  setInvitationSessionMode,
  invitationSessionMode,
} from "./invitations";
import { http, HttpResponse } from "msw/http";
import { delay } from "msw";
import { sse } from "msw/sse";
import { z } from "zod";
import { admin, AS_OF, can, resources, text } from "../shared/domain/schema";
import type { Entity, Resource, WorkspaceEvent } from "../shared/domain/schema";
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

type AiEventName =
  | "accepted"
  | "retrieving"
  | "generating"
  | "validating"
  | "executing"
  | "completed"
  | "clarification"
  | "failed"
  | "canceled";
interface AiRequest {
  id: string;
  userId: string;
  conversationId: string;
  scope: string;
  question: string;
  authorization: string;
  events: { id: string; event: AiEventName; data: string }[];
  started: boolean;
  done: boolean;
  canceled: boolean;
  result?: unknown;
  listeners: Set<() => void>;
}
const aiRequests = new Map<string, AiRequest>(),
  conversations = new Map<string, string>();
const aiAuthorization = () =>
  JSON.stringify([
    store.user().status,
    store.user().owner,
    store.user().memberships,
  ]);
function aiEvent(r: AiRequest, event: AiEventName, data: unknown) {
  r.events.push({
    id: String(r.events.length + 1),
    event,
    data: JSON.stringify(data),
  });
  for (const listener of r.listeners) listener();
}
function executeAi(r: AiRequest) {
  if (r.started) return;
  r.started = true;
  const events = [
    "accepted",
    "retrieving",
    "generating",
    "validating",
    "executing",
    "completed",
  ] as const;
  events.forEach((event, i) =>
    setTimeout(() => {
      if (r.done || r.canceled) return;
      try {
        assert(
          store.persona === r.userId && r.authorization === aiAuthorization(),
          "실행 세션이 변경되었습니다.",
          403,
          "SCOPE_DENIED",
        );
        assert(
          can(store.activeUser(), r.scope, "ai:read") &&
            can(store.user(), r.scope, "sales:read"),
          "AI·매출 조회 권한이 없습니다.",
          403,
          "SCOPE_DENIED",
        );
        if (i === 0)
          aiEvent(r, event, {
            asOf: AS_OF,
            snapshotVersion: "mock-v1",
            requestId: r.id,
          });
        else if (event === "completed") {
          if (store.scenario === "ai-failure")
            throw new DomainError(
              503,
              "ENGINE_UNAVAILABLE",
              "AI 엔진 연결 실패를 재현했습니다.",
            );
          if (/전화|개인정보|주민/.test(r.question))
            throw new DomainError(
              403,
              "PII_DENIED",
              "개인정보 조회는 지원하지 않습니다.",
            );
          if (!/매출/.test(r.question)) {
            r.done = true;
            aiEvent(r, "clarification", {
              status: "NEEDS_CLARIFICATION",
              clarificationOptions: [
                { id: "last-month", label: "지난달 지점별 매출을 보여줘" },
              ],
            });
            return;
          }
          if (!/지난달/.test(r.question)) {
            r.done = true;
            aiEvent(r, "completed", {
              status: "UNSUPPORTED",
              unsupportedReason:
                "이번 버전에서는 지난달 지점별 매출 조회를 지원합니다.",
            });
            return;
          }
          const named = store.db.branches.filter((b) =>
            r.question.includes(b.name),
          );
          named.forEach((b) =>
            assert(
              can(store.user(), b.id, "ai:read") &&
                can(store.user(), b.id, "sales:read") &&
                (r.scope === "all" || r.scope === b.id),
              "질문에 지정한 지점은 현재 조회 범위에서 허용되지 않습니다.",
              403,
              "SCOPE_DENIED",
            ),
          );
          const rows = sales(
            store,
            r.scope,
            "2026-09-01",
            "2026-10-01",
            "processed",
          ).filter(
            (row) => !named.length || named.some((b) => b.id === row.branchId),
          );
          r.result = {
            id: r.id,
            status: "READY",
            asOf: AS_OF,
            start: "2026-09-01",
            end: "2026-10-01",
            currency: "KRW",
            timeZone: "Asia/Seoul",
            refundBasis: "processed",
            viewSpec: {
              component:
                store.scenario === "ai-view-fallback"
                  ? "unsupported-visual"
                  : "bar",
              title: "지난달 지점별 매출",
            },
            rows: store.scenario === "empty" ? [] : rows,
          };
          r.done = true;
          aiEvent(r, event, { executionId: r.id, status: "READY" });
        } else aiEvent(r, event, { requestId: r.id });
      } catch (e) {
        r.done = true;
        aiEvent(r, "failed", {
          code: e instanceof DomainError ? e.code : "ENGINE_ERROR",
          message: e instanceof Error ? e.message : "AI 오류",
        });
      }
    }, i * 450),
  );
}

export const handlers = [
  ...invitationHandlers,
  ...organizationHandlers,
  ...productHandlers,
  ...customerHandlers,
  ...paymentHandlers,
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
  sse<{ workspace: string; heartbeat: string; connected: string }>(
    "/api/workspace/events",
    ({ request, client, finalize }) => {
      try {
        const user = store.activeUser(),
          s = new URL(request.url).searchParams.get("scope") || "all";
        assert(can(user, s), "접근 권한 없음", 403);
        const visible = (e: WorkspaceEvent) =>
          store.persona === user.id &&
          (e.branchId === "all" ||
            (can(store.user(), e.branchId) &&
              (s === "all" || s === e.branchId)));
        const listener = (e: WorkspaceEvent) => {
          if (store.scenario !== "disconnect" && visible(e))
            client.send({
              id: e.id,
              event: "workspace",
              data: JSON.stringify(e),
            });
        };
        const last = Number(
          request.headers.get("Last-Event-ID") ||
            new URL(request.url).searchParams.get("cursor") ||
            0,
        );
        if (last)
          store.events.filter((e) => Number(e.id) > last).forEach(listener);
        store.listeners.add(listener);
        const timer = setInterval(() => {
          if (
            store.persona !== user.id ||
            !can(store.user(), s) ||
            store.scenario === "disconnect"
          )
            client.error();
          else client.send({ event: "heartbeat", data: "{}" });
        }, 2500);
        finalize(() => {
          store.listeners.delete(listener);
          clearInterval(timer);
        });
        client.send({ event: "connected", data: "{}" });
      } catch {
        client.close();
      }
    },
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
  http.post(
    "/api/conversations",
    response(() => {
      const id = crypto.randomUUID();
      conversations.set(id, store.user().id);
      return { id };
    }),
  ),
  http.post(
    "/api/conversations/:id/requests",
    response(async (a) => {
      const p = await json(a);
      assert(
        conversations.get(String(a.params.id)) === store.user().id,
        "본인의 AI 대화만 사용할 수 있습니다.",
        403,
        "SCOPE_DENIED",
      );
      assert(
        store.scenario !== "ai-unavailable",
        "AI 엔진이 준비되지 않았습니다.",
        503,
        "ENGINE_NOT_READY",
      );
      const s = String(p.scope || "all");
      assert(
        can(store.user(), s, "ai:read") && can(store.user(), s, "sales:read"),
        "AI 조회 권한이 없습니다.",
        403,
        "SCOPE_DENIED",
      );
      const id = crypto.randomUUID();
      aiRequests.set(id, {
        id,
        userId: store.user().id,
        conversationId: String(a.params.id),
        scope: s,
        question: z.string().trim().min(1).max(1000).parse(p.question),
        authorization: aiAuthorization(),
        events: [],
        started: false,
        done: false,
        canceled: false,
        listeners: new Set(),
      });
      return { requestId: id };
    }),
  ),
  sse<{
    accepted: string;
    retrieving: string;
    generating: string;
    validating: string;
    executing: string;
    completed: string;
    clarification: string;
    failed: string;
    canceled: string;
  }>("/api/requests/:id/events", ({ params, request, client, finalize }) => {
    const r = aiRequests.get(String(params.id));
    if (!r || r.userId !== store.persona) {
      client.close();
      return;
    }
    let last = Number(
      request.headers.get("Last-Event-ID") ||
        new URL(request.url).searchParams.get("cursor") ||
        0,
    );
    const flush = () => {
      for (const e of r.events.filter((e) => Number(e.id) > last)) {
        client.send(e);
        last = Number(e.id);
      }
    };
    r.listeners.add(flush);
    finalize(() => {
      r.listeners.delete(flush);
    });
    flush();
    executeAi(r);
  }),
  http.post(
    "/api/requests/:id/cancel",
    response((a) => {
      const r = aiRequests.get(String(a.params.id));
      assert(
        r && r.userId === store.user().id,
        "요청을 찾을 수 없습니다.",
        404,
        "NOT_FOUND",
      );
      if (!r.done) {
        r.canceled = true;
        r.done = true;
        aiEvent(r, "canceled", { requestId: r.id });
      }
      return { ok: true };
    }),
  ),
  http.get(
    "/api/executions/:id",
    response((a) => {
      const r = aiRequests.get(String(a.params.id));
      assert(
        r && r.userId === store.user().id,
        "결과를 찾을 수 없습니다.",
        404,
        "NOT_FOUND",
      );
      assert(
        can(store.user(), r.scope, "ai:read") &&
          can(store.user(), r.scope, "sales:read"),
        "결과 조회 권한이 회수되었습니다.",
        403,
        "SCOPE_DENIED",
      );
      assert(r.result, "결과가 아직 준비되지 않았습니다.");
      assert(
        r.authorization === aiAuthorization(),
        "실행 이후 권한이 변경되었습니다. 다시 질문해 주세요.",
        403,
        "SCOPE_DENIED",
      );
      return r.result;
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
