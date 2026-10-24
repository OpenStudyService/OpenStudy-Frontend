/** Contract fixtures for F02. These checks exercise the UI; real server authorization remains B03/B05/B06. */
import { http, HttpResponse } from "msw/http";
import { z } from "zod";
import { permissions } from "../shared/domain/schema";
import type {
  ResourceMap,
  Employee as LegacyEmployee,
  Membership as LegacyMembership,
} from "../shared/domain/schema";
import type {
  Branch,
  Employee,
  Membership,
  Preset,
} from "../features/organization/model";
import {
  canManageBranch,
  canManageMembership,
  defaultHours,
  hoursError,
} from "../features/organization/model";
import { assert, DomainError, store } from "./store";

type LegacyBranch = ResourceMap["branches"];
const definitions = permissions.map((code) => ({
  code,
  description: {
    "members:write": "회원 정보 변경",
    "operations:write": "운영 설정 변경",
    "payments:read": "결제 조회",
    "payments:write": "결제 및 환불",
    "sales:read": "매출 조회",
    "facilities:write": "시설 관리",
    "notices:write": "공지 관리",
    "people:manage": "직원 및 권한 관리",
    "ai:read": "AI 조회",
  }[code],
  adminOnly: code === "people:manage",
}));
const grants = z
  .array(z.enum(permissions))
  .refine((p) => new Set(p).size === p.length);
const version = z.number().int().positive();
const weeklyHours = z
  .array(
    z
      .object({
        weekday: z.number().int().min(1).max(7),
        isClosed: z.boolean(),
        opensMinute: z.number().int().nullable(),
        closesMinute: z.number().int().nullable(),
      })
      .strict(),
  )
  .superRefine((value, ctx) => {
    const message = hoursError(value);
    if (message) ctx.addIssue({ code: "custom", message });
  });
const branchInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    address: z.string().trim().min(1).max(300),
    phone: z.string().trim().max(30),
    weeklyHours,
    status: z.enum(["운영 중", "운영 중지"]),
  })
  .strict();
let database = store.db;
let presets: Preset[] = [];
function initialPresets() {
  if (database !== store.db || presets.length === 0) {
    database = store.db;
    presets = (
      [
        ["system-staff", "일반 직원 기본", "staff", []],
        ["system-manager", "지점 관리자 기본", "admin", [...permissions]],
      ] as const
    ).map(([id, name, role, permissions]) => ({
      id,
      name,
      role,
      permissions: [...permissions],
      version: 1,
      system: true,
      createdAt: store.now(),
      updatedAt: store.now(),
    }));
  }
  return presets;
}
export function organizationBranch(row: LegacyBranch): Branch {
  const extended = row as LegacyBranch &
    Partial<Pick<Branch, "code" | "weeklyHours">>;
  return {
    ...row,
    code: extended.code || `MOCK-${row.id}`,
    weeklyHours: structuredClone(extended.weeklyHours || defaultHours()),
  };
}
export function organizationEmployee(row: LegacyEmployee): Employee {
  return {
    ...row,
    memberships: row.memberships.map((m) => ({
      ...m,
      status: (m as Membership).status || "활성",
      version: (m as Membership).version || 1,
    })),
  };
}
function visible(employee: Employee, scope: string) {
  const actor = store.activeUser();
  return {
    ...employee,
    memberships: employee.memberships.filter(
      (m) =>
        (scope === "all" || m.branchId === scope) &&
        (actor.owner || canManageBranch(actor, m.branchId, "people:manage")),
    ),
  };
}
function assertScope(
  request: Request,
  branchId?: string,
  permission?: "operations:write" | "people:manage",
) {
  const actor = store.activeUser(),
    scope = new URL(request.url).searchParams.get("scope") || "all";
  if (scope !== "all")
    assert(
      actor.owner ||
        actor.memberships.some(
          (m) => m.branchId === scope && (!m.status || m.status === "활성"),
        ),
      "지점 접근 권한이 없습니다.",
      403,
      "SCOPE_DENIED",
    );
  if (branchId) {
    assert(
      scope === "all" || scope === branchId,
      "선택한 지점 범위와 다릅니다.",
      403,
      "SCOPE_DENIED",
    );
    assert(
      permission
        ? canManageBranch(actor, branchId, permission)
        : actor.owner ||
            actor.memberships.some(
              (m) =>
                m.branchId === branchId && (!m.status || m.status === "활성"),
            ),
      "지점 접근 권한이 없습니다.",
      403,
      "SCOPE_DENIED",
    );
  }
  return scope;
}
function assertPeople(request: Request) {
  const scope = assertScope(request),
    actor = store.activeUser();
  assert(
    actor.owner ||
      actor.memberships.some(
        (m) =>
          (scope === "all" || m.branchId === scope) &&
          canManageBranch(actor, m.branchId, "people:manage"),
      ),
    "직원 관리 권한이 없습니다.",
    403,
    "SCOPE_DENIED",
  );
  return scope;
}
function paginate<
  T extends {
    id: string;
    name: string;
    createdAt: string;
    status?: string;
    email?: string;
    code?: string;
  },
>(request: Request, values: T[]) {
  const url = new URL(request.url),
    page = Number(url.searchParams.get("page") || 1),
    pageSize = Number(url.searchParams.get("pageSize") || 20),
    q = (url.searchParams.get("q") || "").toLocaleLowerCase(),
    status = url.searchParams.get("status"),
    sort = url.searchParams.get("sort") === "name" ? "name" : "createdAt",
    direction = url.searchParams.get("direction") === "asc" ? 1 : -1;
  assert(
    Number.isInteger(page) &&
      page > 0 &&
      Number.isInteger(pageSize) &&
      pageSize > 0 &&
      pageSize <= 100,
    "페이지 범위를 확인해 주세요.",
    422,
    "VALIDATION_FAILED",
  );
  const items = values
    .filter(
      (v) =>
        (!q ||
          [v.name, v.email, v.code].some((s) =>
            s?.toLocaleLowerCase().includes(q),
          )) &&
        (!status || v.status === status),
    )
    .sort(
      (a, b) =>
        direction *
        (a[sort].localeCompare(b[sort]) || a.id.localeCompare(b.id)),
    );
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    meta: { page, pageSize, total: items.length },
  };
}
type Args = {
  request: Request;
  params: Record<string, string | readonly string[] | undefined>;
};
const response =
  (fn: (args: Args) => unknown | Promise<unknown>) => async (args: Args) => {
    try {
      store.activeUser();
      initialPresets();
      if (store.scenario === "error")
        throw new DomainError(
          503,
          "SERVICE_UNAVAILABLE",
          "시험 중인 일시적 서버 오류입니다.",
        );
      if (store.scenario === "forbidden")
        throw new DomainError(
          403,
          "SCOPE_DENIED",
          "이 요청에 대한 접근이 제한되었습니다.",
        );
      if (args.request.method !== "GET")
        assert(
          args.request.headers.get("X-CSRF-Token") === "openstudy-mock-csrf",
          "CSRF 토큰을 확인해 주세요.",
          403,
          "CSRF_INVALID",
        );
      const result = await fn(args);
      return HttpResponse.json(result as Record<string, unknown>, {
        status:
          args.request.method === "POST" &&
          ["/api/branches", "/api/permission-presets"].includes(
            new URL(args.request.url).pathname,
          )
            ? 201
            : 200,
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      const detail =
        error instanceof z.ZodError
          ? {
              status: 422,
              code: "VALIDATION_FAILED",
              message: "입력을 확인해 주세요.",
              fieldErrors: Object.fromEntries(
                error.issues.map((i) => [i.path.join("."), i.message]),
              ),
            }
          : error instanceof DomainError
            ? error
            : {
                status: 500,
                code: "MOCK_ERROR",
                message: (error as Error).message,
              };
      return HttpResponse.json(
        {
          code: detail.code,
          message: detail.message,
          ...("fieldErrors" in detail
            ? { fieldErrors: detail.fieldErrors }
            : {}),
          requestId: crypto.randomUUID(),
        },
        { status: detail.status },
      );
    }
  };
function checkVersion(actual: number, expected: number) {
  assert(
    actual === expected,
    "다른 사용자가 수정했습니다. 최신 내용을 확인해 주세요.",
    409,
    "VERSION_CONFLICT",
  );
}
function changed(
  row: LegacyBranch | LegacyEmployee,
  resource: "branches" | "employees",
) {
  row.version += 1;
  row.updatedAt = store.now();
  store.emit(
    resource,
    row.id,
    resource === "employees" ? "all" : row.id,
    resource === "employees" ? "permissions" : "changed",
  );
}
function validateGrants(role: string, permissions: string[]) {
  assert(
    role !== "staff" || !permissions.includes("people:manage"),
    "직원 관리 권한은 관리자 전용입니다.",
    422,
    "VALIDATION_FAILED",
  );
}

export const organizationHandlers = [
  http.get(
    "/api/branches",
    response(({ request }) => {
      const scope = assertScope(request),
        actor = store.activeUser();
      return paginate(
        request,
        store.scenario === "empty"
          ? []
          : store.db.branches
              .filter(
                (b) =>
                  (scope === "all" || b.id === scope) &&
                  (actor.owner ||
                    actor.memberships.some(
                      (m) =>
                        m.branchId === b.id &&
                        (!m.status || m.status === "활성"),
                    )),
              )
              .map(organizationBranch),
      );
    }),
  ),
  http.get(
    "/api/branches/:id",
    response(({ request, params }) => {
      const row = store.get("branches", String(params.id));
      assertScope(request, row.id);
      return organizationBranch(row);
    }),
  ),
  http.post(
    "/api/branches",
    response(async ({ request }) => {
      assert(
        store.activeUser().owner,
        "지점 등록은 사장님만 가능합니다.",
        403,
        "SCOPE_DENIED",
      );
      const body = branchInput.parse(await request.json());
      const key = request.headers.get("Idempotency-Key");
      assert(key, "멱등 키가 필요합니다.", 422, "VALIDATION_FAILED");
      return store.transaction(key, body, () => {
        const { weeklyHours, ...values } = body;
        const row = store.add("branches", "all", {
          ...values,
          hours: "요일별 운영시간",
        });
        row.branchId = row.id;
        Object.assign(row, { weeklyHours });
        store.emit("branches", row.id, row.id);
        return organizationBranch(row);
      });
    }),
  ),
  http.patch(
    "/api/branches/:id",
    response(async ({ request, params }) => {
      const row = store.get("branches", String(params.id));
      assertScope(request, row.id, "operations:write");
      const body = branchInput
        .omit({ status: true })
        .partial()
        .extend({ version })
        .strict()
        .parse(await request.json());
      checkVersion(row.version, body.version);
      const fields = Object.fromEntries(
        Object.entries(body).filter(([key]) => key !== "version"),
      );
      Object.assign(row, fields);
      if (body.weeklyHours)
        row.hours = body.weeklyHours
          .map(
            (h) =>
              `${h.weekday}요일 ${h.isClosed ? "휴무" : `${h.opensMinute}~${h.closesMinute}분`}`,
          )
          .join(" / ");
      changed(row, "branches");
      return organizationBranch(row);
    }),
  ),
  http.post(
    "/api/branches/:id/status",
    response(async ({ request, params }) => {
      const row = store.get("branches", String(params.id));
      assertScope(request, row.id, "operations:write");
      const body = z
        .object({ version, status: z.enum(["운영 중", "운영 중지"]) })
        .strict()
        .parse(await request.json());
      checkVersion(row.version, body.version);
      row.status = body.status;
      changed(row, "branches");
      return organizationBranch(row);
    }),
  ),
  http.get(
    "/api/employees",
    response(({ request }) => {
      const scope = assertPeople(request),
        actor = store.activeUser();
      return paginate(
        request,
        store.scenario === "empty"
          ? []
          : store.db.employees
              .map(organizationEmployee)
              .map((e) => visible(e, scope))
              .filter(
                (e) =>
                  (actor.owner && scope === "all") || e.memberships.length > 0,
              ),
      );
    }),
  ),
  http.get(
    "/api/employees/:id",
    response(({ request, params }) => {
      const scope = assertPeople(request),
        row = visible(
          organizationEmployee(store.get("employees", String(params.id))),
          scope,
        );
      assert(
        (store.user().owner && scope === "all") || row.memberships.length,
        "직원 조회 범위를 벗어났습니다.",
        403,
        "SCOPE_DENIED",
      );
      return row;
    }),
  ),
  http.patch(
    "/api/employees/:id",
    response(async ({ request, params }) => {
      assert(
        store.activeUser().owner,
        "계정 전체 변경은 사장님만 가능합니다.",
        403,
        "SCOPE_DENIED",
      );
      const row = store.get("employees", String(params.id)),
        body = z
          .object({
            version,
            name: z.string().trim().min(1).max(100).optional(),
            status: z.enum(["활성", "이용 제한", "비활성"]).optional(),
          })
          .strict()
          .parse(await request.json());
      checkVersion(row.version, body.version);
      assert(
        row.status !== "승인 대기" || body.status === undefined,
        "최종 승인 절차가 필요합니다.",
        409,
        "APPROVAL_REQUIRED",
      );
      assert(
        !row.owner ||
          !body.status ||
          body.status === "활성" ||
          store.db.employees.some(
            (e) => e.id !== row.id && e.owner && e.status === "활성",
          ),
        "마지막 활성 사장님은 제한할 수 없습니다.",
        409,
        "LAST_OWNER",
      );
      const fields = Object.fromEntries(
        Object.entries(body).filter(([key]) => key !== "version"),
      );
      Object.assign(row, fields);
      changed(row, "employees");
      return organizationEmployee(row);
    }),
  ),
  http.put(
    "/api/employees/:employeeId/memberships/:branchId",
    response(async ({ request, params }) => {
      const row = store.get("employees", String(params.employeeId)),
        branchId = String(params.branchId);
      assertScope(request, branchId, "people:manage");
      const current = organizationEmployee(row).memberships.find(
        (m) => m.branchId === branchId,
      );
      assert(
        current,
        "기존 소속이 없습니다. 초대를 진행해 주세요.",
        409,
        "INVITATION_REQUIRED",
      );
      assert(
        canManageMembership(
          store.activeUser(),
          organizationEmployee(row),
          current,
        ),
        "이 직원의 소속은 수정할 수 없습니다.",
        403,
        "SCOPE_DENIED",
      );
      const body = z
        .object({
          version,
          employeeVersion: version,
          role: z.enum(["admin", "staff"]),
          status: z.enum(["활성", "회수"]),
          permissions: grants,
          presetId: z.string().optional(),
        })
        .strict()
        .parse(await request.json());
      assert(
        store.user().owner || body.role === "staff",
        "관리자 임명은 사장님만 가능합니다.",
        403,
        "SCOPE_DENIED",
      );
      checkVersion(row.version, body.employeeVersion);
      checkVersion(current.version, body.version);
      validateGrants(body.role, body.permissions);
      if (body.presetId)
        assert(
          presets.some((p) => p.id === body.presetId && p.role === body.role),
          "프리셋 역할이 다릅니다.",
          422,
          "VALIDATION_FAILED",
        );
      const updated: Membership = {
        branchId,
        role: body.role,
        status: body.status,
        permissions: [...body.permissions],
        version: current.version + 1,
      };
      row.memberships = row.memberships.map((m) =>
        m.branchId === branchId ? (updated as LegacyMembership) : m,
      );
      changed(row, "employees");
      return { employeeVersion: row.version, membership: updated };
    }),
  ),
  http.get(
    "/api/permissions",
    response(({ request }) => {
      assertPeople(request);
      return definitions;
    }),
  ),
  http.get(
    "/api/permission-presets",
    response(({ request }) => {
      assertPeople(request);
      return paginate(request, presets);
    }),
  ),
  http.post(
    "/api/permission-presets",
    response(async ({ request }) => {
      assert(
        store.activeUser().owner,
        "프리셋 관리는 사장님만 가능합니다.",
        403,
        "SCOPE_DENIED",
      );
      const body = z
        .object({
          name: z.string().trim().min(1).max(100),
          role: z.enum(["admin", "staff"]),
          permissions: grants,
        })
        .strict()
        .parse(await request.json());
      validateGrants(body.role, body.permissions);
      const preset: Preset = {
        ...body,
        id: crypto.randomUUID(),
        version: 1,
        system: false,
        createdAt: store.now(),
        updatedAt: store.now(),
      };
      presets.push(preset);
      return preset;
    }),
  ),
  http.patch(
    "/api/permission-presets/:id",
    response(async ({ request, params }) => {
      assert(
        store.activeUser().owner,
        "프리셋 관리는 사장님만 가능합니다.",
        403,
        "SCOPE_DENIED",
      );
      const row = presets.find((p) => p.id === params.id);
      assert(row, "프리셋이 없습니다.", 404, "NOT_FOUND");
      assert(
        !row.system,
        "시스템 프리셋은 수정할 수 없습니다.",
        403,
        "SCOPE_DENIED",
      );
      const body = z
        .object({
          version,
          name: z.string().trim().min(1).max(100),
          permissions: grants,
        })
        .strict()
        .parse(await request.json());
      checkVersion(row.version, body.version);
      validateGrants(row.role, body.permissions);
      Object.assign(row, body, {
        version: row.version + 1,
        updatedAt: store.now(),
      });
      return row;
    }),
  ),
];
