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
import type { Task } from "../../shared/domain/schema";
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
    action: vi.fn(),
  },
}));
let store: MockStore, current: Task;
const clients: QueryClient[] = [];
beforeEach(() => {
  vi.resetAllMocks();
  store = new MockStore(false);
  store.persona = "junho";
  current = structuredClone(store.get("tasks", "task-2"));
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
    page: 1,
    pageSize: 20,
    total: 1,
  }));
  vi.mocked(taskApi.detail).mockImplementation(async () =>
    structuredClone(current),
  );
  vi.mocked(taskApi.assignees).mockImplementation(async (branch) =>
    store.db.employees.filter(
      (e) =>
        e.status === "활성" &&
        (e.owner || e.memberships.some((m) => m.branchId === branch)),
    ),
  );
  vi.mocked(taskApi.update).mockImplementation(async (_id, body) => {
    current = { ...current, ...body, version: current.version + 1 } as Task;
    return current;
  });
  vi.mocked(taskApi.create).mockResolvedValue(current);
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
it("keeps input on 422, maps field errors and retries the same logical request key", async () => {
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
  expect(vi.mocked(taskApi.update).mock.calls[0][3]).toBe(
    vi.mocked(taskApi.update).mock.calls[1][3],
  );
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
  current = { ...current, assigneeId: "minji", createdById: "owner" };
  mount();
  expect(
    await screen.findByText("이 업무를 수정할 권한이 없어요"),
  ).toBeVisible();
  expect(screen.queryByLabelText("업무 제목")).not.toBeInTheDocument();
});
it("keeps list conditions and uses the returned page size", async () => {
  vi.mocked(taskApi.list).mockResolvedValue({
    items: [current],
    total: 11,
    page: 1,
    pageSize: 20,
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
    current = { ...current, assigneeId: "minji", createdById: "owner" };
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
  vi.mocked(taskApi.update).mockRejectedValueOnce(
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
    checks: current.checks.map((c, i) => ({ ...c, done: i === 1 })),
  };
  await user.click(screen.getByRole("button", { name: "최신 내용 확인" }));
  await waitFor(() => expect(first).toBeEnabled());
  expect(
    screen.getByRole("checkbox", { name: "운영 채널에 결과 공유" }),
  ).toBeChecked();
  expect(taskApi.update).toHaveBeenCalledTimes(1);
  await user.click(first);
  await waitFor(() => expect(taskApi.update).toHaveBeenCalledTimes(2));
  expect(vi.mocked(taskApi.update).mock.calls[1][1]).toMatchObject({
    version: 6,
  });
});
it("does not replay a state transition automatically after a conflict", async () => {
  vi.mocked(taskApi.action)
    .mockRejectedValueOnce(
      new ApiError(409, { code: "VERSION_CONFLICT", message: "상태 충돌" }),
    )
    .mockResolvedValue(undefined);
  const { user } = mount("?detail=task-2&action=complete");
  await user.click(await screen.findByRole("button", { name: "완료하기" }));
  await screen.findByRole("button", { name: "최신 내용 확인" });
  current = { ...current, version: 7 };
  await user.click(screen.getByRole("button", { name: "최신 내용 확인" }));
  await screen.findByText("최신 업무 · 버전 7");
  expect(taskApi.action).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "완료하기" }));
  await waitFor(() => expect(taskApi.action).toHaveBeenCalledTimes(2));
  expect(vi.mocked(taskApi.action).mock.calls[1][3]).toBe(7);
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
