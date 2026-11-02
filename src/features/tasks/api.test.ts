import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../shared/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../shared/api/client")>()),
  api: vi.fn(),
}));
import { api } from "../../shared/api/client";
import { taskApi } from "./api";
const request = vi.mocked(api),
  signal = new AbortController().signal;
const task = {
  id: "1",
  branchId: "b",
  title: "업무",
  category: "운영",
  priority: "보통",
  status: "할 일",
  assignee: { id: "u", name: "직원" },
  createdBy: { id: "u", name: "직원" },
  body: null,
  dueAt: null,
  completedAt: null,
  overdue: false,
  canEdit: true,
  version: 1,
  checklistTotal: 0,
  checklistDone: 0,
  checklist: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};
beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue(task);
});
describe("task API contract", () => {
  it("forwards canonical list filters and excludes status and pagination from summary", async () => {
    const search =
      "q=hello&mine=true&overdue=true&dueFrom=2026-01-01T00%3A00%3A00Z&status=완료&sort=dueAt&page=2&date=old";
    request
      .mockResolvedValueOnce({
        items: [task],
        meta: { page: 1, pageSize: 20, total: 1 },
      })
      .mockResolvedValueOnce({
        asOf: "2026-01-01T00:00:00Z",
        totals: { total: 1, todo: 1, inProgress: 0, done: 0, overdue: 0 },
        branches: [],
      });
    await taskApi.list("all", search, signal);
    await taskApi.summary("all", search, signal);
    const list = new URLSearchParams(request.mock.calls[0][0].split("?")[1]);
    const summary = new URLSearchParams(request.mock.calls[1][0].split("?")[1]);
    expect(Object.fromEntries(list)).toMatchObject({
      scope: "all",
      mine: "true",
      overdue: "true",
      sort: "dueAt",
      page: "2",
      dueFrom: "2026-01-01T00:00:00Z",
    });
    expect(list.has("date")).toBe(false);
    expect(summary.has("status")).toBe(false);
    expect(summary.has("page")).toBe(false);
  });
  it("uses dedicated candidate, status and versioned checklist routes", async () => {
    request.mockResolvedValueOnce({ items: [{ id: "1", name: "직원" }] });
    expect(await taskApi.assignees("b", signal)).toEqual([
      { id: "1", name: "직원" },
    ]);
    await taskApi.status("b", "a/b", { version: 2, status: "완료" }, signal);
    await taskApi.updateChecklist(
      "b",
      "a/b",
      "c/d",
      { version: 3, done: true },
      signal,
    );
    await taskApi.deleteChecklist("b", "a/b", "c/d", 4, signal);
    expect(request.mock.calls[0][0]).toBe("/assignee-candidates?branchId=b");
    expect(request.mock.calls[1]).toEqual([
      "/tasks/a%2Fb/status?scope=b",
      { method: "POST", body: { version: 2, status: "완료" }, signal },
    ]);
    expect(request.mock.calls[2][0]).toBe(
      "/tasks/a%2Fb/checklist-items/c%2Fd?scope=b",
    );
    expect(request.mock.calls[3]).toEqual([
      "/tasks/a%2Fb/checklist-items/c%2Fd?scope=b&version=4",
      { method: "DELETE", signal },
    ]);
  });
  it("sends idempotency key for creation, not versioned updates", async () => {
    const body = {
      branchId: "b",
      title: "제목",
      assigneeId: "u",
      category: "운영",
    };
    await taskApi.create(body, signal, "key", "b");
    await taskApi.update("1", { version: 1, title: "변경" }, signal, "b");
    expect(request.mock.calls[0][1]).toMatchObject({ key: "key", body });
    expect(request.mock.calls[1][1]).not.toHaveProperty("key");
  });
});

it("requests detail, events and checklist additions with the selected scope", async () => {
  await taskApi.detail("all", "1", signal);
  await taskApi.events("all", "1", signal, 2, 50);
  await taskApi.addChecklist("all", "1", { version: 5, body: "확인" }, signal);
  expect(request.mock.calls[0][0]).toBe("/tasks/1?scope=all");
  expect(request.mock.calls[1][0]).toBe(
    "/tasks/1/events?scope=all&page=2&pageSize=50",
  );
  expect(request.mock.calls[2]).toEqual([
    "/tasks/1/checklist-items?scope=all",
    { method: "POST", body: { version: 5, body: "확인" }, signal },
  ]);
});

it("rejects an empty or malformed successful mutation response", async () => {
  request
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce({ id: "1", version: 2 });
  await expect(
    taskApi.status("b", "1", { version: 1, status: "완료" }, signal),
  ).rejects.toMatchObject({ detail: { code: "INVALID_RESPONSE" } });
  await expect(
    taskApi.update("1", { version: 1, title: "수정" }, signal, "b"),
  ).rejects.toMatchObject({ detail: { code: "INVALID_RESPONSE" } });
});
it("normalizes legacy mine filter for the boolean contract", async () => {
  request.mockResolvedValueOnce({
    items: [],
    meta: { page: 1, pageSize: 20, total: 0 },
  });
  await taskApi.list("b", "mine=1", signal);
  expect(request.mock.calls[0][0]).toContain("mine=true");
});

it("rejects malformed list, summary, and detail responses without inventing empty data", async () => {
  request
    .mockResolvedValueOnce({ items: null })
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce(undefined);
  await expect(taskApi.list("b", "", signal)).rejects.toMatchObject({
    detail: { code: "INVALID_RESPONSE" },
  });
  await expect(taskApi.summary("b", "", signal)).rejects.toMatchObject({
    detail: { code: "INVALID_RESPONSE" },
  });
  await expect(taskApi.detail("b", "1", signal)).rejects.toMatchObject({
    detail: { code: "INVALID_RESPONSE" },
  });
});
it("preserves an HTTP error from the transport", async () => {
  const error = new Error("transport failed");
  request.mockRejectedValueOnce(error);
  await expect(taskApi.list("b", "", signal)).rejects.toBe(error);
});
