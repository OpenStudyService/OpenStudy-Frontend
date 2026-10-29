import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CategoryManagement } from "./Categories";
import { loadCategory } from "./hooks";
import { api, ApiError } from "../../shared/api/client";
import type { ProductCategory } from "./model";

const context = vi.hoisted(() => ({
  session: {
    user: { id: "owner", owner: true, status: "활성", memberships: [] },
  },
  scope: "all",
}));
vi.mock("../../app/context", () => ({ useApp: () => context }));
vi.mock("../../shared/api/client", async (original) => ({
  ...(await original<typeof import("../../shared/api/client")>()),
  api: vi.fn(),
}));
let current: ProductCategory;
const clients: QueryClient[] = [];
const writes = () =>
  vi.mocked(api).mock.calls.filter(([, o]) => o?.method === "PATCH");
beforeEach(() => {
  vi.resetAllMocks();
  current = {
    id: "category-1",
    code: "TIME",
    name: "시간권",
    kind: "시간권",
    status: "활성",
    version: 1,
    createdAt: "",
    updatedAt: "",
  };
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (options?.method === "PATCH") {
      const body = options.body as { version: number; name: string };
      if (body.version !== current.version)
        throw new ApiError(409, {
          code: "VERSION_CONFLICT",
          message: "다른 사용자가 수정했습니다.",
          latestVersion: current.version,
        });
      current = { ...current, name: body.name, version: current.version + 1 };
      return current;
    }
    if (path.startsWith("/product-categories?"))
      return {
        items: [{ ...current }],
        meta: { page: 1, pageSize: 100, total: 1 },
      };
    throw new Error(`unexpected ${path}`);
  });
});
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
});
async function edit() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const view = render(
    <QueryClientProvider client={client}>
      <CategoryManagement />
    </QueryClientProvider>,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "분류 수정: 시간권" }),
  );
  const input = screen.getByLabelText("분류 이름 변경");
  await userEvent.clear(input);
  await userEvent.type(input, "내가 작성한 이름");
  return { ...view, input };
}
async function conflict() {
  const view = await edit();
  current = {
    ...current,
    version: 2,
    name: "다른 관리자의 이름",
    status: "비활성",
  };
  await userEvent.click(screen.getByRole("button", { name: "이름 저장" }));
  await screen.findByText("다른 사용자가 수정했습니다.");
  return view;
}
it("preserves a conflicted draft and saves its name against the explicitly loaded version only", async () => {
  const { input } = await conflict();
  expect(input).toHaveValue("내가 작성한 이름");
  expect(screen.getByRole("button", { name: "이름 저장" })).toBeDisabled();
  await userEvent.click(
    screen.getByRole("button", { name: "최신 버전 확인 (입력 유지)" }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "다른 관리자의 이름 / 비활성 (v2)",
  );
  expect(input).toHaveValue("내가 작성한 이름");
  expect(writes()).toHaveLength(1);
  await userEvent.click(
    screen.getByRole("button", { name: "최신 기준으로 이름 저장" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("form", { name: "분류 이름 편집" })).toBeNull(),
  );
  expect(writes().at(-1)?.[1]?.body).toEqual({
    version: 2,
    name: "내가 작성한 이름",
  });
  expect(current.status).toBe("비활성");
});
it("keeps the draft and save blocked when loading the latest version fails, then allows retry", async () => {
  const { input } = await conflict();
  vi.mocked(api).mockRejectedValueOnce(new Error("일시적 조회 실패"));
  await userEvent.click(
    screen.getByRole("button", { name: "최신 버전 확인 (입력 유지)" }),
  );
  await screen.findByText("일시적 조회 실패");
  expect(input).toHaveValue("내가 작성한 이름");
  expect(screen.getByRole("button", { name: "이름 저장" })).toBeDisabled();
  expect(writes()).toHaveLength(1);
  await userEvent.click(
    screen.getByRole("button", { name: "최신 버전 확인 (입력 유지)" }),
  );
  await screen.findByText(/다른 관리자의 이름 \/ 비활성 \(v2\)/);
  expect(
    screen.getByRole("button", { name: "최신 기준으로 이름 저장" }),
  ).toBeEnabled();
});
it("requires another comparison if a second conflict occurs after the latest copy was loaded", async () => {
  const { input } = await conflict();
  await userEvent.click(
    screen.getByRole("button", { name: "최신 버전 확인 (입력 유지)" }),
  );
  await screen.findByRole("status");
  current = { ...current, version: 3, name: "다시 수정된 이름" };
  await userEvent.click(
    screen.getByRole("button", { name: "최신 기준으로 이름 저장" }),
  );
  await screen.findByText("다른 사용자가 수정했습니다.");
  expect(screen.getByRole("button", { name: "이름 저장" })).toBeDisabled();
  expect(screen.queryByText(/최신 서버 내용:/)).toBeNull();
  expect(input).toHaveValue("내가 작성한 이름");
  expect(writes()).toHaveLength(2);
});
it("locks repeated submissions synchronously and aborts the request when the editor leaves", async () => {
  const view = await edit();
  let finish!: (value: ProductCategory) => void;
  vi.mocked(api).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const form = screen.getByRole("form", { name: "분류 이름 편집" });
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(writes()).toHaveLength(1);
  const signal = writes()[0][1]!.signal!;
  view.unmount();
  expect(signal.aborted).toBe(true);
  finish(current);
  await Promise.resolve();
});
it("finds the exact category through the existing paged list contract, never a nonexistent detail route", async () => {
  const signal = new AbortController().signal;
  vi.mocked(api).mockResolvedValueOnce({
    items: [{ ...current, id: "other" }],
    meta: { page: 1, pageSize: 1, total: 2 },
  });
  vi.mocked(api).mockResolvedValueOnce({
    items: [current],
    meta: { page: 2, pageSize: 1, total: 2 },
  });
  expect(await loadCategory(current, signal)).toEqual(current);
  expect(
    vi
      .mocked(api)
      .mock.calls.map(([path]) =>
        new URL(path, "http://localhost").searchParams.get("page"),
      ),
  ).toEqual(["1", "2"]);
  expect(
    vi
      .mocked(api)
      .mock.calls.every(
        ([path, o]) =>
          path.startsWith("/product-categories?") && o?.signal === signal,
      ),
  ).toBe(true);
});
