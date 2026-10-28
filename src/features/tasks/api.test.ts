import { beforeEach, expect, it, vi } from "vitest";
import { MockStore } from "../../mocks/store";
import { api } from "../../shared/api/client";
import { taskApi } from "./api";

vi.mock("../../shared/api/client", async (original) => ({
  ...(await original<typeof import("../../shared/api/client")>()),
  api: vi.fn(),
}));
beforeEach(() => vi.resetAllMocks());
it("uses only list conditions in legacy requests and preserves server page metadata", async () => {
  const store = new MockStore(false),
    signal = new AbortController().signal;
  vi.mocked(api).mockResolvedValue({
    items: [store.db.tasks[0]],
    meta: { page: 2, pageSize: 25, total: 40 },
  });
  const result = await taskApi.list(
    "gangnam",
    "q=점검&mine=1&page=2&detail=task-1&edit=1&action=complete",
    signal,
  );
  const url = new URL(vi.mocked(api).mock.calls[0][0], "https://example.test");
  expect(Object.fromEntries(url.searchParams)).toEqual({
    scope: "gangnam",
    q: "점검",
    mine: "1",
    page: "2",
  });
  expect(vi.mocked(api).mock.calls[0][1]?.signal).toBe(signal);
  expect(result).toMatchObject({ page: 2, pageSize: 25, total: 40 });
});
it("does not infer active membership from minimal lookup rows", async () => {
  const store = new MockStore(false),
    active = store.db.employees.find((e) => e.id === "junho")!;
  vi.mocked(api).mockResolvedValue({
    employees: [
      active,
      { id: "minimal", name: "최소 응답" },
      { ...active, id: "inactive", status: "비활성" },
      {
        ...active,
        id: "revoked",
        memberships: [
          {
            branchId: "gangnam",
            status: "회수",
            role: "staff",
            permissions: [],
          },
        ],
      },
      store.db.employees.find((e) => e.id === "doyun"),
    ],
  });
  expect(
    (await taskApi.assignees("gangnam", new AbortController().signal)).map(
      (e) => e.id,
    ),
  ).toEqual(["junho"]);
});
it("propagates failures without fabricating empty or successful task data", async () => {
  vi.mocked(api).mockRejectedValue(new Error("지원되지 않는 API"));
  await expect(
    taskApi.list("gangnam", "", new AbortController().signal),
  ).rejects.toThrow("지원되지 않는 API");
  await expect(
    taskApi.create({}, new AbortController().signal, "request-1"),
  ).rejects.toThrow("지원되지 않는 API");
});
