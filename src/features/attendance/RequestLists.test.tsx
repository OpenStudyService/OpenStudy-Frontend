import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { RequestList } from "./RequestLists";

vi.mock("../../app/context", () => ({
  useApp: () => ({
    scope: "gangnam",
    session: { user: { id: "owner" } },
    lookups: { branches: [{ id: "gangnam", name: "강남점" }] },
  }),
}));
afterEach(cleanup);

it.each([
  ["approve", "승인", "신청", "primary"],
  ["reject", "반려", "신청", "danger"],
  ["cancel", "신청 취소", "신청", "danger"],
  ["cancel-approval", "승인 취소", "승인", "danger"],
] as const)(
  "distinguishes %s while preserving command version and rejection reason",
  async (action, label, status, variant) => {
    const row = {
      id: "req1",
      branchId: "gangnam",
      version: 4,
      status,
      reason: "신청 사유",
      createdAt: "2026-11-18T00:00:00Z",
      decision: null,
      cancellation: null,
      canApprove: action === "approve",
      canReject: action === "reject",
      canCancel: action === "cancel",
      canCancelApproval: action === "cancel-approval",
    };
    const service = {
      list: vi
        .fn()
        .mockResolvedValue({ items: [row], page: 1, pageSize: 20, total: 1 }),
      command: vi.fn().mockResolvedValue(row),
    };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RequestList
          resource="corrections"
          service={service}
          title="정정 요청"
          effects={[]}
          rejectReason
        >
          {() => <p>요청 내용</p>}
        </RequestList>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    const button = await screen.findByRole("button", {
      name: label,
    });
    expect(button).toHaveClass(variant);
    await user.click(button);
    if (action === "reject") {
      expect(service.command).not.toHaveBeenCalled();
      const confirm = screen.getByRole("button", { name: "반려 확정" });
      expect(confirm).toHaveClass("danger");
      expect(confirm).toBeDisabled();
      await user.type(screen.getByLabelText("반려 사유"), "확인 필요");
      await user.click(confirm);
    }
    expect(service.command).toHaveBeenCalledWith("req1", action, {
      version: 4,
      ...(action === "reject" ? { reason: "확인 필요" } : {}),
    });
  },
);
