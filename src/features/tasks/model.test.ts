import { describe, expect, it } from "vitest";
import {
  draftFromTask,
  taskBody,
  taskPatch,
  taskActions,
  validateTask,
} from "./model";
import type { Task } from "./api";
const task: Task = {
  id: "1",
  branchId: "b",
  title: "제목",
  category: "운영",
  priority: "보통",
  status: "진행 중",
  assignee: { id: "u", name: "직원" },
  createdBy: { id: "c", name: "등록자" },
  dueAt: null,
  completedAt: null,
  overdue: false,
  checklistTotal: 1,
  checklistDone: 0,
  canEdit: true,
  version: 3,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  body: null,
  checklist: [
    {
      id: "i",
      body: "확인",
      done: false,
      sortOrder: 0,
      updatedBy: null,
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ],
};
describe("task contract model", () => {
  it("sends only changed mutable fields against the refreshed version", () => {
    const draft = draftFromTask(task);
    draft.title = "변경";
    draft.status = "완료";
    draft.branchId = "other";
    draft.checks = "다른 항목";
    expect(taskPatch(task, draft, 9)).toEqual({ version: 9, title: "변경" });
    expect(taskPatch(task, draftFromTask(task), 9)).toEqual({ version: 9 });
  });
  it("creates checklist strings and nullable optional fields", () => {
    const draft = draftFromTask(task);
    draft.checks = "첫째\n\n둘째";
    expect(taskBody(draft)).toMatchObject({
      body: null,
      dueAt: null,
      checklist: ["첫째", "둘째"],
    });
    expect(validateTask(draft)).toEqual({});
  });
  it("allows progressing work to return to todo", () =>
    expect(taskActions(task)).toEqual(["reopen", "complete"]));
});
import type { Employee } from "../../shared/domain/schema";
import { canEditTask } from "./model";
it("requires both server edit permission and current membership", () => {
  const user = {
    status: "활성",
    owner: false,
    memberships: [{ branchId: "b", status: "활성", permissions: [] }],
  } as unknown as Employee;
  expect(canEditTask(user, task)).toBe(true);
  expect(canEditTask(user, { ...task, canEdit: false })).toBe(false);
  expect(canEditTask({ ...user, status: "비활성" }, task)).toBe(false);
  expect(canEditTask({ ...user, memberships: [] }, task)).toBe(false);
});
