import { api, ApiError, queryString } from "../../shared/api/client";
import type { components } from "../../shared/api/foundation.generated";

type Schemas = components["schemas"];
export type Task = Schemas["Task"];
export type TaskListItem = Schemas["TaskListItem"];
export type TaskEvent = Schemas["TaskEvent"];
export type TaskCreate = Schemas["TaskCreate"];
export type TaskUpdate = Schemas["TaskUpdate"];
export type TaskStatusChange = Schemas["TaskStatusChange"];
export type TaskChecklistItemCreate = Schemas["TaskChecklistItemCreate"];
export type TaskChecklistItemUpdate = Schemas["TaskChecklistItemUpdate"];
export type TaskSummary = Schemas["TaskSummary"];
export type AssigneeCandidate = Schemas["ActorSummary"];

const taskPath = (id: string) => `/tasks/${encodeURIComponent(id)}`;
const itemPath = (id: string, itemId: string) =>
  `${taskPath(id)}/checklist-items/${encodeURIComponent(itemId)}`;
const filters = (scope: string, search: string, summary = false) => {
  const source = new URLSearchParams(search),
    result = new URLSearchParams();
  result.set("scope", scope);
  const keys = [
    "q",
    "assigneeId",
    "mine",
    "dueFrom",
    "dueTo",
    "overdue",
    ...(summary ? [] : ["status", "sort", "direction", "page", "pageSize"]),
  ];
  for (const key of keys) {
    const value = source.get(key);
    if (value)
      result.set(key, key === "mine" && value === "1" ? "true" : value);
  }
  return result.toString();
};
const scoped = (path: string, scope: string) =>
  `${path}?${queryString({ scope })}`;
const actor = (v: unknown): boolean =>
  !!v &&
  typeof v === "object" &&
  "id" in v &&
  typeof v.id === "string" &&
  "name" in v &&
  typeof v.name === "string";
const count = (v: unknown): v is number =>
  Number.isSafeInteger(v) && (v as number) >= 0;
function invalidResponse(): never {
  throw new ApiError(0, {
    code: "INVALID_RESPONSE",
    message: "업무 응답을 확인하지 못했습니다. 다시 조회해 주세요.",
  });
}
function validListItem(value: TaskListItem): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    typeof value.branchId === "string" &&
    typeof value.title === "string" &&
    typeof value.category === "string" &&
    typeof value.priority === "string" &&
    typeof value.status === "string" &&
    actor(value.assignee) &&
    actor(value.createdBy) &&
    (value.dueAt === null || typeof value.dueAt === "string") &&
    (value.completedAt === null || typeof value.completedAt === "string") &&
    typeof value.canEdit === "boolean" &&
    typeof value.overdue === "boolean" &&
    count(value.version) &&
    count(value.checklistTotal) &&
    count(value.checklistDone) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}
// Successful writes and detail reads must contain a complete task and version.
function requireTask(value: Task): Task {
  if (
    !validListItem(value) ||
    !(value.body === null || typeof value.body === "string") ||
    !Array.isArray(value.checklist) ||
    !value.checklist.every(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.body === "string" &&
        typeof item.done === "boolean" &&
        count(item.sortOrder) &&
        typeof item.updatedAt === "string" &&
        (item.updatedBy === null || actor(item.updatedBy)),
    )
  )
    invalidResponse();
  return value;
}
function requirePage(value: Schemas["TaskPage"]): Schemas["TaskPage"] {
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray(value.items) ||
    !value.items.every(validListItem) ||
    !value.meta ||
    !count(value.meta.page) ||
    value.meta.page < 1 ||
    !count(value.meta.pageSize) ||
    value.meta.pageSize < 1 ||
    !count(value.meta.total)
  )
    invalidResponse();
  return value;
}
function validCounts(value: Schemas["TaskCounts"]): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    count(value.total) &&
    count(value.todo) &&
    count(value.inProgress) &&
    count(value.done) &&
    count(value.overdue)
  );
}
function requireSummary(value: TaskSummary): TaskSummary {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.asOf !== "string" ||
    !validCounts(value.totals) ||
    !Array.isArray(value.branches) ||
    !value.branches.every(
      (branch) => validCounts(branch) && typeof branch.branchId === "string",
    )
  )
    invalidResponse();
  return value;
}
export const taskApi = {
  list(scope: string, search: string, signal: AbortSignal) {
    return api<Schemas["TaskPage"]>(`/tasks?${filters(scope, search)}`, {
      signal,
    }).then(requirePage);
  },
  summary(scope: string, search: string, signal: AbortSignal) {
    return api<TaskSummary>(`/tasks/summary?${filters(scope, search, true)}`, {
      signal,
    }).then(requireSummary);
  },
  detail(scope: string, id: string, signal: AbortSignal) {
    return api<Task>(scoped(taskPath(id), scope), { signal }).then(requireTask);
  },
  events(
    scope: string,
    id: string,
    signal: AbortSignal,
    page = 1,
    pageSize = 20,
  ) {
    return api<Schemas["TaskEventPage"]>(
      `${taskPath(id)}/events?${queryString({ scope, page, pageSize })}`,
      { signal },
    );
  },
  async assignees(branch: string, signal: AbortSignal) {
    const data = await api<Schemas["AssigneeCandidateList"]>(
      `/assignee-candidates?${queryString({ branchId: branch })}`,
      { signal },
    );
    return data.items;
  },
  create(body: TaskCreate, signal: AbortSignal, key: string, scope: string) {
    return api<Task>(scoped("/tasks", scope), {
      method: "POST",
      body,
      signal,
      key,
    }).then(requireTask);
  },
  update(id: string, body: TaskUpdate, signal: AbortSignal, scope: string) {
    return api<Task>(scoped(taskPath(id), scope), {
      method: "PATCH",
      body,
      signal,
    }).then(requireTask);
  },
  status(
    scope: string,
    id: string,
    body: TaskStatusChange,
    signal: AbortSignal,
  ) {
    return api<Task>(scoped(`${taskPath(id)}/status`, scope), {
      method: "POST",
      body,
      signal,
    }).then(requireTask);
  },
  addChecklist(
    scope: string,
    id: string,
    body: TaskChecklistItemCreate,
    signal: AbortSignal,
  ) {
    return api<Task>(scoped(`${taskPath(id)}/checklist-items`, scope), {
      method: "POST",
      body,
      signal,
    }).then(requireTask);
  },
  updateChecklist(
    scope: string,
    id: string,
    itemId: string,
    body: TaskChecklistItemUpdate,
    signal: AbortSignal,
  ) {
    return api<Task>(scoped(itemPath(id, itemId), scope), {
      method: "PATCH",
      body,
      signal,
    }).then(requireTask);
  },
  deleteChecklist(
    scope: string,
    id: string,
    itemId: string,
    version: number,
    signal: AbortSignal,
  ) {
    return api<Task>(
      `${itemPath(id, itemId)}?${queryString({ scope, version })}`,
      { method: "DELETE", signal },
    ).then(requireTask);
  },
};
