/** F03 contract fixtures only; these do not represent SMTP or server authorization evidence. */
import { http, HttpResponse } from "msw/http";
import { z } from "zod";
import type { components } from "../shared/api/foundation.generated";
import { permissions } from "../shared/domain/schema";
import { assert, DomainError, store } from "./store";
type Invitation = components["schemas"]["Invitation"];
let database = store.db;
let rows: Invitation[] = [];
const links = new Map<string, string>();
const modeKey = "openstudy-mock-approval-mode";
let approvalOnly = false;
try {
  approvalOnly = sessionStorage.getItem(modeKey) === "limited";
} catch {
  /* restricted storage */
}
export function resetInvitations() {
  rows = [];
  links.clear();
  database = store.db;
  setInvitationSessionMode(false);
}
/** Test/mail-double hook: secrets stay in memory, never in admin DTOs or browser storage. */
export function invitationMailLink(id: string) {
  const token = crypto.randomUUID();
  links.set(token, id);
  return token;
}
function sync() {
  if (database !== store.db) resetInvitations();
}
function manager(branchId: string, role?: string) {
  const user = store.activeUser();
  assert(
    user.owner ||
      user.memberships.some(
        (m) =>
          m.branchId === branchId &&
          m.role === "admin" &&
          (!m.status || m.status === "활성") &&
          m.permissions.includes("people:manage"),
      ),
    "초대 관리 권한이 없습니다.",
    403,
    "SCOPE_DENIED",
  );
  assert(
    role !== "admin" || user.owner,
    "지점 관리자 초대는 사장님만 처리할 수 있습니다.",
    403,
    "SCOPE_DENIED",
  );
}
function expire(i: Invitation) {
  if (
    i.status === "초대 대기" &&
    Date.parse(i.expiresAt) <= Date.parse(store.now())
  )
    i.status = "만료";
  return i;
}
function preview(token: string) {
  const i = rows.find((i) => i.id === links.get(token));
  assert(
    i && expire(i).status === "초대 대기",
    "만료·재발급·취소된 초대 링크입니다.",
    410,
    "INVITATION_EXPIRED",
  );
  return i;
}
function invalidate(id: string) {
  for (const [token, target] of links) if (target === id) links.delete(token);
}
const grants = z.array(z.enum(permissions));
const input = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z.email(),
    branchId: z.string().min(1),
    role: z.enum(["admin", "staff"]),
    permissions: grants,
    presetId: z.string().optional(),
  })
  .strict();
function wrap(
  fn: (a: {
    request: Request;
    params: Record<string, string | readonly string[] | undefined>;
  }) => unknown | Promise<unknown>,
) {
  return async (a: Parameters<typeof fn>[0]) => {
    try {
      sync();
      if (a.request.method !== "GET")
        assert(
          a.request.headers.get("X-CSRF-Token") === "openstudy-mock-csrf",
          "인증 요청을 다시 시도해 주세요.",
          403,
          "CSRF_INVALID",
        );
      return HttpResponse.json((await fn(a)) as never, {
        headers: {
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      });
    } catch (e) {
      const d =
        e instanceof DomainError
          ? e
          : new DomainError(
              e instanceof z.ZodError ? 422 : 500,
              "VALIDATION_ERROR",
              e instanceof z.ZodError
                ? "입력 내용을 확인해 주세요."
                : "요청 처리 실패",
            );
      return HttpResponse.json(
        { code: d.code, message: d.message, requestId: crypto.randomUUID() },
        { status: d.status },
      );
    }
  };
}
export const invitationHandlers = [
  http.post(
    "/api/invitations/preview",
    wrap(async ({ request }) => {
      const { token } = z
        .object({ token: z.string() })
        .strict()
        .parse(await request.json());
      const i = preview(token);
      return {
        name: i.name,
        email: i.email,
        branch: {
          id: i.branchId,
          name: store.get("branches", i.branchId).name,
        },
        role: i.role,
        expiresAt: i.expiresAt,
        acceptanceMode: store.db.employees.some((e) => e.email === i.email)
          ? "EXISTING_ACCOUNT"
          : "NEW_ACCOUNT",
      } satisfies components["schemas"]["InvitationPreview"];
    }),
  ),
  http.post(
    "/api/invitations/accept",
    wrap(async ({ request }) => {
      const p = z
        .discriminatedUnion("mode", [
          z
            .object({
              mode: z.literal("NEW_ACCOUNT"),
              token: z.string(),
              email: z.email(),
              password: z
                .string()
                .min(8)
                .refine((s) => new TextEncoder().encode(s).length <= 72),
            })
            .strict(),
          z
            .object({
              mode: z.literal("EXISTING_ACCOUNT"),
              token: z.string(),
              email: z.email(),
            })
            .strict(),
        ])
        .parse(await request.json());
      const i = preview(p.token);
      assert(
        p.email === i.email,
        "초대 계정이 일치하지 않습니다.",
        403,
        "INVITATION_IDENTITY_MISMATCH",
      );
      let e = store.db.employees.find((e) => e.email === i.email);
      if (e) {
        assert(
          p.mode === "EXISTING_ACCOUNT" &&
            store.persona === e.id &&
            e.status === "활성",
          "기존 계정으로 로그인해 주세요.",
          403,
          "INVITATION_IDENTITY_MISMATCH",
        );
      } else {
        assert(
          p.mode === "NEW_ACCOUNT",
          "신규 계정 비밀번호가 필요합니다.",
          422,
        );
        e = store.add("employees", i.branchId, {
          name: i.name,
          nickname: i.name,
          email: i.email,
          avatar: "",
          owner: false,
          status: "승인 대기",
          memberships: [],
        });
      }
      i.employeeId = e.id;
      i.status = "승인 대기";
      i.version++;
      invalidate(i.id);
      store.persist();
      return {
        invitationId: i.id,
        status: "승인 대기",
        nextAction:
          p.mode === "NEW_ACCOUNT"
            ? "LOGIN_FOR_APPROVAL_STATUS"
            : "REFRESH_APPROVAL_STATUS",
      } satisfies components["schemas"]["AcceptanceResult"];
    }),
  ),
  http.get(
    "/api/invitations/approval-status",
    wrap(() => {
      const user = store.user();
      return {
        accountStatus: user.status === "승인 대기" ? "승인 대기" : "활성",
        requiresLogin: approvalOnly && user.status === "활성",
        invitations: rows
          .filter(
            (i) =>
              i.employeeId === user.id &&
              ["승인 대기", "활성", "거절", "취소"].includes(i.status),
          )
          .map((i) => ({
            invitationId: i.id,
            branchId: i.branchId,
            branchName: store.get("branches", i.branchId).name,
            status: i.status as components["schemas"]["ApprovalItem"]["status"],
            rejectionReason: i.rejectionReason,
            updatedAt: i.updatedAt,
          })),
      };
    }),
  ),
  http.get(
    "/api/invitations",
    wrap(({ request }) => {
      const user = store.activeUser(),
        q = new URL(request.url).searchParams,
        s = q.get("scope") || "all";
      if (s !== "all") manager(s);
      const found = rows
        .map(expire)
        .filter(
          (i) =>
            (s === "all" || i.branchId === s) &&
            (user.owner ||
              user.memberships.some(
                (m) =>
                  m.branchId === i.branchId &&
                  m.role === "admin" &&
                  m.permissions.includes("people:manage"),
              )) &&
            (!q.get("status") || i.status === q.get("status")) &&
            `${i.name} ${i.email}`
              .toLowerCase()
              .includes((q.get("q") || "").toLowerCase()),
        );
      const page = Number(q.get("page") || 1),
        pageSize = Number(q.get("pageSize") || 20);
      return {
        items: found.slice((page - 1) * pageSize, page * pageSize),
        meta: { page, pageSize, total: found.length },
      };
    }),
  ),
  http.post(
    "/api/invitations",
    wrap(async ({ request }) => {
      const p = input.parse(await request.json());
      manager(p.branchId, p.role);
      assert(
        store.get("branches", p.branchId).status === "운영 중",
        "운영 중지 지점입니다.",
      );
      assert(
        p.role === "admin" || !p.permissions.includes("people:manage"),
        "직원에게 관리자 전용 권한을 줄 수 없습니다.",
        403,
      );
      assert(
        !rows.some(
          (i) =>
            i.email === p.email &&
            i.branchId === p.branchId &&
            ["초대 대기", "승인 대기"].includes(expire(i).status),
        ),
        "진행 중인 초대가 있습니다.",
      );
      assert(
        !store.db.employees.some(
          (e) =>
            e.email === p.email &&
            e.memberships.some(
              (m) => m.branchId === p.branchId && m.status !== "회수",
            ),
        ),
        "이미 유효 소속이 있습니다.",
      );
      const at = store.now();
      const i: Invitation = {
        id: crypto.randomUUID(),
        version: 1,
        createdAt: at,
        updatedAt: at,
        ...p,
        status: "초대 대기",
        delivery: "발송 대기",
        expiresAt: new Date(Date.parse(at) + 86400000).toISOString(),
        employeeId: null,
        rejectionReason: null,
      };
      rows.push(i);
      store.emit("invitations", i.id, i.branchId);
      return i;
    }),
  ),
  http.get(
    "/api/invitations/:id",
    wrap(({ params }) => {
      const i = rows.find((i) => i.id === params.id);
      assert(i, "초대 없음", 404);
      manager(i.branchId);
      return expire(i);
    }),
  ),
  http.post(
    "/api/invitations/:id/:action",
    wrap(async ({ request, params }) => {
      const i = rows.find((i) => i.id === params.id);
      assert(i, "초대 없음", 404);
      manager(i.branchId, i.role);
      expire(i);
      const p = z
        .object({
          version: z.number().int().positive(),
          reason: z.string().trim().min(1).max(1000).optional(),
        })
        .strict()
        .parse(await request.json());
      assert(
        i.version === p.version,
        "다른 사용자가 초대를 변경했습니다. 최신 버전을 확인해 주세요.",
        409,
        "VERSION_CONFLICT",
      );
      const action = String(params.action);
      if (action === "reissue") {
        assert(
          ["초대 대기", "만료"].includes(i.status),
          "수락 전 초대만 재발급할 수 있습니다.",
        );
        assert(
          !rows.some(
            (x) =>
              x.id !== i.id &&
              x.email === i.email &&
              x.branchId === i.branchId &&
              ["초대 대기", "승인 대기"].includes(expire(x).status),
          ),
          "다른 진행 초대가 있습니다.",
        );
        invalidate(i.id);
        i.status = "초대 대기";
        i.expiresAt = new Date(
          Date.parse(store.now()) + 86400000,
        ).toISOString();
        i.delivery = "발송 대기";
      } else if (action === "cancel") {
        assert(i.status === "초대 대기", "수락 전 초대만 취소할 수 있습니다.");
        i.status = "취소";
        invalidate(i.id);
      } else if (action === "reject") {
        assert(
          i.status === "승인 대기" && p.reason,
          "승인 대기 초대와 반려 사유가 필요합니다.",
        );
        i.status = "거절";
        i.rejectionReason = p.reason;
      } else if (action === "approve") {
        assert(
          i.status === "승인 대기" || i.status === "활성",
          "승인 대기 초대만 승인할 수 있습니다.",
        );
        const employee = store.get("employees", i.employeeId!);
        assert(
          employee.status === "승인 대기" || employee.status === "활성",
          "계정 제한은 사장님이 별도로 해제해야 합니다.",
          403,
        );
        const prior = employee.memberships.find(
          (m) => m.branchId === i.branchId,
        );
        assert(
          store.user().owner || !prior || prior.role !== "admin",
          "관리자 복구는 사장님 전용입니다.",
          403,
        );
        const membership = {
          branchId: i.branchId,
          role: i.role,
          permissions: [...i.permissions],
          status: "활성" as const,
          version: (prior?.version || 0) + 1,
        };
        if (prior) Object.assign(prior, membership);
        else employee.memberships.push(membership);
        employee.status = "활성";
        i.status = "활성";
        store.emit("employees", employee.id, i.branchId, "permissions");
      } else assert(false, "지원하지 않는 명령", 422);
      i.version++;
      i.updatedAt = store.now();
      store.emit("invitations", i.id, i.branchId);
      return i;
    }),
  ),
];
export function setInvitationSessionMode(limited: boolean) {
  approvalOnly = limited;
  try {
    sessionStorage.setItem(modeKey, limited ? "limited" : "workspace");
  } catch {
    /* restricted storage */
  }
}
export function invitationSessionMode() {
  return approvalOnly;
}
