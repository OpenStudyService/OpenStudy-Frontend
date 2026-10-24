import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import type { CurrentUser } from "../../shared/domain/schema";
import { Login, PendingApproval } from "./Login";
import { Layout } from "../../app/Layout";

const state = vi.hoisted(() => ({
  data: undefined as CurrentUser | undefined,
  refetch: vi.fn(),
}));
vi.mock("../../app/context", () => ({
  useSession: () => ({
    data: state.data,
    isPending: false,
    error: null,
    refetch: state.refetch,
  }),
}));
vi.mock("../../shared/api/client", async (original) => ({
  ...(await original<typeof import("../../shared/api/client")>()),
  api: vi.fn(),
}));
const stamp = "2026-10-24T00:00:00Z";
function renderSession(element: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/entry"]}>
        <Routes>
          <Route path="/entry" element={element} />
          <Route path="/pending-approval" element={<PendingApproval />} />
          <Route path="/login" element={<h1>로그인 화면</h1>} />
          <Route path="/app/:scope/home" element={<h1>업무 공간</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.mocked(api).mockReset().mockResolvedValue({ ok: true });
  state.data = {
    user: {
      id: "20",
      branchId: "all",
      version: 1,
      createdAt: stamp,
      updatedAt: stamp,
      name: "승인 직원",
      nickname: "승인 직원",
      email: "approval@example.test",
      avatar: "",
      status: "활성",
      owner: false,
      memberships: [],
    },
    branches: [],
    asOf: stamp,
    snapshotVersion: "1",
    sessionMode: "APPROVAL_ONLY",
  };
});
afterEach(cleanup);

it("keeps an approved limited session out of the workspace until a new login", async () => {
  renderSession(<PendingApproval />);
  expect(
    screen.getByRole("heading", { name: "승인이 완료됐어요" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "업무 공간" }),
  ).not.toBeInTheDocument();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "다시 로그인" }));
  expect(
    await screen.findByRole("heading", { name: "로그인 화면" }),
  ).toBeVisible();
  expect(api).toHaveBeenCalledWith("/auth/logout", {
    method: "POST",
    body: {},
  });
});
it("routes an existing approval-only session from login to the approval screen", async () => {
  renderSession(<Login />);
  expect(
    await screen.findByRole("heading", { name: "승인이 완료됐어요" }),
  ).toBeVisible();
});
it("does not request work lookups when an approval-only session opens a work route", async () => {
  renderSession(<Layout />);
  expect(
    await screen.findByRole("heading", { name: "승인이 완료됐어요" }),
  ).toBeVisible();
  expect(api).not.toHaveBeenCalledWith(
    expect.stringContaining("/lookups"),
    expect.anything(),
  );
});
it("keeps existing active workspace sessions usable while another branch is pending", async () => {
  state.data!.sessionMode = "WORKSPACE";
  renderSession(<PendingApproval />);
  expect(
    await screen.findByRole("link", { name: "기존 지점 업무로 돌아가기" }),
  ).toBeVisible();
  await userEvent.click(
    screen.getByRole("link", { name: "기존 지점 업무로 돌아가기" }),
  );
  expect(
    await screen.findByRole("heading", { name: "업무 공간" }),
  ).toBeVisible();
});
