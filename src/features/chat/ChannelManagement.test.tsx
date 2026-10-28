import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AppContext } from "../../app/context";
import { MockStore } from "../../mocks/store";
import { ApiError } from "../../shared/api/client";
import { ChannelManagement } from "./ChannelManagement";
import { chatApi } from "./api";
const context = vi.hoisted(() => ({ value: {} as AppContext }));
vi.mock("../../app/context", () => ({ useApp: () => context.value }));
vi.mock("./api", () => ({
  chatApi: {
    managed: vi.fn(),
    candidates: vi.fn(),
    channel: vi.fn(),
    saveChannel: vi.fn(),
  },
}));
let store: MockStore;
const clients: QueryClient[] = [];
beforeEach(() => {
  vi.resetAllMocks();
  store = new MockStore(false);
  store.persona = "owner";
  context.value = {
    session: {
      user: structuredClone(store.user()),
      branches: store.db.branches,
      asOf: store.now(),
      snapshotVersion: "test",
    },
    scope: "all",
    lookups: { ...store.db },
  };
  vi.mocked(chatApi.managed).mockResolvedValue({
    items: store.db.channels.filter((c) => c.kind === "channel"),
    page: 1,
    pageSize: 100,
    total: 4,
  });
  vi.mocked(chatApi.candidates).mockImplementation(async (branch) =>
    store.db.employees.filter(
      (e) =>
        branch === "all" ||
        e.owner ||
        e.memberships.some((m) => m.branchId === branch),
    ),
  );
  vi.mocked(chatApi.saveChannel).mockResolvedValue(store.db.channels[0]);
});
afterEach(() => {
  cleanup();
  clients.forEach((c) => c.clear());
  clients.length = 0;
  vi.restoreAllMocks();
});
function mount(search = "?detail=new") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const router = createMemoryRouter(
    [{ path: "*", element: <ChannelManagement /> }],
    { initialEntries: [`/app/all/settings${search}`] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
it("clears participants when the target branch changes", async () => {
  const user = mount();
  await user.selectOptions(await screen.findByLabelText("지점"), "gangnam");
  await user.selectOptions(screen.getByLabelText("참여 직원"), "junho");
  await user.selectOptions(screen.getByLabelText("지점"), "seongsu");
  expect(screen.getByLabelText("참여 직원")).toHaveValue([]);
  await waitFor(() =>
    expect(
      screen.queryByRole("option", { name: "박준호" }),
    ).not.toBeInTheDocument(),
  );
});
it("keeps the channel draft through a version conflict and resaves only edited fields", async () => {
  const base = store.get("channels", "gangnam");
  vi.mocked(chatApi.saveChannel).mockRejectedValueOnce(
    new ApiError(409, { code: "VERSION_CONFLICT", message: "충돌" }),
  );
  vi.mocked(chatApi.channel).mockResolvedValue({
    ...base,
    version: 8,
    description: "다른 관리자의 설명",
  });
  const user = mount("?tab=channels&detail=gangnam");
  const name = await screen.findByLabelText("채널 이름");
  await user.clear(name);
  await user.type(name, "내 채널 이름");
  await user.click(screen.getByRole("button", { name: "저장하기" }));
  await user.click(
    await screen.findByRole("button", { name: "최신 내용 확인" }),
  );
  await screen.findByText("다른 관리자의 설명");
  expect(name).toHaveValue("내 채널 이름");
  await user.click(
    screen.getByRole("button", { name: "최신 기준으로 다시 저장" }),
  );
  await waitFor(() => expect(chatApi.saveChannel).toHaveBeenCalledTimes(2));
  expect(vi.mocked(chatApi.saveChannel).mock.calls[1][1]).toEqual({
    name: "내 채널 이름",
    version: 8,
  });
});
it("does not load administration data for staff even with a direct detail URL", () => {
  context.value.session.user = store.get("employees", "junho");
  mount("?detail=gangnam");
  expect(screen.getByText("채널 관리 권한이 없어요")).toBeVisible();
  expect(chatApi.managed).not.toHaveBeenCalled();
});
