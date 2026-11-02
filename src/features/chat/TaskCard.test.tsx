import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TaskCard } from "./TaskCard";
import { useTaskDetail } from "../tasks/hooks";
vi.mock("../tasks/hooks", () => ({ useTaskDetail: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("renders current canonical card fields without extra task-scope requests", () => {
  render(
    <TaskCard
      id="task"
      onOpen={vi.fn()}
      snapshot={{
        accessible: true,
        taskId: "task",
        branchId: "branch",
        title: "현재 업무",
        status: "진행 중",
        priority: "높음",
        assignee: { id: "staff", name: "담당 직원" },
        dueAt: null,
      }}
    />,
  );
  expect(screen.getByText("현재 업무")).toBeVisible();
  expect(screen.getByText("담당자 담당 직원")).toBeVisible();
  expect(useTaskDetail).not.toHaveBeenCalled();
});
it("does not display inaccessible snapshot fields even if supplied", () => {
  render(
    <TaskCard
      id=""
      onOpen={vi.fn()}
      snapshot={{
        accessible: false,
        taskId: null,
        branchId: null,
        title: "숨길 제목",
        status: null,
        priority: null,
        assignee: null,
        dueAt: null,
      }}
    />,
  );
  expect(screen.getByText("접근 불가")).toBeVisible();
  expect(screen.queryByText("숨길 제목")).not.toBeInTheDocument();
  expect(useTaskDetail).not.toHaveBeenCalled();
});
