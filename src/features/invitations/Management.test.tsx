import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InvitationManagement } from "./Management";
import { api } from "../../shared/api/client";
import type { CurrentUser } from "../../shared/domain/schema";
const context = vi.hoisted(() => ({
  session: {} as CurrentUser,
  scope: "gangnam",
}));
vi.mock("../../app/context", () => ({ useApp: () => context }));
vi.mock("../../shared/api/client", async (original) => ({
  ...(await original<typeof import("../../shared/api/client")>()),
  api: vi.fn(),
}));
beforeEach(() => {
  context.session = {
    user: {
      id: "manager",
      owner: false,
      memberships: [
        { branchId: "gangnam", role: "admin", permissions: ["people:manage"] },
      ],
    } as CurrentUser["user"],
    branches: [
      { id: "gangnam", name: "강남", status: "운영 중" },
    ] as CurrentUser["branches"],
    sessionMode: "WORKSPACE",
    asOf: "now",
    snapshotVersion: "1",
  };
  vi.mocked(api).mockResolvedValue({
    items: [
      {
        id: "1",
        version: 2,
        name: "관리자",
        email: "manager@example.test",
        branchId: "gangnam",
        role: "admin",
        status: "승인 대기",
        delivery: "발송 완료",
        expiresAt: "2026-10-25T00:00:00Z",
        rejectionReason: null,
      },
    ],
    meta: { page: 1, pageSize: 20, total: 1 },
  });
});
afterEach(cleanup);
function mount() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <InvitationManagement />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
it("separates delivery from approval status and hides manager invitation commands from a branch manager", async () => {
  mount();
  await screen.findByRole("button", { name: "초대 상세: 관리자" });
  expect(screen.getByText("발송 완료", { exact: true })).toBeVisible();
  expect(
    screen.queryByRole("option", { name: "지점 관리자" }),
  ).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "초대 상세: 관리자" }),
  );
  expect(
    screen.getByText("지점 관리자 초대 처리는 사장님만 할 수 있습니다."),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "최종 승인" }),
  ).not.toBeInTheDocument();
});
it("sends STAFF's explicit empty default permissions and fixed selected branch", async () => {
  mount();
  await screen.findByRole("button", { name: "초대 상세: 관리자" });
  await userEvent.type(screen.getByLabelText("초대 이름"), "새 직원");
  await userEvent.type(
    screen.getByLabelText("초대 이메일 (발송 후 변경 불가)"),
    "staff@example.test",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "초대 이메일 발송 요청" }),
  );
  expect(api).toHaveBeenCalledWith(
    "/invitations",
    expect.objectContaining({
      method: "POST",
      body: {
        name: "새 직원",
        email: "staff@example.test",
        branchId: "gangnam",
        role: "staff",
        permissions: [],
      },
      key: expect.any(String),
    }),
  );
});
