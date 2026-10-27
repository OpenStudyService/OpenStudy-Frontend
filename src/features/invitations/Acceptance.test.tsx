import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InvitationAccept } from "./Acceptance";
import { api } from "../../shared/api/client";
import type { CurrentUser } from "../../shared/domain/schema";
const session = vi.hoisted(() => ({ data: null as CurrentUser | null }));
vi.mock("../../app/context", () => ({ useSession: () => session }));
vi.mock("../../shared/api/client", async (original) => ({
  ...(await original<typeof import("../../shared/api/client")>()),
  api: vi.fn(),
}));
const preview = {
  name: "직원",
  email: "new@example.test",
  branch: { id: "1", name: "강남" },
  role: "staff",
  expiresAt: "2026-10-25T00:00:00Z",
  acceptanceMode: "NEW_ACCOUNT",
};
beforeEach(() => {
  session.data = null;
  vi.mocked(api)
    .mockReset()
    .mockImplementation(async (path) =>
      path === "/invitations/preview"
        ? preview
        : { nextAction: "LOGIN_FOR_APPROVAL_STATUS" },
    );
});
afterEach(cleanup);
function mount(url = "/invitations/accept#token=secret-link") {
  const query = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={query}>
      <MemoryRouter initialEntries={[url]}>
        <InvitationAccept />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return query;
}
it("POSTs fragment token outside query keys and sends only the discriminated acceptance body", async () => {
  const query = mount();
  await screen.findByLabelText("새 계정 비밀번호");
  expect(api).toHaveBeenCalledWith(
    "/invitations/preview",
    expect.objectContaining({ method: "POST", body: { token: "secret-link" } }),
  );
  expect(JSON.stringify(query.getQueryCache().getAll())).not.toContain(
    "secret-link",
  );
  await userEvent.type(
    screen.getByLabelText("새 계정 비밀번호"),
    "secure-password",
  );
  await userEvent.click(screen.getByRole("button", { name: "초대 수락" }));
  expect(
    await screen.findByRole("heading", { name: "초대 수락이 완료됐어요" }),
  ).toBeVisible();
  expect(api).toHaveBeenCalledWith("/invitations/accept", {
    method: "POST",
    body: {
      mode: "NEW_ACCOUNT",
      token: "secret-link",
      email: preview.email,
      password: "secure-password",
    },
  });
});
it("does not read token from query parameters or call preview for missing fragment", async () => {
  mount("/invitations/accept?token=unsafe-query");
  await waitFor(() =>
    expect(
      screen.getByText("유효한 이메일 초대 링크를 다시 열어 주세요."),
    ).toBeVisible(),
  );
  expect(api).not.toHaveBeenCalled();
});

it("requires logout before accepting a new account from an existing session", async () => {
  session.data = { user: { email: "owner@example.test" } } as CurrentUser;
  const query = mount();
  await screen.findByRole("button", { name: "로그아웃하고 계속" });
  expect(screen.queryByLabelText("새 계정 비밀번호")).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "로그아웃하고 계속" }),
  );
  await waitFor(() => expect(query.getQueryData(["session"])).toBeNull());
  expect(api).toHaveBeenCalledWith("/auth/logout", {
    method: "POST",
    body: {},
  });
  expect(api).not.toHaveBeenCalledWith(
    "/invitations/accept",
    expect.anything(),
  );
  expect(JSON.stringify(query.getQueryCache().getAll())).not.toContain(
    "secret-link",
  );
});

it("accepts an existing account without sending a password or changing other branch sessions", async () => {
  session.data = { user: { email: preview.email } } as CurrentUser;
  vi.mocked(api).mockImplementation(async (path) =>
    path === "/invitations/preview"
      ? { ...preview, acceptanceMode: "EXISTING_ACCOUNT" }
      : { nextAction: "REFRESH_APPROVAL_STATUS" },
  );
  mount();
  await screen.findByRole("button", { name: "초대 수락" });
  expect(screen.queryByLabelText("새 계정 비밀번호")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "초대 수락" }));
  expect(api).toHaveBeenCalledWith("/invitations/accept", {
    method: "POST",
    body: {
      mode: "EXISTING_ACCOUNT",
      token: "secret-link",
      email: preview.email,
    },
  });
  expect(api).not.toHaveBeenCalledWith("/auth/logout", expect.anything());
});

it("keeps another branch invitation blocked until the first approval and relogin", async () => {
  session.data = {
    user: { email: preview.email },
    sessionMode: "APPROVAL_ONLY",
  } as CurrentUser;
  vi.mocked(api).mockImplementation(async () => ({
    ...preview,
    acceptanceMode: "EXISTING_ACCOUNT",
  }));
  mount();
  await screen.findByText(/첫 지점의 최종 승인 후 다시 로그인해야/);
  expect(screen.getByRole("button", { name: "초대 수락" })).toBeDisabled();
  expect(api).not.toHaveBeenCalledWith(
    "/invitations/accept",
    expect.anything(),
  );
});
