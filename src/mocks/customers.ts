/** Canonical M4 customer fixtures. The legacy member rows remain shared with demo payments and seats. */
import { delay } from "msw";
import { http, HttpResponse } from "msw/http";
import { z } from "zod";
import type { components } from "../shared/api/foundation.generated";
import type { Employee, ResourceMap } from "../shared/domain/schema";
import { assert, DomainError, store } from "./store";

type Customer = components["schemas"]["Customer"];
type CustomerItem = components["schemas"]["CustomerListItem"];
type Row = ResourceMap["members"];
type Args = {
  request: Request;
  params: Record<string, string | readonly string[] | undefined>;
};
const statuses = z.enum(["정상", "이용 제한", "비활성"]);
const name = z.string().trim().min(1).max(100);
const phone = z
  .string()
  .transform((value) => value.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^[0-9]{9,11}$/));
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => value || null);
const email = optionalText(254).refine(
  (value) => !value || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value),
  "올바른 이메일을 입력해 주세요.",
);
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const createInput = z
  .object({
    registeredBranchId: z.string().min(1),
    name,
    phone,
    email,
    memo: optionalText(1000),
  })
  .strict();
const updateInput = z
  .object({
    version,
    name: name.optional(),
    phone: phone.optional(),
    email,
    memo: optionalText(1000),
  })
  .strict();
const statusInput = z
  .object({
    version,
    status: statuses,
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

// Reset creates a new events array. Transaction rollback only replaces db, so it must not erase accepted request keys.
const creations = new WeakMap<
  typeof store.events,
  Map<string, { fingerprint: string; result: Customer }>
>();
const registration = (row: Row) =>
  row.registeredBranchId !== undefined
    ? row.registeredBranchId
    : row.branchId === "all"
      ? null
      : row.branchId;
const number = (row: Row) => row.memberNo ?? `DEMO-${row.id}`;
const readable = (actor: Employee, branch: string) =>
  store.db.branches.some((b) => b.id === branch) &&
  (actor.owner ||
    actor.memberships.some(
      (m) => m.branchId === branch && (!m.status || m.status === "활성"),
    ));
const writable = (actor: Employee, branch: string) =>
  readable(actor, branch) &&
  (actor.owner ||
    actor.memberships.some(
      (m) =>
        m.branchId === branch &&
        (!m.status || m.status === "활성") &&
        m.permissions.includes("members:write"),
    ));
function selected(actor: Employee, request: Request) {
  const scope = new URL(request.url).searchParams.get("scope") || "all";
  if (scope === "all")
    return {
      scope,
      branches: store.db.branches
        .filter((b) => readable(actor, b.id))
        .map((b) => b.id),
    };
  assert(
    /^[^/\s]+$/.test(scope),
    "올바른 지점 범위를 입력해 주세요.",
    422,
    "VALIDATION_FAILED",
  );
  assert(
    readable(actor, scope),
    "지점에 접근할 권한이 없습니다.",
    403,
    "FORBIDDEN",
  );
  return { scope, branches: [scope] };
}
function related(row: Row) {
  return [
    ...new Set(
      [
        registration(row),
        ...store.db.payments
          .filter((p) => p.memberId === row.id)
          .map((p) => p.branchId),
      ].filter((id): id is string => !!id),
    ),
  ];
}
function visible(
  actor: Employee,
  row: Row,
  selection: ReturnType<typeof selected>,
) {
  return (
    related(row).some((id) => selection.branches.includes(id)) ||
    (registration(row) === null && actor.owner && selection.scope === "all")
  );
}
function editable(actor: Employee, row: Row) {
  return actor.owner || related(row).some((id) => writable(actor, id));
}
function customer(actor: Employee, request: Request, id: string) {
  const scope = selected(actor, request),
    row = store.db.members.find((m) => m.id === id);
  assert(
    row && visible(actor, row, scope),
    "고객을 찾을 수 없습니다.",
    404,
    "NOT_FOUND",
  );
  return row;
}
function item(row: Row): CustomerItem {
  return {
    id: row.id,
    memberNo: number(row),
    name: row.name,
    phone: row.phone.replace(/[\s-]/g, ""),
    status: row.status,
    registeredBranchId: registration(row),
    registeredAt: row.registeredAt ?? row.createdAt,
  };
}
function detail(actor: Employee, row: Row): Customer {
  return {
    ...item(row),
    version: row.version,
    email: row.email || null,
    memo: row.note || null,
    statusReason: row.statusReason ?? null,
    updatedAt: row.updatedAt,
    canEdit: editable(actor, row),
  };
}
function requireVersion(row: Row, expected: number) {
  if (row.version !== expected)
    throw new DomainError(
      409,
      "VERSION_CONFLICT",
      "다른 사용자가 수정했습니다. 최신 내용을 확인해 주세요.",
      undefined,
      row.version,
      `/api/customers/${row.id}`,
    );
}
function changed(row: Row, actor: Employee, action: string, fields: string[]) {
  store.add("audit", registration(row) ?? "all", {
    actorId: actor.id,
    resource: "customers",
    targetId: row.id,
    action,
    before: "",
    after: JSON.stringify({ changedFields: fields }),
  });
  const branch = registration(row);
  if (branch) store.emit("customers", row.id, branch, "changed");
}
function errorResponse(error: unknown) {
  const failure =
    error instanceof z.ZodError
      ? new DomainError(
          422,
          "VALIDATION_FAILED",
          "입력을 확인해 주세요.",
          Object.fromEntries(
            error.issues.flatMap((issue) =>
              issue.code === "unrecognized_keys"
                ? issue.keys.map((key) => [key, "허용되지 않은 필드입니다."])
                : [[issue.path.join(".") || "body", issue.message]],
            ),
          ),
        )
      : error instanceof DomainError
        ? error
        : new DomainError(500, "MOCK_ERROR", "요청을 처리하지 못했습니다.");
  return HttpResponse.json(
    {
      code: failure.code,
      message: failure.message,
      ...(failure.fieldErrors ? { fieldErrors: failure.fieldErrors } : {}),
      ...(failure.latestVersion !== undefined
        ? { latestVersion: failure.latestVersion, reloadUrl: failure.reloadUrl }
        : {}),
      requestId: crypto.randomUUID(),
    },
    { status: failure.status, headers: { "Cache-Control": "no-store" } },
  );
}
function currentActor(expectedId: string) {
  const actor = store.activeUser();
  assert(
    actor.id === expectedId,
    "계정이 변경되어 요청을 계속할 수 없습니다.",
    403,
    "AUTHORIZATION_CHANGED",
  );
  return actor;
}
const response =
  (
    task: (a: Args, actor: Employee) => unknown | Promise<unknown>,
    status = 200,
  ) =>
  async (a: Args) => {
    try {
      const actorId = store.activeUser().id;
      if (store.scenario === "slow") await delay(2200);
      const actor = currentActor(actorId);
      if (store.scenario === "error")
        throw new DomainError(
          503,
          "SERVICE_UNAVAILABLE",
          "시험 중인 일시적 서버 오류입니다.",
        );
      if (store.scenario === "forbidden")
        throw new DomainError(
          403,
          "FORBIDDEN",
          "이 요청에 대한 접근이 제한되었습니다.",
        );
      if (!["GET", "HEAD"].includes(a.request.method))
        assert(
          a.request.headers.get("X-CSRF-Token") === "openstudy-mock-csrf",
          "CSRF 토큰을 확인해 주세요.",
          403,
          "CSRF_INVALID",
        );
      return HttpResponse.json(
        (await task(a, actor)) as Record<string, unknown>,
        {
          status,
          headers: { "Cache-Control": "no-store" },
        },
      );
    } catch (error) {
      return errorResponse(error);
    }
  };

export const customerHandlers = [
  http.get(
    "/api/customers",
    response(({ request }, actor) => {
      const scope = selected(actor, request),
        params = new URL(request.url).searchParams;
      const page = Number(params.get("page") ?? 1),
        pageSize = Number(params.get("pageSize") ?? 20),
        q = (params.get("q") ?? "").trim(),
        sort = params.get("sort") ?? "registeredAt",
        direction = params.get("direction") ?? "desc",
        status = params.get("status");
      assert(
        Number.isSafeInteger(page) && page > 0,
        "페이지를 확인해 주세요.",
        422,
        "VALIDATION_FAILED",
      );
      assert(
        Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 100,
        "페이지 크기는 1~100이어야 합니다.",
        422,
        "VALIDATION_FAILED",
      );
      assert(
        q.length <= 100 &&
          ["registeredAt", "name"].includes(sort) &&
          ["asc", "desc"].includes(direction),
        "검색·정렬 조건을 확인해 주세요.",
        422,
        "VALIDATION_FAILED",
      );
      if (status !== null) statuses.parse(status);
      const digits = q.replace(/[\s-]/g, ""),
        phoneQuery = /^[0-9]{4,}$/.test(digits) ? digits : null;
      const rows = (store.scenario === "empty" ? [] : store.db.members).filter(
        (row) =>
          visible(actor, row, scope) &&
          (!status || row.status === status) &&
          (!q ||
            row.name.toLocaleLowerCase().includes(q.toLocaleLowerCase()) ||
            number(row).toLocaleLowerCase() === q.toLocaleLowerCase() ||
            (phoneQuery !== null &&
              row.phone.replace(/[\s-]/g, "").includes(phoneQuery))),
      );
      const ordered = rows.map(item).sort((a, b) => {
        const comparison =
          (sort === "name"
            ? a.name.localeCompare(b.name)
            : a.registeredAt.localeCompare(b.registeredAt)) ||
          a.id.localeCompare(b.id);
        return direction === "asc" ? comparison : -comparison;
      });
      return {
        items: ordered.slice((page - 1) * pageSize, page * pageSize),
        meta: { page, pageSize, total: ordered.length },
      };
    }),
  ),
  http.get(
    "/api/customers/:id",
    response(({ request, params }, actor) =>
      detail(actor, customer(actor, request, String(params.id))),
    ),
  ),
  http.post(
    "/api/customers",
    response(async ({ request }, principal) => {
      const input = createInput.parse(await request.json()),
        actor = currentActor(principal.id);
      selected(actor, request);
      assert(
        writable(actor, input.registeredBranchId),
        "고객을 등록할 권한이 없습니다.",
        403,
        "FORBIDDEN",
      );
      const key = request.headers.get("Idempotency-Key") ?? "";
      assert(
        key.length >= 16 && key.length <= 128,
        "16~128자 멱등 키가 필요합니다.",
        422,
        "VALIDATION_FAILED",
      );
      let requests = creations.get(store.events);
      if (!requests) {
        requests = new Map();
        creations.set(store.events, requests);
      }
      const requestKey = `${actor.id}:${input.registeredBranchId}:${key}`,
        fingerprint = JSON.stringify(input),
        prior = requests.get(requestKey);
      if (prior) {
        assert(
          prior.fingerprint === fingerprint,
          "같은 키로 다른 입력을 저장할 수 없습니다.",
          409,
          "IDEMPOTENCY_CONFLICT",
        );
        return structuredClone(prior.result);
      }
      return store.transaction(undefined, input, () => {
        assert(
          store.db.branches.find((b) => b.id === input.registeredBranchId)
            ?.status === "운영 중",
          "운영 중지된 지점에는 고객을 등록할 수 없습니다.",
          409,
          "BRANCH_NOT_ACTIVE",
        );
        const row = store.add("members", input.registeredBranchId, {
          name: input.name,
          phone: input.phone,
          email: input.email ?? "",
          note: input.memo ?? "",
          status: "정상",
          branchIds: [input.registeredBranchId],
          registeredBranchId: input.registeredBranchId,
          memberNo: `M-${crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`,
          registeredAt: store.now(),
          statusReason: null,
          statusEvents: [],
        });
        changed(row, actor, "CREATED", ["memberNo", "status"]);
        const result = detail(actor, row);
        requests.set(requestKey, {
          fingerprint,
          result: structuredClone(result),
        });
        return result;
      });
    }, 201),
  ),
  http.patch(
    "/api/customers/:id",
    response(async ({ request, params }, principal) => {
      const raw: unknown = await request.json();
      const actor = currentActor(principal.id);
      if (
        raw &&
        typeof raw === "object" &&
        ["memberNo", "registeredBranchId", "status", "statusReason"].some(
          (key) => Object.hasOwn(raw, key),
        )
      )
        throw new DomainError(
          422,
          "IMMUTABLE_FIELD",
          "회원번호·등록 지점·상태는 이 요청으로 바꿀 수 없습니다.",
        );
      const parsed = updateInput.parse(raw),
        keys = Object.keys(raw as object);
      assert(
        keys.length >= 2,
        "변경할 항목이 필요합니다.",
        422,
        "VALIDATION_FAILED",
      );
      const row = customer(actor, request, String(params.id));
      assert(
        editable(actor, row),
        "고객을 수정할 권한이 없습니다.",
        403,
        "FORBIDDEN",
      );
      requireVersion(row, parsed.version);
      const update = {
        name: parsed.name ?? row.name,
        phone: parsed.phone ?? row.phone,
        email: keys.includes("email") ? (parsed.email ?? "") : row.email,
        note: keys.includes("memo") ? (parsed.memo ?? "") : row.note,
      };
      const fields = Object.entries(update)
        .filter(([key, value]) => row[key as keyof Row] !== value)
        .map(([key]) => (key === "note" ? "memo" : key));
      if (!fields.length) return detail(actor, row);
      Object.assign(row, update, {
        version: row.version + 1,
        updatedAt: store.now(),
      });
      changed(row, actor, "UPDATED", fields);
      return detail(actor, row);
    }),
  ),
  http.post(
    "/api/customers/:id/status",
    response(async ({ request, params }, principal) => {
      const input = statusInput.parse(await request.json()),
        actor = currentActor(principal.id),
        row = customer(actor, request, String(params.id));
      assert(
        editable(actor, row),
        "고객 상태를 변경할 권한이 없습니다.",
        403,
        "FORBIDDEN",
      );
      requireVersion(row, input.version);
      if (row.status === input.status) return detail(actor, row);
      const previous = row.status,
        at = store.now();
      row.statusEvents ??= [];
      row.statusEvents.push({
        at,
        actorId: actor.id,
        before: previous,
        after: input.status,
        reason: input.reason,
      });
      Object.assign(row, {
        status: input.status,
        statusReason: input.reason,
        updatedAt: at,
        version: row.version + 1,
      });
      changed(row, actor, "STATUS_CHANGED", ["status"]);
      return detail(actor, row);
    }),
  ),
  http.delete(
    "/api/customers/:id",
    response(() => {
      throw new DomainError(
        405,
        "METHOD_NOT_ALLOWED",
        "고객을 삭제할 수 없습니다. 상태를 변경해 주세요.",
      );
    }),
  ),
];
