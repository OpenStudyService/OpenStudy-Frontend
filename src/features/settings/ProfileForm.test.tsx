import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, ApiError } from "../../shared/api/client";
import type { CurrentUser } from "../../shared/domain/schema";
import { useUi } from "../../app/store";
import { ProfileForm } from "./ProfileForm";

const state = vi.hoisted(() => ({ session: {} as CurrentUser }));
vi.mock("../../app/context", () => ({ useApp: () => state }));
vi.mock("../../shared/api/client", async (original) => ({
  ...(await original<typeof import("../../shared/api/client")>()),
  api: vi.fn(),
}));
const clients: QueryClient[] = [];
beforeEach(() => {
  vi.mocked(api).mockReset();
  useUi.getState().clearPrivate();
  state.session = {
    user: {
      id: "10",
      branchId: "all",
      version: 1,
      createdAt: "2026-10-26T00:00:00Z",
      updatedAt: "2026-10-26T00:00:00Z",
      name: "직원 이름",
      nickname: "이전 별명",
      email: "staff@example.test",
      avatar: "https://example.test/photo.png",
      owner: true,
      status: "활성",
      memberships: [],
    },
    branches: [],
    asOf: "2026-10-26T00:00:00Z",
    snapshotVersion: "employee-10-0",
    sessionMode: "WORKSPACE",
  };
});
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
});
function setup() {
  const query = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(query);
  query.setQueryData(["session"], structuredClone(state.session));
  const view = render(
    <StrictMode>
      <QueryClientProvider client={query}>
        <ProfileForm />
      </QueryClientProvider>
    </StrictMode>,
  );
  return { query, user: userEvent.setup(), ...view };
}
function updated(nickname = "새 별명", version = 2) {
  return {
    ...structuredClone(state.session),
    user: { ...state.session.user, nickname, version },
    snapshotVersion: `employee-10-${version - 1}`,
  };
}
async function edit(
  user: ReturnType<typeof userEvent.setup>,
  nickname = "새 별명",
) {
  await user.clear(screen.getByLabelText("닉네임"));
  await user.type(screen.getByLabelText("닉네임"), nickname);
}
async function save(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "프로필 저장" }));
}

it.each(["owner", "manager", "staff"])(
  "saves only nickname/version for %s and caches the server's result",
  async (role) => {
    state.session.user.owner = role === "owner";
    state.session.user.memberships =
      role === "owner"
        ? []
        : [
            {
              branchId: "1",
              role: role === "manager" ? "admin" : "staff",
              permissions: [],
            },
          ];
    const { user, query } = setup();
    vi.mocked(api).mockResolvedValueOnce(updated("서버 정규화 별명"));
    await edit(user);
    await save(user);
    expect(api).toHaveBeenCalledWith(
      "/me/profile",
      expect.objectContaining({
        method: "PATCH",
        body: { nickname: "새 별명", version: 1 },
      }),
    );
    expect(vi.mocked(api).mock.calls[0][1]?.signal?.aborted).toBe(false);
    await waitFor(() =>
      expect(screen.getByLabelText("닉네임")).toHaveValue("서버 정규화 별명"),
    );
    expect(query.getQueryData<CurrentUser>(["session"])?.user.nickname).toBe(
      "서버 정규화 별명",
    );
    expect(useUi.getState().notice).toBe("프로필을 저장했어요.");
    expect(screen.getByText("staff@example.test")).toBeVisible();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      state.session.user.avatar,
    );
    vi.mocked(api).mockResolvedValueOnce(updated("연속 저장", 3));
    await edit(user, "연속 저장");
    await save(user);
    expect(api).toHaveBeenLastCalledWith(
      "/me/profile",
      expect.objectContaining({ body: { nickname: "연속 저장", version: 2 } }),
    );
  },
);

it.each([422, 500, 0])(
  "keeps input and omits success on a %s failure",
  async (status) => {
    const { user, query } = setup();
    vi.mocked(api).mockRejectedValueOnce(
      new ApiError(status, {
        code: "FAILURE",
        message: "저장 실패",
        requestId: "profile-error",
        ...(status === 422
          ? { fieldErrors: { nickname: "서버 필드 오류" } }
          : {}),
      }),
    );
    await edit(user);
    await save(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("profile-error");
    expect(screen.getByLabelText("닉네임")).toHaveValue("새 별명");
    if (status === 422) {
      expect(screen.getByLabelText("닉네임")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(screen.getByRole("alert")).toHaveTextContent("서버 필드 오류");
    }
    expect(query.getQueryData<CurrentUser>(["session"])?.user.nickname).toBe(
      "이전 별명",
    );
    expect(useUi.getState().notice).toBe("");
    expect(api).toHaveBeenCalledTimes(1);
  },
);

it("preserves a dirty version through background refreshes and explicitly recovers a conflict", async () => {
  const { user, query, rerender } = setup();
  await edit(user, "내 미저장 입력");
  state.session = updated("다른 화면 별명", 5);
  query.setQueryData(["session"], state.session);
  rerender(
    <StrictMode>
      <QueryClientProvider client={query}>
        <ProfileForm />
      </QueryClientProvider>
    </StrictMode>,
  );
  vi.mocked(api).mockRejectedValueOnce(
    new ApiError(409, {
      code: "VERSION_CONFLICT",
      message: "충돌",
      requestId: "conflict-request",
      latestVersion: 5,
      reloadUrl: "/api/me",
    }),
  );
  await save(user);
  expect(api).toHaveBeenLastCalledWith(
    "/me/profile",
    expect.objectContaining({
      body: { nickname: "내 미저장 입력", version: 1 },
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "conflict-request",
  );
  expect(screen.getByLabelText("닉네임")).toHaveValue("내 미저장 입력");
  vi.mocked(api).mockResolvedValueOnce(state.session);
  await user.click(
    screen.getByRole("button", { name: "최신 버전 확인 (입력 유지)" }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent("다른 화면 별명");
  expect(screen.getByLabelText("닉네임")).toHaveValue("내 미저장 입력");
  expect(api).toHaveBeenCalledTimes(2);
  vi.mocked(api).mockResolvedValueOnce(updated("내 미저장 입력", 6));
  await save(user);
  expect(api).toHaveBeenLastCalledWith(
    "/me/profile",
    expect.objectContaining({
      body: { nickname: "내 미저장 입력", version: 5 },
    }),
  );
});

it("does not send a blank nickname or save from a restricted session", async () => {
  const { user } = setup();
  await edit(user, "   ");
  await save(user);
  expect(await screen.findByRole("alert")).toHaveTextContent("1~100자");
  expect(api).not.toHaveBeenCalled();
  cleanup();
  state.session.sessionMode = "APPROVAL_ONLY";
  setup();
  expect(screen.getByRole("button", { name: "프로필 저장" })).toBeDisabled();
  expect(screen.getByLabelText("닉네임")).toBeDisabled();
});

it("rechecks the session on 403 and never restores a cleared session with a late success", async () => {
  const { user, query } = setup();
  const invalidate = vi.spyOn(query, "invalidateQueries");
  vi.mocked(api).mockRejectedValueOnce(
    new ApiError(403, { code: "FORBIDDEN", message: "접근 제한" }),
  );
  await edit(user);
  await save(user);
  await screen.findByRole("alert");
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["session"] });
  let finish!: (value: CurrentUser) => void;
  vi.mocked(api).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await save(user);
  query.setQueryData(["session"], null);
  await act(async () => finish(updated()));
  expect(query.getQueryData(["session"])).toBeNull();
  expect(useUi.getState().notice).toBe("");
});
