import { describe, expect, it } from "vitest";
import { MockStore } from "../../mocks/store";
import { command, create, update } from "../../mocks/domain";
import type { Task } from "../../shared/domain/schema";
import { canEditTask, draftFromTask, taskPatch } from "./model";

function fixture() {
  const store = new MockStore(false);
  store.persona = "junho";
  return store;
}
const input = {
  branchId: "gangnam",
  title: "직원 등록 업무",
  body: "확인",
  assigneeId: "minji",
  due: "2026-10-30",
  priority: "보통",
  category: "운영",
  status: "할 일",
  checks: [],
};

describe("POL-15 task ownership", () => {
  it("records the staff creator and allows creator, assignee and manager changes", () => {
    const store = fixture();
    const task = create(store, "tasks", input) as Task;
    expect(task.createdById).toBe("junho");
    update(store, "tasks", task.id, {
      version: 1,
      title: "등록자 수정",
      assigneeId: "minji",
    });
    store.persona = "minji";
    update(store, "tasks", task.id, {
      version: 2,
      body: "담당자 수정",
      due: "2026-11-01",
    });
    store.persona = "owner";
    command(store, "tasks", task.id, "complete", { version: 3 });
    expect(store.get("tasks", task.id).status).toBe("완료");
    expect(
      store
        .get("tasks", task.id)
        .history.map((h) => h.text)
        .join(" "),
    ).toContain("등록자 수정");
    expect(store.get("tasks", task.id).history).toHaveLength(4);
    store.persona = "minji";
    // This task belongs to owner/junho; minji is neither creator nor assignee.
    update(store, "tasks", "task-2", { version: 1, title: "지점 관리자 수정" });
    expect(store.get("tasks", "task-2").title).toBe("지점 관리자 수정");
    store.persona = "yujin";
    expect(canEditTask(store.user(), store.get("tasks", "task-2"))).toBe(false);
  });
  it("denies unrelated staff, foreign branches and inactive assignees", () => {
    const store = fixture();
    expect(canEditTask(store.user(), store.get("tasks", "task-1"))).toBe(false);
    expect(() =>
      update(store, "tasks", "task-1", { version: 1, title: "불가" }),
    ).toThrow(/등록자/);
    expect(() =>
      create(store, "tasks", { ...input, branchId: "seongsu" }),
    ).toThrow(/권한/);
    expect(() =>
      create(store, "tasks", { ...input, assigneeId: "doyun" }),
    ).toThrow(/활성 직원/);
    store.get("employees", "minji").status = "비활성";
    expect(() => create(store, "tasks", input)).toThrow(/활성 직원/);
  });
  it("does not trust a forged creator or permit invalid status transitions", () => {
    const store = fixture();
    expect(() =>
      create(store, "tasks", { ...input, createdById: "owner" }),
    ).toThrow(/허용되지/);
    const task = create(store, "tasks", input) as Task;
    expect(() =>
      update(store, "tasks", task.id, { version: 1, createdById: "owner" }),
    ).toThrow(/허용되지/);
    expect(() =>
      command(store, "tasks", task.id, "reopen", { version: 1 }),
    ).toThrow(/현재 상태/);
    command(store, "tasks", task.id, "complete", { version: 1 });
    expect(() =>
      command(store, "tasks", task.id, "progress", { version: 2 }),
    ).toThrow(/현재 상태/);
    command(store, "tasks", task.id, "reopen", { version: 2 });
    expect(store.get("tasks", task.id).status).toBe("할 일");
  });
  it("revoked membership takes precedence over creator ownership", () => {
    const store = fixture(),
      task = create(store, "tasks", input) as Task;
    store.user().memberships[0].status = "회수";
    expect(canEditTask(store.user(), task)).toBe(false);
    expect(() =>
      command(store, "tasks", task.id, "complete", { version: 1 }),
    ).toThrow(/권한/);
  });
  it("patches only user-edited fields against an explicitly refreshed version", () => {
    const store = fixture(),
      task = store.get("tasks", "task-2"),
      draft = draftFromTask(task);
    draft.title = "내 변경";
    expect(taskPatch(task, draft, 9)).toEqual({ title: "내 변경", version: 9 });
    expect(taskPatch(task, draftFromTask(task), 9)).toEqual({ version: 9 });
  });
});
