import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AppContext } from "../../app/context";
import type { Task } from "./api";
import { MockStore } from "../../mocks/store";
import { ApiError } from "../../shared/api/client";
import { Tasks } from "./Tasks";
import { taskApi } from "./api";

const context = vi.hoisted(() => ({ value: {} as AppContext }));
vi.mock("../../app/context", () => ({ useApp: () => context.value }));
vi.mock("./api", () => ({
  taskApi: {
    list: vi.fn(),
    detail: vi.fn(),
    assignees: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    status: vi.fn(),
    summary: vi.fn(),
    events: vi.fn(),
    addChecklist: vi.fn(),
    updateChecklist: vi.fn(),
    deleteChecklist: vi.fn(),
  },
}));
let store: MockStore, current: Task;
const clients: QueryClient[] = [];
beforeEach(() => {
  vi.resetAllMocks();
  store = new MockStore(false);
  store.persona = "junho";
  const legacy = store.get("tasks", "task-2");
  current = {
    id: legacy.id,
    branchId: legacy.branchId,
    title: legacy.title,
    body: legacy.body,
    priority: legacy.priority,
    category: legacy.category,
    status: legacy.status,
    assignee: {
      id: legacy.assigneeId,
      name: store.get("employees", legacy.assigneeId).name,
    },
    createdBy: { id: "junho", name: "박준호" },
    dueAt: "2026-11-03T08:00:00Z",
    completedAt: null,
    overdue: false,
    canEdit: true,
    version: legacy.version,
    createdAt: "2026-11-01T08:00:00Z",
    updatedAt: "2026-11-01T08:00:00Z",
    checklist: legacy.checks.map((item, index) => ({
      id: `check-${index}`,
      body: item.text,
      done: item.done,
      sortOrder: index,
      updatedBy: null,
      updatedAt: "2026-11-01T08:00:00Z",
    })),
    checklistTotal: legacy.checks.length,
    checklistDone: legacy.checks.filter((item) => item.done).length,
  };
  vi.mocked(taskApi.events).mockResolvedValue({
    items: [],
    meta: { page: 1, pageSize: 20, total: 0 },
  });
  vi.mocked(taskApi.summary).mockResolvedValue({
    asOf: store.now(),
    totals: { total: 1, todo: 1, inProgress: 0, done: 0, overdue: 0 },
    branches: [],
  });
  context.value = {
    session: {
      user: structuredClone(store.user()),
      branches: store.db.branches,
      asOf: store.now(),
      snapshotVersion: "test",
    },
    scope: "gangnam",
    lookups: { ...store.db, preview: false },
  };
  vi.mocked(taskApi.list).mockImplementation(async () => ({
    items: [structuredClone(current)],
    meta: { page: 1, pageSize: 20, total: 1 },
  }));
  vi.mocked(taskApi.detail).mockImplementation(async () =>
    structuredClone(current),
  );
  vi.mocked(taskApi.assignees).mockImplementation(async (branch) =>
    store.db.employees.filter(
      (e) =>
        e.status === "활성" && e.memberships.some((m) => m.branchId === branch),
    ),
  );
  vi.mocked(taskApi.update).mockImplementation(async (_id, body) => {
    current = { ...current, ...body, version: current.version + 1 } as Task;
    return current;
  });
  vi.mocked(taskApi.create).mockResolvedValue(current);
  vi.mocked(taskApi.updateChecklist).mockImplementation(
    async (_scope, _id, itemId, body) => {
      current = {
        ...current,
        version: current.version + 1,
        checklist: current.checklist.map((item) =>
          item.id === itemId ? { ...item, ...body } : item,
        ),
      };
      return current;
    },
  );
  vi.mocked(taskApi.addChecklist).mockImplementation(
    async (_scope, _id, body) => {
      current = {
        ...current,
        version: current.version + 1,
        checklist: [
          ...current.checklist,
          {
            id: "new-check",
            body: body.body,
            done: false,
            sortOrder: current.checklist.length,
            updatedBy: null,
            updatedAt: store.now(),
          },
        ],
      };
      return current;
    },
  );
  vi.mocked(taskApi.deleteChecklist).mockImplementation(
    async (_scope, _id, itemId) => {
      current = {
        ...current,
        version: current.version + 1,
        checklist: current.checklist.filter((item) => item.id !== itemId),
      };
      return current;
    },
  );
});
afterEach(() => {
  cleanup();
  clients.forEach((c) => c.clear());
  clients.length = 0;
  vi.restoreAllMocks();
});
function mount(search = "?detail=task-2&edit=1") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const router = createMemoryRouter([{ path: "*", element: <Tasks /> }], {
    initialEntries: [`/app/gangnam/tasks${search}`],
  });
  render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
  return { client, router, user: userEvent.setup() };
}
it.each([
  ["높음", "warn"],
  ["긴급", "bad"],
] as const)(
  "shows %s priority and the overdue badge in the list and detail",
  async (priority, tone) => {
    current = { ...current, priority, overdue: true };
    const { user } = mount("");
    const taskLink = await screen.findByRole("button", { name: current.title });
    const row = within(taskLink.closest("tr")!);
    expect(row.getByText(priority)).toHaveClass("badge", tone);
    expect(row.getByText("기한 초과")).toHaveClass("badge", "bad");

    await user.click(taskLink);
    const dialog = within(await screen.findByRole("dialog"));
    expect(await dialog.findByText(priority)).toHaveClass("badge", tone);
    expect(dialog.getByText("기한 초과")).toHaveClass("badge", "bad");
  },
);

it("allows staff creation and resets assignee when the creation branch changes", async () => {
  context.value.session.user = structuredClone(store.get("employees", "owner"));
  context.value.scope = "all";
  const { user } = mount("?detail=new");
  const branch = await screen.findByLabelText("지점", { selector: "select" });
  await user.selectOptions(branch, "gangnam");
  await user.selectOptions(
    await screen.findByLabelText("담당자", { selector: "select" }),
    "junho",
  );
  await user.selectOptions(branch, "seongsu");
  expect(screen.getByLabelText("담당자", { selector: "select" })).toHaveValue(
    "",
  );
  await waitFor(() =>
    expect(
      within(
        screen.getByLabelText("담당자", { selector: "select" }),
      ).queryByRole("option", { name: "박준호" }),
    ).not.toBeInTheDocument(),
  );
});
it("keeps input on 422 and maps field errors", async () => {
  const { user } = mount();
  const title = await screen.findByLabelText("업무 제목");
  await user.clear(title);
  await user.type(title, "수정한 업무");
  vi.mocked(taskApi.update).mockRejectedValueOnce(
    new ApiError(422, {
      code: "VALIDATION_ERROR",
      message: "입력 확인",
      fieldErrors: { title: "제목 오류" },
    }),
  );
  await user.click(screen.getByRole("button", { name: "저장하기" }));
  expect(await screen.findByText("제목 오류")).toBeVisible();
  expect(title).toHaveValue("수정한 업무");
  await user.click(screen.getByRole("button", { name: "저장하기" }));
  await waitFor(() => expect(taskApi.update).toHaveBeenCalledTimes(2));
  expect(vi.mocked(taskApi.update).mock.calls[1][1]).toEqual({
    version: current.version - 1,
    title: "수정한 업무",
  });
});
it("preserves the draft through 409 and latest refresh, then submits only edited fields", async () => {
  const { user } = mount();
  const title = await screen.findByLabelText("업무 제목");
  await user.clear(title);
  await user.type(title, "내 입력");
  vi.mocked(taskApi.update).mockRejectedValueOnce(
    new ApiError(409, {
      code: "VERSION_CONFLICT",
      message: "다른 사용자 변경",
    }),
  );
  await user.click(screen.getByRole("button", { name: "저장하기" }));
  expect(
    await screen.findByRole("button", { name: "최신 내용 확인" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "저장하기" })).toBeDisabled();
  current = { ...current, body: "다른 사용자의 본문", version: 8 };
  await user.click(screen.getByRole("button", { name: "최신 내용 확인" }));
  expect(await screen.findByText("다른 사용자의 본문")).toBeVisible();
  expect(title).toHaveValue("내 입력");
  await user.click(
    screen.getByRole("button", { name: "최신 기준으로 다시 저장" }),
  );
  await waitFor(() => expect(taskApi.update).toHaveBeenCalledTimes(2));
  expect(vi.mocked(taskApi.update).mock.calls[1][1]).toEqual({
    title: "내 입력",
    version: 8,
  });
  expect(current.body).toBe("다른 사용자의 본문");
});
it("saves an explicit return to the original title after comparing a conflict", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const originalTitle = current.title;
  const { user, router } = mount();
  const title = await screen.findByLabelText("업무 제목");
  await user.clear(title);
  await user.type(title, "내 첫 수정");
  vi.mocked(taskApi.update).mockRejectedValueOnce(
    new ApiError(409, { code: "VERSION_CONFLICT", message: "버전 충돌" }),
  );
  await user.click(screen.getByRole("button", { name: "저장하기" }));
  await screen.findByRole("button", { name: "최신 내용 확인" });
  current = {
    ...current,
    title: "다른 사용자의 제목",
    body: "다른 사용자의 본문",
    version: 9,
  };
  await user.click(screen.getByRole("button", { name: "최신 내용 확인" }));
  await screen.findByText("최신 업무 · 버전 9");
  await user.clear(title);
  await user.type(title, originalTitle);
  await user.click(screen.getByRole("button", { name: "닫기" }));
  expect(confirm).toHaveBeenCalled();
  expect(router.state.location.search).toContain("edit=1");
  await user.click(
    screen.getByRole("button", { name: "최신 기준으로 다시 저장" }),
  );
  await waitFor(() => expect(taskApi.update).toHaveBeenCalledTimes(2));
  expect(vi.mocked(taskApi.update).mock.calls[1][1]).toEqual({
    title: originalTitle,
    version: 9,
  });
  expect(current.title).toBe(originalTitle);
  expect(current.body).toBe("다른 사용자의 본문");
});
it("blocks leaving a dirty form until the user accepts discarding it", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const { user, router } = mount();
  await user.type(await screen.findByLabelText("업무 제목"), " 변경");
  await user.click(screen.getByRole("button", { name: "닫기" }));
  expect(confirm).toHaveBeenCalled();
  expect(router.state.location.search).toContain("edit=1");
  confirm.mockReturnValue(true);
  await user.click(screen.getByRole("button", { name: "닫기" }));
  await waitFor(() => expect(router.state.location.search).toBe(""));
});
it("does not expose editing through a direct URL to unrelated staff", async () => {
  current = {
    ...current,
    canEdit: false,
    assignee: { id: "minji", name: "민지" },
    createdBy: { id: "owner", name: "대표" },
  };
  mount();
  expect(
    await screen.findByText("이 업무를 수정할 권한이 없어요"),
  ).toBeVisible();
  expect(screen.queryByLabelText("업무 제목")).not.toBeInTheDocument();
});
it("keeps list conditions and uses the returned page size", async () => {
  vi.mocked(taskApi.list).mockResolvedValue({
    items: [current],
    meta: { total: 11, page: 1, pageSize: 20 },
  });
  const { user, router } = mount("?q=업무&status=할+일&mine=1&detail=task-2");
  await screen.findByRole("button", { name: "수정하기" });
  await user.click(screen.getByRole("button", { name: "닫기" }));
  expect(router.state.location.search).toContain("mine=1");
  expect(screen.getByRole("searchbox", { name: "업무 검색" })).toHaveValue(
    "업무",
  );
  expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();
});
it("hides an editor and aborts its in-flight write after permission revocation", async () => {
  let signal: AbortSignal | undefined;
  vi.mocked(taskApi.update).mockImplementation((_id, _body, value) => {
    signal = value;
    return new Promise(() => {});
  });
  const { user, client } = mount();
  await user.type(await screen.findByLabelText("업무 제목"), " 변경");
  await user.click(screen.getByRole("button", { name: "저장하기" }));
  await waitFor(() => expect(signal).toBeDefined());
  await act(async () => {
    current = {
      ...current,
      canEdit: false,
      assignee: { id: "minji", name: "민지" },
      createdBy: { id: "owner", name: "대표" },
    };
    await client.invalidateQueries({ queryKey: ["data"] });
  });
  expect(
    await screen.findByText("이 업무를 수정할 권한이 없어요"),
  ).toBeVisible();
  expect(signal?.aborted).toBe(true);
});

it("keeps saving blocked when reading the latest version fails", async () => {
  const { user } = mount();
  await user.type(await screen.findByLabelText("업무 제목"), " 변경");
  vi.mocked(taskApi.update).mockRejectedValueOnce(
    new ApiError(409, { code: "VERSION_CONFLICT", message: "버전 충돌" }),
  );
  await user.click(screen.getByRole("button", { name: "저장하기" }));
  await screen.findByRole("button", { name: "최신 내용 확인" });
  vi.mocked(taskApi.detail).mockRejectedValueOnce(
    new ApiError(0, { code: "NETWORK_ERROR", message: "최신 조회 실패" }),
  );
  await user.click(screen.getByRole("button", { name: "최신 내용 확인" }));
  expect(await screen.findByText("최신 조회 실패")).toBeVisible();
  expect(screen.getByRole("button", { name: "저장하기" })).toBeDisabled();
  expect(screen.getByLabelText("업무 제목")).toHaveValue(
    `${current.title} 변경`,
  );
});
it("requires an explicit refresh and second checkbox choice after a checklist conflict", async () => {
  const { user } = mount("?detail=task-2");
  const first = await screen.findByRole("checkbox", { name: "현장 상태 확인" });
  vi.mocked(taskApi.updateChecklist).mockRejectedValueOnce(
    new ApiError(409, { code: "VERSION_CONFLICT", message: "체크리스트 충돌" }),
  );
  await user.click(first);
  expect(
    await screen.findByRole("button", { name: "최신 내용 확인" }),
  ).toBeVisible();
  expect(first).not.toBeChecked();
  expect(first).toBeDisabled();
  current = {
    ...current,
    version: 6,
    checklist: current.checklist.map((c, i) => ({ ...c, done: i === 1 })),
  };
  await user.click(screen.getByRole("button", { name: "최신 내용 확인" }));
  await waitFor(() => expect(first).toBeEnabled());
  expect(
    screen.getByRole("checkbox", { name: "운영 채널에 결과 공유" }),
  ).toBeChecked();
  expect(taskApi.updateChecklist).toHaveBeenCalledTimes(1);
  await user.click(first);
  await waitFor(() => expect(taskApi.updateChecklist).toHaveBeenCalledTimes(2));
  expect(vi.mocked(taskApi.updateChecklist).mock.calls[1][3]).toMatchObject({
    version: 6,
  });
});
it("does not replay a state transition automatically after a conflict", async () => {
  vi.mocked(taskApi.status)
    .mockRejectedValueOnce(
      new ApiError(409, { code: "VERSION_CONFLICT", message: "상태 충돌" }),
    )
    .mockResolvedValue(current);
  const { user } = mount("?detail=task-2&action=complete");
  await user.click(await screen.findByRole("button", { name: "완료하기" }));
  await screen.findByRole("button", { name: "최신 내용 확인" });
  current = { ...current, version: 7 };
  await user.click(screen.getByRole("button", { name: "최신 내용 확인" }));
  await screen.findByText("최신 업무 · 버전 7");
  expect(taskApi.status).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "완료하기" }));
  await waitFor(() => expect(taskApi.status).toHaveBeenCalledTimes(2));
  expect(vi.mocked(taskApi.status).mock.calls[1][2]).toEqual({
    version: 7,
    status: "완료",
  });
});
it("sends one request when save is clicked twice while a write is pending", async () => {
  let resolve!: (task: Task) => void;
  vi.mocked(taskApi.update).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { user } = mount();
  await user.type(await screen.findByLabelText("업무 제목"), " 변경");
  await user.dblClick(screen.getByRole("button", { name: "저장하기" }));
  expect(taskApi.update).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "처리 중…" })).toBeDisabled();
  await act(async () => resolve(current));
});

it("reuses a creation key after a failed request and sends canonical optional fields", async () => {
  const { user } = mount("?detail=new");
  await user.type(await screen.findByLabelText("업무 제목"), "새 업무");
  await waitFor(() =>
    expect(screen.getByRole("option", { name: "박준호" })).toBeInTheDocument(),
  );
  await user.selectOptions(
    screen.getByLabelText("담당자", { selector: "select" }),
    "junho",
  );
  vi.mocked(taskApi.create).mockRejectedValueOnce(
    new ApiError(0, { code: "NETWORK_ERROR", message: "연결 실패" }),
  );
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "업무 등록",
    }),
  );
  await screen.findByText("연결 실패");
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "업무 등록",
    }),
  );
  await waitFor(() => expect(taskApi.create).toHaveBeenCalledTimes(2));
  expect(vi.mocked(taskApi.create).mock.calls[0][2]).toBe(
    vi.mocked(taskApi.create).mock.calls[1][2],
  );
  expect(vi.mocked(taskApi.create).mock.calls[0][0]).toMatchObject({
    title: "새 업무",
    branchId: "gangnam",
    assigneeId: "junho",
    dueAt: null,
    body: null,
    checklist: [],
  });
});

it("uses the returned task version for checklist add, content edit and removal", async () => {
  const { user } = mount("?detail=task-2");
  const version = current.version;
  await user.type(await screen.findByLabelText("새 체크 항목"), "새 확인 항목");
  await user.click(screen.getByRole("button", { name: "항목 추가" }));
  await screen.findByRole("checkbox", { name: "새 확인 항목" });
  expect(vi.mocked(taskApi.addChecklist).mock.calls[0][2]).toEqual({
    version,
    body: "새 확인 항목",
  });
  await user.click(screen.getByRole("button", { name: "새 확인 항목 수정" }));
  const input = screen.getByLabelText("체크 항목 내용 수정");
  await user.clear(input);
  await user.type(input, "변경한 항목");
  await user.click(screen.getByRole("button", { name: "항목 저장" }));
  await screen.findByRole("checkbox", { name: "변경한 항목" });
  expect(vi.mocked(taskApi.updateChecklist).mock.calls[0].slice(2, 4)).toEqual([
    "new-check",
    { version: version + 1, body: "변경한 항목" },
  ]);
  await user.click(screen.getByRole("button", { name: "변경한 항목 삭제" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("checkbox", { name: "변경한 항목" }),
    ).not.toBeInTheDocument(),
  );
  expect(vi.mocked(taskApi.deleteChecklist).mock.calls[0].slice(2, 4)).toEqual([
    "new-check",
    version + 2,
  ]);
  expect(taskApi.update).not.toHaveBeenCalled();
});

it("keeps a deleted checklist item's draft visible and can add it as a new item", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const { user, router } = mount("?detail=task-2");
  await user.click(
    await screen.findByRole("button", { name: "현장 상태 확인 수정" }),
  );
  const input = screen.getByLabelText("체크 항목 내용 수정");
  await user.clear(input);
  await user.type(input, "삭제된 항목의 내 입력");
  await user.type(screen.getByLabelText("새 체크 항목"), "별도의 새 항목 입력");
  vi.mocked(taskApi.updateChecklist).mockRejectedValueOnce(
    new ApiError(409, { code: "VERSION_CONFLICT", message: "체크리스트 충돌" }),
  );
  await user.click(screen.getByRole("button", { name: "항목 저장" }));
  await screen.findByRole("button", { name: "최신 내용 확인" });
  current = {
    ...current,
    version: 12,
    checklist: current.checklist.filter((item) => item.id !== "check-0"),
  };
  await user.click(screen.getByRole("button", { name: "최신 내용 확인" }));
  const recovery = await screen.findByRole("region", {
    name: "삭제된 체크 항목 입력 복구",
  });
  expect(within(recovery).getByLabelText("체크 항목 내용 수정")).toHaveValue(
    "삭제된 항목의 내 입력",
  );
  expect(
    within(recovery).queryByRole("button", { name: "항목 저장" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "닫기" }));
  expect(confirm).toHaveBeenCalled();
  expect(router.state.location.search).toContain("detail=task-2");
  expect(taskApi.updateChecklist).toHaveBeenCalledTimes(1);
  await user.click(
    within(recovery).getByRole("button", { name: "새 항목으로 추가" }),
  );
  await screen.findByRole("checkbox", { name: "삭제된 항목의 내 입력" });
  expect(vi.mocked(taskApi.addChecklist).mock.calls[0][2]).toEqual({
    version: 12,
    body: "삭제된 항목의 내 입력",
  });
  expect(
    screen.queryByRole("region", { name: "삭제된 체크 항목 입력 복구" }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("새 체크 항목")).toHaveValue(
    "별도의 새 항목 입력",
  );
});
it("lets the user cancel a checklist draft deleted during a background refresh", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const { user, client, router } = mount("?detail=task-2");
  await user.click(
    await screen.findByRole("button", { name: "현장 상태 확인 수정" }),
  );
  await user.type(screen.getByLabelText("체크 항목 내용 수정"), " 내 입력");
  await act(async () => {
    current = { ...current, version: 13, checklist: [] };
    await client.invalidateQueries({ queryKey: ["data"] });
  });
  const recovery = await screen.findByRole("region", {
    name: "삭제된 체크 항목 입력 복구",
  });
  await user.click(screen.getByRole("button", { name: "닫기" }));
  expect(confirm).toHaveBeenCalledTimes(1);
  await user.click(within(recovery).getByRole("button", { name: "취소" }));
  await user.click(screen.getByRole("button", { name: "닫기" }));
  await waitFor(() => expect(router.state.location.search).toBe(""));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(taskApi.addChecklist).not.toHaveBeenCalled();
});
it("preserves filters after a list reload failure and closing a detail", async () => {
  const search =
    "?q=업무&mine=true&dueFrom=2026-11-01T00%3A00%3A00Z&dueTo=2026-11-10T00%3A00%3A00Z&overdue=true&sort=dueAt&direction=asc&page=2&detail=task-2";
  const { user, client, router } = mount(search);
  await screen.findByRole("button", { name: "수정하기" });
  vi.mocked(taskApi.list).mockRejectedValue(
    new ApiError(0, { code: "NETWORK_ERROR", message: "목록 재조회 실패" }),
  );
  await act(async () => {
    await client.invalidateQueries({
      queryKey: [
        "data",
        context.value.session.user.id,
        "gangnam",
        "tasks",
        "list",
      ],
    });
  });
  expect(
    await screen.findByText(/업무 관리 데이터를 불러오지 못했어요/),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "닫기" }));
  const params = new URLSearchParams(router.state.location.search);
  expect(params.get("dueFrom")).toBe("2026-11-01T00:00:00Z");
  expect(params.get("dueTo")).toBe("2026-11-10T00:00:00Z");
  expect(params.get("page")).toBe("2");
  expect(params.get("overdue")).toBe("true");
  expect(screen.getByRole("button", { name: "기한 초과" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();
});

it("loads processing history independently and shows its actor and changed values", async () => {
  vi.mocked(taskApi.events).mockResolvedValue({
    items: [
      {
        id: "event-1",
        type: "STATUS_CHANGED",
        actor: { id: "junho", name: "박준호" },
        before: { status: "할 일" },
        after: { status: "진행 중" },
        at: "2026-11-02T01:00:00Z",
      },
    ],
    meta: { page: 1, pageSize: 20, total: 1 },
  });
  mount("?detail=task-2");
  expect(await screen.findByText(/박준호 · 상태 변경/)).toBeVisible();
  expect(screen.getByText("변경 전: 상태: 할 일")).toBeVisible();
  expect(screen.getByText("변경 후: 상태: 진행 중")).toBeVisible();
});

it("preserves a custom category and saves a new free-text category", async () => {
  current = { ...current, category: "야간 특별 운영", priority: "긴급" };
  const { user } = mount();
  const category = await screen.findByLabelText("분류", { selector: "input" });
  expect(category).toHaveValue("야간 특별 운영");
  expect(screen.getByLabelText("우선순위")).toHaveValue("긴급");
  await user.clear(category);
  await user.type(category, "자유 분류 2026");
  await user.click(screen.getByRole("button", { name: "저장하기" }));
  await waitFor(() => expect(taskApi.update).toHaveBeenCalledTimes(1));
  expect(vi.mocked(taskApi.update).mock.calls[0][1]).toEqual({
    version: current.version - 1,
    category: "자유 분류 2026",
  });
});

it("keeps a dirty edit draft when a background detail reload fails", async () => {
  const { user, client } = mount();
  const title = await screen.findByLabelText("업무 제목");
  await user.type(title, " 유지");
  vi.mocked(taskApi.detail).mockRejectedValueOnce(
    new ApiError(500, { code: "INTERNAL_ERROR", message: "상세 재조회 실패" }),
  );
  await act(async () => {
    await client.invalidateQueries({
      queryKey: [
        "data",
        context.value.session.user.id,
        "gangnam",
        "tasks",
        "detail",
      ],
    });
  });
  expect(screen.getByLabelText("업무 제목")).toHaveValue(
    `${current.title} 유지`,
  );
  expect(screen.getByRole("button", { name: "저장하기" })).toBeEnabled();
});
