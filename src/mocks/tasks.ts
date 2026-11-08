/** Canonical collaboration API over the same task ledger used by demo chat/home. */
import { delay } from "msw";
import { http, HttpResponse } from "msw/http";
import { z } from "zod";
import type { components } from "../shared/api/foundation.generated";
import { admin, can } from "../shared/domain/schema";
import type { Employee, Task as TaskRow } from "../shared/domain/schema";
import { assert, DomainError, store } from "./store";

type Task = components["schemas"]["Task"];
type Event = components["schemas"]["TaskEvent"];
type Args = {
  request: Request;
  params: Record<string, string | readonly string[] | undefined>;
};
type Metadata = {
  checklist: Task["checklist"];
  events: Event[];
  completedAt: string | null;
};
const metadata = new WeakMap<TaskRow, Metadata>();
const actorView = (id: string) => {
  const actor = store.db.employees.find((e) => e.id === id);
  return actor ? { id, name: actor.name } : null;
};
function meta(row: TaskRow): Metadata {
  let value = metadata.get(row);
  if (!value) {
    value = {
      completedAt: row.collaboration
        ? row.collaboration.completedAt
        : row.status === "완료"
          ? row.updatedAt
          : null,
      checklist: row.checks.map((c, i) => ({
        id: `${row.id}-check-${i}`,
        body: c.text,
        done: c.done,
        sortOrder: i,
        updatedBy: null,
        updatedAt: row.updatedAt,
        ...row.collaboration?.checklist[i],
      })),
      events: row.collaboration?.events ?? [
        {
          id: `${row.id}-created`,
          type: "CREATED",
          actor: actorView(row.createdById || "owner"),
          before: null,
          after: { title: row.title, status: row.status },
          at: row.createdAt,
        },
      ],
    };
    metadata.set(row, value);
  }
  return value;
}
function saveMetadata(row: TaskRow) {
  const value = meta(row);
  row.collaboration = {
    completedAt: value.completedAt,
    events: value.events,
    checklist: value.checklist.map(({ body: _body, done: _done, ...item }) => {
      void _body;
      void _done;
      return item;
    }),
  };
}
const editable = (actor: Employee, row: TaskRow) =>
  can(actor, row.branchId) &&
  (admin(actor, row.branchId) ||
    row.createdById === actor.id ||
    row.assigneeId === actor.id);
const dueAt = (row: TaskRow) =>
  row.due
    ? new Date(
        row.due.length === 10 ? `${row.due}T00:00:00+09:00` : row.due,
      ).toISOString()
    : null;
const overdue = (row: TaskRow, now: string) =>
  !!row.due &&
  Date.parse(dueAt(row)!) < Date.parse(now) &&
  row.status !== "완료";
function view(actor: Employee, row: TaskRow, now = store.now()): Task {
  const value = meta(row);
  return {
    id: row.id,
    branchId: row.branchId,
    title: row.title,
    body: row.body || null,
    category: row.category,
    priority: row.priority,
    status: row.status,
    assignee: actorView(row.assigneeId) || {
      id: row.assigneeId,
      name: "탈퇴 직원",
    },
    createdBy: actorView(row.createdById || "owner") || {
      id: row.createdById || "owner",
      name: "탈퇴 직원",
    },
    dueAt: dueAt(row),
    completedAt: value.completedAt,
    overdue: overdue(row, now),
    checklist: structuredClone(value.checklist),
    checklistTotal: value.checklist.length,
    checklistDone: value.checklist.filter((c) => c.done).length,
    canEdit: editable(actor, row),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
function branches(actor: Employee, request: Request) {
  const scope = new URL(request.url).searchParams.get("scope") || "all";
  assert(
    scope === "all" ||
      store.db.branches.some((b) => b.id === scope && can(actor, b.id)),
    "지점에 접근할 수 없습니다.",
    403,
    "FORBIDDEN",
  );
  return store.db.branches
    .filter((b) => (scope === "all" || b.id === scope) && can(actor, b.id))
    .map((b) => b.id);
}
function read(args: Args, actor: Employee) {
  const allowed = branches(actor, args.request),
    row = store.db.tasks.find(
      (t) => t.id === args.params.id && allowed.includes(t.branchId),
    );
  assert(row, "업무를 찾을 수 없습니다.", 404, "NOT_FOUND");
  return row;
}
function write(args: Args, actor: Employee, version: number) {
  const row = read(args, actor);
  assert(
    editable(actor, row),
    "등록자·담당자·지점 관리자만 수정할 수 있습니다.",
    403,
    "FORBIDDEN",
  );
  if (row.version !== version || store.scenario === "conflict")
    throw new DomainError(
      409,
      "VERSION_CONFLICT",
      "최신 업무를 확인한 뒤 다시 저장해 주세요.",
      undefined,
      row.version,
      `/api/tasks/${row.id}`,
    );
  return row;
}
function eligible(employee: Employee, branchId: string) {
  return (
    employee.status === "활성" &&
    employee.memberships.some(
      (m) => m.branchId === branchId && (!m.status || m.status === "활성"),
    )
  );
}
function assignee(id: string, branchId: string) {
  assert(
    store.db.employees.some((e) => e.id === id && eligible(e, branchId)),
    "해당 지점의 활성 직원을 선택해 주세요.",
    422,
    "INVALID_ASSIGNEE",
  );
}
function event(
  row: TaskRow,
  actor: Employee,
  type: Event["type"],
  before: Event["before"],
  after: Event["after"],
) {
  const at = store.now();
  meta(row).events.push({
    id: crypto.randomUUID(),
    type,
    actor: actorView(actor.id),
    before,
    after,
    at,
  });
  row.history.push({ at, actorId: actor.id, text: type });
}
function changed(row: TaskRow) {
  row.version++;
  row.updatedAt = store.now();
  saveMetadata(row);
  store.emit("tasks", row.id, row.branchId);
}
const version = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const title = z.string().trim().min(1).max(200),
  category = z.string().trim().min(1).max(60),
  body = z.string().max(20000).nullable(),
  date = z.iso.datetime({ offset: true }).nullable();
const priority = z.enum(["낮음", "보통", "높음", "긴급"]),
  status = z.enum(["할 일", "진행 중", "완료"]),
  itemBody = z.string().trim().min(1).max(500);
const fields = {
  title,
  body: body.optional(),
  assigneeId: z.string().min(1),
  dueAt: date.optional(),
  priority: priority.optional(),
  category,
};
const createInput = z
  .object({
    branchId: z.string().min(1),
    ...fields,
    status: status.optional(),
    checklist: z.array(itemBody).max(100).optional(),
  })
  .strict();
const updateInput = z
  .object({
    version,
    title: title.optional(),
    body: body.optional(),
    assigneeId: z.string().min(1).optional(),
    dueAt: date.optional(),
    priority: priority.optional(),
    category: category.optional(),
  })
  .strict();
const statusInput = z.object({ version, status }).strict();
const addInput = z.object({ version, body: itemBody }).strict();
const checkInput = z
  .object({ version, body: itemBody.optional(), done: z.boolean().optional() })
  .strict();
async function json(request: Request): Promise<unknown> {
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
function page<T>(request: Request, rows: T[]) {
  const query = new URL(request.url).searchParams,
    current = Number(query.get("page") || 1),
    size = Number(query.get("pageSize") || 20);
  assert(
    Number.isSafeInteger(current) &&
      current > 0 &&
      Number.isInteger(size) &&
      size > 0 &&
      size <= 100,
    "페이지를 확인해 주세요.",
    422,
    "VALIDATION_FAILED",
  );
  return {
    items: rows.slice((current - 1) * size, current * size),
    meta: { page: current, pageSize: size, total: rows.length },
  };
}
function filtered(
  request: Request,
  actor: Employee,
  now: string,
  summary = false,
) {
  const query = new URL(request.url).searchParams,
    allowed = branches(actor, request);
  for (const key of ["mine", "overdue"])
    assert(
      !query.has(key) || ["true", "false"].includes(query.get(key)!),
      "필터를 확인해 주세요.",
      422,
      "VALIDATION_FAILED",
    );
  for (const key of ["dueFrom", "dueTo"])
    if (query.has(key)) z.iso.datetime({ offset: true }).parse(query.get(key));
  if (!summary && query.has("status")) status.parse(query.get("status"));
  const q = (query.get("q") || "").toLocaleLowerCase();
  return store.db.tasks.filter(
    (row) =>
      allowed.includes(row.branchId) &&
      (!q || `${row.title} ${row.body}`.toLocaleLowerCase().includes(q)) &&
      (summary || !query.has("status") || row.status === query.get("status")) &&
      (!query.has("assigneeId") ||
        row.assigneeId === query.get("assigneeId")) &&
      (query.get("mine") !== "true" || row.assigneeId === actor.id) &&
      (query.get("overdue") !== "true" || overdue(row, now)) &&
      (!query.has("dueFrom") ||
        (!!row.due &&
          Date.parse(dueAt(row)!) >= Date.parse(query.get("dueFrom")!))) &&
      (!query.has("dueTo") ||
        (!!row.due &&
          Date.parse(dueAt(row)!) < Date.parse(query.get("dueTo")!))),
  );
}
const response =
  (fn: (a: Args, actor: Employee) => unknown | Promise<unknown>, code = 200) =>
  async (a: Args) => {
    try {
      const actorId = store.activeUser().id;
      if (store.scenario === "slow") await delay(2200);
      const actor = store.activeUser();
      assert(
        actor.id === actorId,
        "계정이 변경되었습니다.",
        403,
        "AUTHORIZATION_CHANGED",
      );
      assert(
        store.scenario !== "error",
        "일시적 서버 오류입니다.",
        503,
        "SERVICE_UNAVAILABLE",
      );
      assert(
        store.scenario !== "forbidden",
        "접근 권한이 없습니다.",
        403,
        "FORBIDDEN",
      );
      if (a.request.method !== "GET")
        assert(
          a.request.headers.get("X-CSRF-Token") === "openstudy-mock-csrf",
          "CSRF 토큰을 확인해 주세요.",
          403,
          "CSRF_INVALID",
        );
      const result = await fn(a, actor);
      return HttpResponse.json(result as Record<string, unknown>, {
        status: code,
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      const failure =
        error instanceof z.ZodError
          ? new DomainError(
              422,
              "VALIDATION_FAILED",
              "입력을 확인해 주세요.",
              Object.fromEntries(
                error.issues.map((i) => [
                  i.path.join(".") || "body",
                  i.message,
                ]),
              ),
            )
          : error instanceof DomainError
            ? error
            : new DomainError(500, "MOCK_ERROR", "요청을 처리하지 못했습니다.");
      return HttpResponse.json(
        {
          code: failure.code,
          message: failure.message,
          fieldErrors: failure.fieldErrors,
          latestVersion: failure.latestVersion,
          reloadUrl: failure.reloadUrl,
          requestId: crypto.randomUUID(),
        },
        { status: failure.status },
      );
    }
  };
export const taskHandlers = [
  http.get(
    "/api/assignee-candidates",
    response((a, actor) => {
      const branch = new URL(a.request.url).searchParams.get("branchId");
      assert(
        branch &&
          store.db.branches.some((b) => b.id === branch) &&
          can(actor, branch),
        "지점에 접근할 수 없습니다.",
        403,
        "FORBIDDEN",
      );
      return {
        items: store.db.employees
          .filter((e) => eligible(e, branch))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((e) => actorView(e.id)!),
      };
    }),
  ),
  http.get(
    "/api/tasks/summary",
    response((a, actor) => {
      const asOf = store.now(),
        matching = filtered(a.request, actor, asOf, true),
        rows = store.scenario === "empty" ? [] : matching;
      const count = (items: TaskRow[]) => ({
        total: items.length,
        todo: items.filter((t) => t.status === "할 일").length,
        inProgress: items.filter((t) => t.status === "진행 중").length,
        done: items.filter((t) => t.status === "완료").length,
        overdue: items.filter((t) => overdue(t, asOf)).length,
      });
      return {
        asOf,
        totals: count(rows),
        branches: branches(actor, a.request).map((branchId) => ({
          branchId,
          ...count(rows.filter((t) => t.branchId === branchId)),
        })),
      };
    }),
  ),
  http.get(
    "/api/tasks",
    response((a, actor) => {
      const now = store.now(),
        query = new URL(a.request.url).searchParams,
        sort = query.get("sort") || "createdAt",
        direction = query.get("direction") || "desc",
        sign = direction === "asc" ? 1 : -1;
      assert(
        ["dueAt", "priority", "createdAt", "updatedAt"].includes(sort) &&
          ["asc", "desc"].includes(direction),
        "정렬 조건을 확인해 주세요.",
        422,
        "VALIDATION_FAILED",
      );
      const rows =
        store.scenario === "empty" ? [] : filtered(a.request, actor, now);
      rows.sort((a, b) => {
        if (sort === "dueAt" && (!a.due || !b.due))
          return a.due ? -1 : b.due ? 1 : a.id.localeCompare(b.id) * sign;
        const value = (row: TaskRow) =>
          sort === "priority"
            ? ["낮음", "보통", "높음", "긴급"].indexOf(row.priority)
            : sort === "dueAt"
              ? Date.parse(dueAt(row)!)
              : Date.parse(
                  sort === "createdAt" ? row.createdAt : row.updatedAt,
                );
        return (value(a) - value(b) || a.id.localeCompare(b.id)) * sign;
      });
      return page(
        a.request,
        rows.map((row) => {
          const {
            body: _body,
            checklist: _checklist,
            ...item
          } = view(actor, row, now);
          void _body;
          void _checklist;
          return item;
        }),
      );
    }),
  ),
  http.post(
    "/api/tasks",
    response(async (a, actor) => {
      const input = createInput.parse(await json(a.request)),
        allowed = branches(actor, a.request),
        key = a.request.headers.get("Idempotency-Key");
      assert(
        allowed.includes(input.branchId),
        "지점에 접근할 수 없습니다.",
        403,
        "FORBIDDEN",
      );
      assignee(input.assigneeId, input.branchId);
      assert(
        key && key.length >= 16 && key.length <= 128,
        "요청 키를 확인해 주세요.",
        422,
        "VALIDATION_FAILED",
      );
      return store.transaction(
        `tasks:create:${key}`,
        {
          path: new URL(a.request.url).pathname,
          scope: new URL(a.request.url).searchParams.get("scope") || "all",
          input,
        },
        () => {
          const row = store.add("tasks", input.branchId, {
            createdById: actor.id,
            title: input.title,
            body: input.body || "",
            assigneeId: input.assigneeId,
            due: input.dueAt || "",
            priority: input.priority || "보통",
            category: input.category,
            status: input.status || "할 일",
            checks: (input.checklist || []).map((text) => ({
              text,
              done: false,
            })),
            history: [],
          });
          meta(row).events = [];
          event(row, actor, "CREATED", null, {
            title: row.title,
            status: row.status,
          });
          saveMetadata(row);
          store.emit("tasks", row.id, row.branchId);
          return view(actor, row);
        },
      );
    }, 201),
  ),
  http.get(
    "/api/tasks/:id/events",
    response((a, actor) =>
      page(a.request, [...meta(read(a, actor)).events].reverse()),
    ),
  ),
  http.get(
    "/api/tasks/:id",
    response((a, actor) => view(actor, read(a, actor))),
  ),
  http.patch(
    "/api/tasks/:id",
    response(async (a, actor) => {
      const raw = await json(a.request);
      assert(
        !raw ||
          typeof raw !== "object" ||
          !["branchId", "status", "checklist"].some((k) => k in raw),
        "변경할 수 없는 필드입니다.",
        422,
        "IMMUTABLE_FIELD",
      );
      const input = updateInput.parse(raw),
        row = write(a, actor, input.version),
        before = view(actor, row);
      if (input.assigneeId && input.assigneeId !== row.assigneeId)
        assignee(input.assigneeId, row.branchId);
      const content: Record<string, unknown> = {},
        previous: Record<string, unknown> = {};
      for (const key of ["title", "body", "priority", "category"] as const)
        if (input[key] !== undefined && input[key] !== before[key]) {
          content[key] = input[key];
          previous[key] = before[key];
          Object.assign(row, { [key]: input[key] ?? "" });
        }
      if (Object.keys(content).length)
        event(row, actor, "CONTENT_CHANGED", previous, content);
      if (input.assigneeId && input.assigneeId !== row.assigneeId) {
        event(
          row,
          actor,
          "ASSIGNEE_CHANGED",
          { assigneeId: row.assigneeId },
          { assigneeId: input.assigneeId },
        );
        row.assigneeId = input.assigneeId;
      }
      if (input.dueAt !== undefined && input.dueAt !== before.dueAt) {
        event(
          row,
          actor,
          "DUE_CHANGED",
          { dueAt: before.dueAt },
          { dueAt: input.dueAt },
        );
        row.due = input.dueAt || "";
      }
      if (JSON.stringify(before) !== JSON.stringify(view(actor, row)))
        changed(row);
      return view(actor, row);
    }),
  ),
  http.post(
    "/api/tasks/:id/status",
    response(async (a, actor) => {
      const input = statusInput.parse(await json(a.request)),
        row = write(a, actor, input.version);
      if (input.status === row.status) return view(actor, row);
      assert(
        row.status !== "완료" || input.status === "할 일",
        "현재 상태에서는 변경할 수 없습니다.",
        409,
        "INVALID_STATE",
      );
      event(
        row,
        actor,
        "STATUS_CHANGED",
        { status: row.status },
        { status: input.status },
      );
      row.status = input.status;
      meta(row).completedAt = input.status === "완료" ? store.now() : null;
      changed(row);
      return view(actor, row);
    }),
  ),
  http.post(
    "/api/tasks/:id/checklist-items",
    response(async (a, actor) => {
      const input = addInput.parse(await json(a.request)),
        row = write(a, actor, input.version),
        value = meta(row);
      assert(
        value.checklist.length < 100,
        "체크 항목은 100개까지 등록할 수 있습니다.",
        422,
        "VALIDATION_FAILED",
      );
      const item = {
        id: crypto.randomUUID(),
        body: input.body,
        done: false,
        sortOrder: Math.max(-1, ...value.checklist.map((c) => c.sortOrder)) + 1,
        updatedBy: actorView(actor.id),
        updatedAt: store.now(),
      };
      value.checklist.push(item);
      row.checks.push({ text: item.body, done: item.done });
      event(row, actor, "CHECKLIST_ADDED", null, { ...item });
      changed(row);
      return view(actor, row);
    }, 201),
  ),
  http.patch(
    "/api/tasks/:id/checklist-items/:itemId",
    response(async (a, actor) => {
      const input = checkInput.parse(await json(a.request)),
        row = write(a, actor, input.version),
        value = meta(row),
        index = value.checklist.findIndex((c) => c.id === a.params.itemId);
      assert(index >= 0, "체크 항목을 찾을 수 없습니다.", 404, "NOT_FOUND");
      const item = value.checklist[index],
        before = { ...item };
      if (input.body !== undefined) item.body = input.body;
      if (input.done !== undefined) item.done = input.done;
      if (item.body !== before.body || item.done !== before.done) {
        item.updatedBy = actorView(actor.id);
        item.updatedAt = store.now();
        row.checks[index] = { text: item.body, done: item.done };
        event(row, actor, "CHECKLIST_CHANGED", before, { ...item });
        changed(row);
      }
      return view(actor, row);
    }),
  ),
  http.delete(
    "/api/tasks/:id/checklist-items/:itemId",
    response((a, actor) => {
      const inputVersion = version.parse(
          Number(new URL(a.request.url).searchParams.get("version")),
        ),
        row = write(a, actor, inputVersion),
        value = meta(row),
        index = value.checklist.findIndex((c) => c.id === a.params.itemId);
      assert(index >= 0, "체크 항목을 찾을 수 없습니다.", 404, "NOT_FOUND");
      const [item] = value.checklist.splice(index, 1);
      row.checks.splice(index, 1);
      event(row, actor, "CHECKLIST_REMOVED", { ...item }, null);
      changed(row);
      return view(actor, row);
    }),
  ),
];
export { view as taskView };
