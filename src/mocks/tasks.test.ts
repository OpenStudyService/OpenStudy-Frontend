import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { taskHandlers } from "./tasks";
import { MockStore, store } from "./store";
import type { components } from "../shared/api/foundation.generated";
type Task = components["schemas"]["Task"];
const server = setupServer(...taskHandlers);
beforeAll(() => server.listen());
beforeEach(() => {
  store.reset();
  store.persona = "owner";
  store.scenario = "normal";
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
function request(path: string, method = "GET", body?: object, key?: string) {
  return fetch(new URL(`/api${path}`, window.location.origin), {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": "openstudy-mock-csrf",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
const input = {
  branchId: "gangnam",
  title: "신규 업무",
  category: "운영",
  assigneeId: "junho",
};
async function create(extra = {}) {
  const response = await request(
    "/tasks",
    "POST",
    { ...input, ...extra },
    crypto.randomUUID(),
  );
  expect(response.status).toBe(201);
  return response.json() as Promise<Task>;
}
async function detail(id: string) {
  return (await request(`/tasks/${id}`)).json() as Promise<Task>;
}
async function events(id: string) {
  return (await request(`/tasks/${id}/events`)).json() as Promise<
    components["schemas"]["TaskEventPage"]
  >;
}

it("creates once on concurrent replay, preserves canonical data in the shared ledger, and rejects key/body reuse", async () => {
  const key = crypto.randomUUID(),
    body = {
      ...input,
      priority: "긴급",
      body: null,
      dueAt: "2026-11-01T17:30:00+09:00",
      checklist: ["현장 확인"],
    },
    count = store.db.tasks.length;
  const responses = await Promise.all([
    request("/tasks", "POST", body, key),
    request("/tasks", "POST", body, key),
  ]);
  expect(responses.map((r) => r.status)).toEqual([201, 201]);
  const [a, b] = await Promise.all(responses.map((r) => r.json()));
  expect(a).toEqual(b);
  expect(store.db.tasks).toHaveLength(count + 1);
  expect(a).toMatchObject({
    priority: "긴급",
    body: null,
    createdBy: { id: "owner" },
    assignee: { id: "junho" },
    checklistTotal: 1,
    dueAt: "2026-11-01T08:30:00.000Z",
  });
  expect(store.get("tasks", a.id)).toMatchObject({
    title: body.title,
    assigneeId: "junho",
    checks: [{ text: "현장 확인", done: false }],
  });
  expect((await events(a.id)).items.map((e) => e.type)).toEqual(["CREATED"]);
  expect(
    (await request("/tasks", "POST", { ...body, title: "다른 업무" }, key))
      .status,
  ).toBe(409);
  expect((await request("/tasks", "POST", input)).status).toBe(422);
  expect(
    (
      await request(
        "/tasks",
        "POST",
        { ...input, createdById: "minji" },
        crypto.randomUUID(),
      )
    ).status,
  ).toBe(422);
});

it("requires real active membership for every assignee, including OWNER", async () => {
  for (const assigneeId of ["doyun", "unknown"])
    expect(
      (
        await request(
          "/tasks",
          "POST",
          { ...input, assigneeId },
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(422);
  store.get("employees", "owner").memberships = [];
  expect(
    (
      await request(
        "/tasks",
        "POST",
        { ...input, assigneeId: "owner" },
        crypto.randomUUID(),
      )
    ).status,
  ).toBe(422);
  store.get("employees", "junho").memberships[0].status = "회수";
  store.get("employees", "minji").status = "비활성";
  const candidates = await (
    await request("/assignee-candidates?branchId=gangnam")
  ).json();
  expect(candidates.items).toEqual([]);
});

it("rechecks creator, assignee and branch manager rights and hides revoked branch resources", async () => {
  store.persona = "junho";
  const task = await create({ assigneeId: "owner" });
  expect(task.canEdit).toBe(true);
  store.persona = "minji";
  store.get("employees", "minji").memberships[0].permissions = [];
  expect((await detail(task.id)).canEdit).toBe(true);
  expect(
    (
      await request(`/tasks/${task.id}`, "PATCH", {
        version: 1,
        title: "관리자 수정",
      })
    ).status,
  ).toBe(200);
  store.get("employees", "minji").memberships[0].role = "staff";
  expect((await detail(task.id)).canEdit).toBe(false);
  expect(
    (await request(`/tasks/${task.id}`, "PATCH", { version: 2, title: "금지" }))
      .status,
  ).toBe(403);
  store.persona = "junho";
  store.get("employees", "junho").memberships[0].status = "회수";
  expect((await request(`/tasks/${task.id}`)).status).toBe(404);
  expect((await request(`/tasks/${task.id}/events`)).status).toBe(404);
  expect(
    (
      await request(`/tasks/${task.id}/status`, "POST", {
        version: 2,
        status: "완료",
      })
    ).status,
  ).toBe(404);
});

it("rejects immutable fields and stale versions and emits one event per changed field group", async () => {
  const task = await create();
  for (const extra of [
    { branchId: "seongsu" },
    { status: "완료" },
    { checklist: [] },
  ]) {
    const r = await request(`/tasks/${task.id}`, "PATCH", {
      version: task.version,
      ...extra,
    });
    expect(r.status).toBe(422);
    expect((await r.json()).code).toBe("IMMUTABLE_FIELD");
  }
  const result = await request(`/tasks/${task.id}`, "PATCH", {
    version: task.version,
    title: "제목 변경",
    body: "내용",
    category: "점검",
    assigneeId: "minji",
    dueAt: "2026-10-18T12:00:00Z",
  });
  expect(result.status).toBe(200);
  const next = await result.json();
  expect(next.version).toBe(task.version + 1);
  expect((await events(task.id)).items.map((e) => e.type)).toEqual([
    "DUE_CHANGED",
    "ASSIGNEE_CHANGED",
    "CONTENT_CHANGED",
    "CREATED",
  ]);
  const stale = await request(`/tasks/${task.id}`, "PATCH", {
    version: task.version,
    title: "이전 버전",
  });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({
    code: "VERSION_CONFLICT",
    latestVersion: next.version,
    reloadUrl: `/api/tasks/${task.id}`,
  });
  expect((await detail(task.id)).title).toBe("제목 변경");
});

it("permits unrelated edits when an existing assignee becomes inactive but rejects reassignment to them", async () => {
  const task = await create();
  store.get("employees", "junho").status = "비활성";
  expect(
    (
      await request(`/tasks/${task.id}`, "PATCH", {
        version: 1,
        title: "담당자 유지",
        assigneeId: "junho",
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await request(`/tasks/${task.id}`, "PATCH", {
        version: 2,
        assigneeId: "minji",
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await request(`/tasks/${task.id}`, "PATCH", {
        version: 3,
        assigneeId: "junho",
      })
    ).status,
  ).toBe(422);
});

it("applies concurrent status writes once, preserves no-op history, and validates reopen transitions", async () => {
  const task = await create(),
    path = `/tasks/${task.id}/status`,
    body = { version: task.version, status: "완료" };
  const result = await Promise.all([
    request(path, "POST", body),
    request(path, "POST", body),
  ]);
  expect(result.map((r) => r.status).sort()).toEqual([200, 409]);
  const done = await detail(task.id);
  expect(done.completedAt).not.toBeNull();
  expect(done.version).toBe(2);
  expect(
    (await request(path, "POST", { version: 2, status: "완료" })).status,
  ).toBe(200);
  expect((await events(task.id)).items.map((e) => e.type)).toEqual([
    "STATUS_CHANGED",
    "CREATED",
  ]);
  expect(
    (await request(path, "POST", { version: 2, status: "진행 중" })).status,
  ).toBe(409);
  expect(
    (await request(path, "POST", { version: 2, status: "할 일" })).status,
  ).toBe(200);
  expect((await detail(task.id)).completedAt).toBeNull();
});

it("uses parent versions for concurrent checklist create/update/delete with stable item IDs", async () => {
  const task = await create({ checklist: ["원래 항목"] }),
    path = `/tasks/${task.id}/checklist-items`;
  const adds = await Promise.all([
    request(path, "POST", { version: 1, body: "추가" }),
    request(path, "POST", { version: 1, body: "추가" }),
  ]);
  expect(adds.map((r) => r.status).sort()).toEqual([201, 409]);
  let current = await detail(task.id);
  expect(current.checklist).toHaveLength(2);
  const id = current.checklist[1].id;
  const edits = await Promise.all([
    request(`${path}/${id}`, "PATCH", { version: 2, done: true }),
    request(`${path}/${id}`, "PATCH", { version: 2, done: true }),
  ]);
  expect(edits.map((r) => r.status).sort()).toEqual([200, 409]);
  current = await detail(task.id);
  expect(current.checklistDone).toBe(1);
  expect(current.checklist[1].updatedBy?.id).toBe("owner");
  expect((await request(`${path}/${id}?version=3`, "DELETE")).status).toBe(200);
  expect((await request(`${path}/${id}?version=3`, "DELETE")).status).toBe(409);
  expect((await request(`${path}/${id}?version=4`, "DELETE")).status).toBe(404);
  expect((await detail(task.id)).checklist[0].id).toBe(task.checklist[0].id);
  expect((await events(task.id)).items.map((e) => e.type)).toEqual([
    "CHECKLIST_REMOVED",
    "CHECKLIST_CHANGED",
    "CHECKLIST_ADDED",
    "CREATED",
  ]);
  expect(store.get("tasks", task.id).checks).toEqual([
    { text: "원래 항목", done: false },
  ]);
});

it("enforces checklist limits and task-scoped item paths", async () => {
  const a = await create({
      checklist: Array.from({ length: 100 }, (_, i) => `항목 ${i}`),
    }),
    b = await create({ checklist: ["다른 업무"] });
  expect(
    (
      await request(`/tasks/${a.id}/checklist-items`, "POST", {
        version: 1,
        body: "101번째",
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await request(
        `/tasks/${a.id}/checklist-items/${b.checklist[0].id}`,
        "PATCH",
        {
          version: 1,
          done: true,
        },
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await request(
        `/tasks/${a.id}/checklist-items/${a.checklist[0].id}`,
        "PATCH",
        {
          version: 1,
          done: "true",
        },
      )
    ).status,
  ).toBe(422);
  expect((await detail(a.id)).version).toBe(1);
});

it("intersects scope for lists, details and mutations without leaking totals or event history", async () => {
  store.persona = "junho";
  const list = await (await request("/tasks?scope=all&pageSize=1")).json();
  expect(list.meta).toMatchObject({ page: 1, pageSize: 1, total: 3 });
  expect(list.items).toHaveLength(1);
  expect(list.items.every((t: Task) => t.branchId === "gangnam")).toBe(true);
  expect((await request("/tasks?scope=seongsu")).status).toBe(403);
  expect((await request("/tasks/task-3")).status).toBe(404);
  expect((await request("/tasks/task-3/events")).status).toBe(404);
  store.persona = "owner";
  expect((await request("/tasks/task-3?scope=gangnam")).status).toBe(404);
  expect(
    (
      await request(
        "/tasks?scope=gangnam",
        "POST",
        { ...input, branchId: "seongsu", assigneeId: "doyun" },
        crypto.randomUUID(),
      )
    ).status,
  ).toBe(403);
});

it("shares date/text/mine/overdue filters and summary counts with the list, with null due dates sorted last", async () => {
  store.db.tasks = [];
  store.persona = "junho";
  await create({ title: "경계 시작", dueAt: "2026-10-16T00:00:00Z" });
  await create({
    title: "경계 끝",
    dueAt: "2026-10-18T00:00:00Z",
    status: "완료",
  });
  await create({ title: "기한 없음", assigneeId: "minji" });
  const range = await (
    await request(
      "/tasks?dueFrom=2026-10-16T00%3A00%3A00Z&dueTo=2026-10-18T00%3A00%3A00Z",
    )
  ).json();
  expect(range.meta.total).toBe(1);
  expect(range.items[0].title).toBe("경계 시작");
  expect((await (await request("/tasks?mine=true")).json()).meta.total).toBe(2);
  expect((await (await request("/tasks?q=경계")).json()).meta.total).toBe(2);
  for (const direction of ["asc", "desc"]) {
    const list = await (
      await request(`/tasks?sort=dueAt&direction=${direction}`)
    ).json();
    expect(list.items.at(-1).title).toBe("기한 없음");
  }
  const summary = await (await request("/tasks/summary?mine=true")).json();
  for (const [key, status] of [
    ["todo", "할 일"],
    ["inProgress", "진행 중"],
    ["done", "완료"],
  ])
    expect(summary.totals[key]).toBe(
      (
        await (
          await request(`/tasks?mine=true&status=${encodeURIComponent(status)}`)
        ).json()
      ).meta.total,
    );
  expect(summary.totals.overdue).toBe(
    (await (await request("/tasks?mine=true&overdue=true")).json()).meta.total,
  );
  expect(
    summary.branches.reduce(
      (sum: number, b: { total: number }) => sum + b.total,
      0,
    ),
  ).toBe(summary.totals.total);
});

it("rejects invalid pagination, filters, malformed JSON and absent CSRF without mutating", async () => {
  for (const query of [
    "page=0",
    "pageSize=101",
    "mine=yes",
    "dueFrom=not-a-date",
    "status=deleted",
    "sort=body",
    "direction=up",
  ])
    expect((await request(`/tasks?${query}`)).status).toBe(422);
  expect(
    (
      await fetch(new URL("/api/tasks", window.location.origin), {
        method: "POST",
        headers: { "X-CSRF-Token": "openstudy-mock-csrf" },
        body: "{",
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await fetch(new URL("/api/tasks", window.location.origin), {
        method: "POST",
        body: JSON.stringify(input),
      })
    ).status,
  ).toBe(403);
  expect(store.db.tasks).toHaveLength(4);
});

it("allows collaboration writes at stopped branches and completion on creation", async () => {
  store.get("branches", "gangnam").status = "운영 중지";
  const task = await create({ status: "완료" });
  expect(task.completedAt).toBe(task.createdAt);
  expect(
    (
      await request(`/tasks/${task.id}`, "PATCH", {
        version: 1,
        title: "중지 지점 업무",
      })
    ).status,
  ).toBe(200);
});

it("retains checklist IDs, edit metadata and complete event history after a full demo store reload", async () => {
  const task = await create({ checklist: ["처음 항목"] });
  await request(
    `/tasks/${task.id}/checklist-items/${task.checklist[0].id}`,
    "PATCH",
    { version: 1, done: true },
  );
  await request(`/tasks/${task.id}/status`, "POST", {
    version: 2,
    status: "완료",
  });
  const before = await detail(task.id),
    history = await events(task.id);
  store.persist();
  const restored = new MockStore(true);
  store.db = restored.db;
  expect(await detail(task.id)).toEqual(before);
  expect(await events(task.id)).toEqual(history);
});
