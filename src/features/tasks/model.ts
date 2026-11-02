import { can } from "../../shared/domain/schema";
import type { Employee } from "../../shared/domain/schema";
import type { Task, TaskListItem, TaskCreate, TaskUpdate } from "./api";

export type TaskDraft = {
  branchId: string;
  title: string;
  body: string;
  assigneeId: string;
  due: string;
  priority: Task["priority"];
  category: string;
  status: Task["status"];
  checks: string;
};
export type TaskAction = "progress" | "complete" | "reopen" | "share";
export const taskFields = [
  "branchId",
  "title",
  "body",
  "assigneeId",
  "due",
  "priority",
  "category",
  "status",
  "checks",
] as const;
export function canCreateTask(user: Employee, branch: string) {
  return !!branch && branch !== "all" && can(user, branch);
}
export function canEditTask(user: Employee, task: Task | TaskListItem) {
  return task.canEdit && can(user, task.branchId);
}
export function taskActions(task: Task | TaskListItem): TaskAction[] {
  return task.status === "완료"
    ? ["reopen"]
    : task.status === "진행 중"
      ? ["reopen", "complete"]
      : ["progress", "complete"];
}
export const actionLabels: Record<TaskAction, string> = {
  progress: "진행하기",
  complete: "완료하기",
  reopen: "할 일로 변경",
  share: "운영 채널에 공유",
};
export function draftFromTask(task?: Task, branch = ""): TaskDraft {
  const date = task?.dueAt ? new Date(task.dueAt) : null;
  const local =
    date && !Number.isNaN(date.getTime())
      ? new Date(date.getTime() - date.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16)
      : "";
  return {
    branchId: task?.branchId ?? (branch === "all" ? "" : branch),
    title: task?.title ?? "",
    body: task?.body ?? "",
    assigneeId: task?.assignee.id ?? "",
    due: local,
    priority: task?.priority ?? "보통",
    category: task?.category ?? "운영",
    status: task?.status ?? "할 일",
    checks: task?.checklist.map((c) => c.body).join("\n") ?? "",
  };
}
export function taskBody(draft: TaskDraft): TaskCreate {
  return {
    branchId: draft.branchId,
    title: draft.title.trim(),
    body: draft.body.trim() || null,
    assigneeId: draft.assigneeId,
    dueAt: draft.due ? new Date(draft.due).toISOString() : null,
    priority: draft.priority,
    category: draft.category.trim(),
    status: draft.status,
    checklist: draft.checks
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean),
  };
}
export function taskPatch(
  base: Task,
  draft: TaskDraft,
  version: number,
  conflictEdits: readonly (keyof TaskDraft)[] = [],
): TaskUpdate {
  const original = taskBody(draftFromTask(base)),
    next = taskBody(draft);
  const patch: TaskUpdate = { version };
  for (const key of [
    "title",
    "body",
    "assigneeId",
    "dueAt",
    "priority",
    "category",
  ] as const) {
    if (
      JSON.stringify(next[key]) !== JSON.stringify(original[key]) ||
      conflictEdits.includes(key === "dueAt" ? "due" : key)
    )
      Object.assign(patch, { [key]: next[key] });
  }
  return patch;
}
export function validateTask(draft: TaskDraft) {
  const errors: Partial<Record<keyof TaskDraft, string>> = {};
  for (const key of [
    "branchId",
    "title",
    "assigneeId",
    "priority",
    "category",
    "status",
  ] as const)
    if (!draft[key].trim()) errors[key] = "필수 항목입니다.";
  if (draft.title.trim().length > 200)
    errors.title = "업무 제목은 200자 이하로 입력해 주세요.";
  if (draft.category.trim().length > 60)
    errors.category = "분류는 60자 이하로 입력해 주세요.";
  if (draft.body.length > 20000)
    errors.body = "내용은 20000자 이하로 입력해 주세요.";
  if (draft.due && Number.isNaN(new Date(draft.due).getTime()))
    errors.due = "기한을 확인해 주세요.";
  const items = draft.checks
    .split("\n")
    .map((t) => t.trim())
    .filter(Boolean);
  if (items.length > 100 || items.some((t) => t.length > 500))
    errors.checks = "체크 항목은 100개 이하, 각 500자 이하로 입력해 주세요.";
  return errors;
}
export type { Task, TaskListItem, TaskEvent } from "./api";
