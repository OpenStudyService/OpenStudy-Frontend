import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InvitationManagement } from "./Management";
import { api, ApiError } from "../../shared/api/client";
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
  const invitation = {
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
  };
  vi.mocked(api)
    .mockReset()
    .mockImplementation(async (path) =>
      path.startsWith("/invitations/1?")
        ? invitation
        : {
            items: [invitation],
            meta: { page: 1, pageSize: 20, total: 1 },
          },
    );
});
afterEach(cleanup);
function mount() {
  const query = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={query}>
      <MemoryRouter>
        <InvitationManagement />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return query;
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
    await screen.findByText("지점 관리자 초대 처리는 사장님만 할 수 있습니다."),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "최종 승인" }),
  ).not.toBeInTheDocument();
});

it("refreshes an open invitation detail after workspace invalidation without reopening it", async () => {
  context.session.user.owner = true;
  let detail = {
    id: "1",
    version: 2,
    name: "직원",
    email: "staff@example.test",
    branchId: "gangnam",
    role: "staff",
    status: "초대 대기",
    delivery: "발송 대기",
    expiresAt: "2026-10-25T00:00:00Z",
    rejectionReason: null,
  };
  vi.mocked(api).mockImplementation(async (path) =>
    path.startsWith("/invitations/1?")
      ? detail
      : { items: [detail], meta: { page: 1, pageSize: 20, total: 1 } },
  );
  const query = mount();
  await userEvent.click(
    await screen.findByRole("button", { name: "초대 상세: 직원" }),
  );
  await screen.findByText("초대 대기 · 발송 대기 · 버전 2");
  detail = {
    ...detail,
    version: 3,
    status: "승인 대기",
    delivery: "발송 완료",
  };
  await query.invalidateQueries({ queryKey: ["data", "manager", "gangnam"] });
  expect(
    await screen.findByText("승인 대기 · 발송 완료 · 버전 3"),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "최종 승인" })).toBeEnabled();
  expect(
    screen.queryByRole("button", { name: "초대 취소" }),
  ).not.toBeInTheDocument();
});

it("keeps the rejection reason across a conflict and uses the explicitly refreshed version", async () => {
  context.session.user.owner = true;
  let detail = {
    id: "1",
    version: 2,
    name: "직원",
    email: "staff@example.test",
    branchId: "gangnam",
    role: "staff",
    status: "승인 대기",
    delivery: "발송 완료",
    expiresAt: "2026-10-25T00:00:00Z",
    rejectionReason: null as string | null,
  };
  let rejectAttempts = 0;
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.startsWith("/invitations/1/reject")) {
      if (rejectAttempts++ === 0)
        throw new ApiError(409, {
          code: "VERSION_CONFLICT",
          message: "다른 변경이 있습니다.",
        });
      detail = {
        ...detail,
        version: 4,
        status: "거절",
        rejectionReason: "일정 확인 필요",
      };
      return detail;
    }
    return path.startsWith("/invitations/1?")
      ? detail
      : { items: [detail], meta: { page: 1, pageSize: 20, total: 1 } };
  });
  mount();
  await userEvent.click(
    await screen.findByRole("button", { name: "초대 상세: 직원" }),
  );
  const reason = await screen.findByLabelText("반려 사유");
  await userEvent.type(reason, "일정 확인 필요");
  await userEvent.click(screen.getByRole("button", { name: "초대 반려" }));
  await screen.findByText("다른 변경이 있습니다.");
  detail = { ...detail, version: 3 };
  await userEvent.click(
    screen.getByRole("button", { name: "최신 버전 확인 (입력 유지)" }),
  );
  await screen.findByText("승인 대기 · 발송 완료 · 버전 3");
  expect(reason).toHaveValue("일정 확인 필요");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "초대 반려" })).toBeEnabled(),
  );
  await userEvent.click(screen.getByRole("button", { name: "초대 반려" }));
  expect(api).toHaveBeenCalledWith(
    "/invitations/1/reject?scope=gangnam",
    expect.objectContaining({
      method: "POST",
      body: { version: 3, reason: "일정 확인 필요" },
    }),
  );
  expect(await screen.findByText("거절 · 발송 완료 · 버전 4")).toBeVisible();
});

it("ignores a late detail response after another invitation is selected", async () => {
  context.session.user.owner = true;
  const first = {
    id: "1",
    version: 2,
    name: "첫 직원",
    email: "first@example.test",
    branchId: "gangnam",
    role: "staff",
    status: "초대 대기",
    delivery: "발송 대기",
    expiresAt: "2026-10-25T00:00:00Z",
    rejectionReason: null,
  };
  const second = {
    ...first,
    id: "2",
    name: "다음 직원",
    version: 3,
    status: "승인 대기",
    delivery: "발송 완료",
  };
  let finishFirst!: (value: typeof first) => void;
  const firstResponse = new Promise<typeof first>((resolve) => {
    finishFirst = resolve;
  });
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.startsWith("/invitations/1?")) return firstResponse;
    if (path.startsWith("/invitations/2?")) return second;
    return {
      items: [first, second],
      meta: { page: 1, pageSize: 20, total: 2 },
    };
  });
  mount();
  await userEvent.click(
    await screen.findByRole("button", { name: "초대 상세: 첫 직원" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "초대 상세: 다음 직원" }),
  );
  await screen.findByRole("heading", { name: "다음 직원 초대 처리" });
  finishFirst(first);
  await firstResponse;
  await waitFor(() =>
    expect(
      screen.getByRole("heading", { name: "다음 직원 초대 처리" }),
    ).toBeVisible(),
  );
  expect(
    screen.queryByRole("heading", { name: "첫 직원 초대 처리" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "최종 승인" })).toBeEnabled();
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
