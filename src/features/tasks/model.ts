import { admin, can } from "../../shared/domain/schema";
import type { Employee, Task } from "../../shared/domain/schema";

// UI/demo model only. Backend #74 will define the wire contract separately.
export type TaskDraft = Pick<
  Task,
  | "branchId"
  | "title"
  | "body"
  | "assigneeId"
  | "due"
  | "priority"
  | "category"
  | "status"
> & { checks: string };
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
export function canEditTask(user: Employee, task: Task) {
  return (
    canCreateTask(user, task.branchId) &&
    (admin(user, task.branchId) ||
      task.createdById === user.id ||
      task.assigneeId === user.id)
  );
}
export function taskActions(task: Task): TaskAction[] {
  return task.status === "완료"
    ? ["reopen"]
    : task.status === "진행 중"
      ? ["complete"]
      : ["progress", "complete"];
}
export const actionLabels: Record<TaskAction, string> = {
  progress: "진행하기",
  complete: "완료하기",
  reopen: "다시 열기",
  share: "운영 채널에 공유",
};
export function draftFromTask(task?: Task, branch = ""): TaskDraft {
  return {
    branchId: task?.branchId ?? (branch === "all" ? "" : branch),
    title: task?.title ?? "",
    body: task?.body ?? "",
    assigneeId: task?.assigneeId ?? "",
    due: task?.due ?? "",
    priority: task?.priority ?? "보통",
    category: task?.category ?? "운영",
    status: task?.status ?? "할 일",
    checks:
      task?.checks
        .map((c) => `${c.done ? "[x]" : "[ ]"} ${c.text}`)
        .join("\n") ?? "",
  };
}
export function taskBody(draft: TaskDraft) {
  return {
    ...draft,
    title: draft.title.trim(),
    body: draft.body.trim(),
    checks: draft.checks
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => ({
        text: t.replace(/^\[[ xX]?\]\s*/, "").trim(),
        done: /^\[[xX]\]/.test(t),
      })),
  };
}
export function taskPatch(base: Task, draft: TaskDraft, version: number) {
  const original = taskBody(draftFromTask(base)),
    next = taskBody(draft);
  return {
    ...Object.fromEntries(
      Object.entries(next).filter(
        ([key, val]) =>
          key !== "branchId" &&
          JSON.stringify(val) !==
            JSON.stringify(original[key as keyof typeof original]),
      ),
    ),
    version,
  };
}
export function validateTask(draft: TaskDraft) {
  const errors: Partial<Record<keyof TaskDraft, string>> = {};
  for (const key of taskFields.filter((k) => k !== "checks"))
    if (!draft[key].trim()) errors[key] = "필수 항목입니다.";
  if (draft.title.trim().length > 120)
    errors.title = "업무 제목은 120자 이하로 입력해 주세요.";
  if (draft.due && !/^\d{4}-\d{2}-\d{2}$/.test(draft.due))
    errors.due = "기한을 확인해 주세요.";
  if (taskBody(draft).checks.some((c) => !c.text))
    errors.checks = "체크 항목의 내용을 입력해 주세요.";
  return errors;
}
