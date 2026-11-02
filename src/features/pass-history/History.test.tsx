import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppContext } from "../../app/context";
import { MockStore } from "../../mocks/store";
import { ApiError } from "../../shared/api/client";
import { AdjustmentForm } from "./AdjustmentForm";
import { CustomerHistory } from "./CustomerHistory";
import { getPass } from "../payments/api";
import type { Pass } from "../payments/model";
import { adjustPass, getCustomerHistory } from "./api";
const context = vi.hoisted(() => ({ value: {} as AppContext }));
vi.mock("../../app/context", () => ({ useApp: () => context.value }));
vi.mock("./api", () => ({ adjustPass: vi.fn(), getCustomerHistory: vi.fn() }));
vi.mock("../payments/api", () => ({ getPass: vi.fn() }));
let pass: Pass;
const clients: QueryClient[] = [];
const saved = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  const store = new MockStore(false);
  context.value = {
    scope: "gangnam",
    session: {
      user: store.db.employees[0],
      branches: store.db.branches,
      asOf: store.now(),
      snapshotVersion: "1",
    },
    lookups: {},
  } as AppContext;
  pass = {
    id: "p",
    version: 1,
    customer: { id: "c", memberNo: "C001", name: "고객" },
    kind: "시간권",
    productId: "product",
    productName: "100시간",
    categoryName: "시간",
    terms: { includedMinutes: 6000, validDays: null },
    remainingMinutes: 600,
    remainingCreditKrw: null,
    status: "활성",
    startedAt: "2026-11-01T00:00:00Z",
    expiresAt: null,
    purchaseBranchId: "gangnam",
    purchasePaymentId: "payment",
    createdAt: "2026-11-01T00:00:00Z",
    used: true,
    canRefund: false,
  };
  vi.mocked(getPass).mockImplementation(async () => pass);
  vi.mocked(adjustPass).mockImplementation(async () => pass);
});
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
});
function mount(element: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const router = createMemoryRouter([{ path: "*", element }]);
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}
function form() {
  return <AdjustmentForm pass={pass} onSaved={saved} onCancel={vi.fn()} />;
}
it("preserves edits on a version conflict and retries only changed fields against an explicitly read version", async () => {
  vi.mocked(adjustPass).mockRejectedValueOnce(
    new ApiError(409, {
      code: "VERSION_CONFLICT",
      message: "다른 사용자가 변경했어요",
    }),
  );
  mount(form());
  const user = userEvent.setup();
  await user.click(screen.getByLabelText("만료 없음"));
  fireEvent.change(screen.getByLabelText("조정 후 만료 일시 (한국 시각)"), {
    target: { value: "2027-01-01T09:00:00" },
  });
  await user.type(screen.getByLabelText("조정 사유 (필수)"), "기간 연장");
  await user.click(screen.getByRole("button", { name: "조정 저장" }));
  await screen.findByText(/다른 사용자가 변경/);
  expect(screen.getByLabelText("조정 사유 (필수)")).toHaveValue("기간 연장");
  expect(
    screen.getByRole("button", { name: "최신 버전에 조정 저장" }),
  ).toBeDisabled();
  pass = { ...pass, version: 2, remainingMinutes: 500 };
  await user.click(screen.getByRole("button", { name: "최신 이용권 확인" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "최신 버전에 조정 저장" }),
    ).toBeEnabled(),
  );
  await user.click(
    screen.getByRole("button", { name: "최신 버전에 조정 저장" }),
  );
  const body = vi.mocked(adjustPass).mock.calls[1][2];
  expect(body).toEqual({
    version: 2,
    reason: "기간 연장",
    expiresAt: "2027-01-01T00:00:00.000Z",
  });
  expect(saved).toHaveBeenCalledOnce();
});
it("reuses the first key and body after response loss, locks editing and blocks same-tick double submit", async () => {
  vi.mocked(adjustPass).mockRejectedValueOnce(
    new ApiError(0, { code: "NETWORK_ERROR", message: "응답 유실" }),
  );
  mount(form());
  const user = userEvent.setup();
  fireEvent.change(screen.getByLabelText("조정 후 남은 시간 (분)"), {
    target: { value: "700" },
  });
  await user.type(screen.getByLabelText("조정 사유 (필수)"), "전산 보정");
  fireEvent.submit(screen.getByRole("form", { name: "이용권 수동 조정" }));
  fireEvent.submit(screen.getByRole("form", { name: "이용권 수동 조정" }));
  await screen.findByText(/응답 유실/);
  expect(adjustPass).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("조정 후 남은 시간 (분)")).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "같은 조정 다시 시도" }));
  expect(adjustPass).toHaveBeenCalledTimes(2);
  const calls = vi.mocked(adjustPass).mock.calls;
  expect(calls[1][2]).toEqual(calls[0][2]);
  expect(calls[1][4]).toBe(calls[0][4]);
});
it("blocks a revoked or refunded pass and keeps period fields type-specific", () => {
  pass = {
    ...pass,
    kind: "기간권",
    status: "환불",
    expiresAt: "2027-01-01T00:00:00Z",
  };
  mount(form());
  expect(screen.queryByLabelText(/조정 후 남은/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText("만료 없음")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "조정 저장" })).toBeDisabled();
});
it("aborts a pending write on leaving without reporting a stale success", async () => {
  let done!: (pass: Pass) => void;
  vi.mocked(adjustPass).mockImplementation(
    () =>
      new Promise((resolve) => {
        done = resolve;
      }),
  );
  const view = mount(form());
  fireEvent.change(screen.getByLabelText("조정 후 남은 시간 (분)"), {
    target: { value: "700" },
  });
  fireEvent.change(screen.getByLabelText("조정 사유 (필수)"), {
    target: { value: "보정" },
  });
  fireEvent.submit(screen.getByRole("form", { name: "이용권 수동 조정" }));
  const signal = vi.mocked(adjustPass).mock.calls[0][3];
  view.unmount();
  expect(signal.aborted).toBe(true);
  done(pass);
  await waitFor(() => expect(saved).not.toHaveBeenCalled());
});
it("shows whole-ledger totals, redacts out-of-scope details, and sends explicit UTC filter boundaries", async () => {
  vi.mocked(getCustomerHistory).mockResolvedValue({
    customer: pass.customer,
    from: null,
    to: null,
    passes: [
      {
        passId: "p",
        kind: "시간권",
        productName: "100시간",
        status: "활성",
        purchaseBranchId: "gangnam",
        issuedMinutes: 600,
        issuedCreditKrw: null,
        ledgerMinutes: 100,
        ledgerKrw: 0,
        remainingMinutes: 700,
        remainingCreditKrw: null,
      },
    ],
    events: [
      {
        at: "2026-11-02T00:00:00Z",
        type: "이용",
        passId: "p",
        productName: "100시간",
        deltaMinutes: -30,
        deltaKrw: 0,
        usedMinutes: 30,
        branchId: "seongsu",
        paymentId: null,
        seatSessionId: null,
        actor: { id: "other", name: "숨길 처리자" },
        reason: "숨길 사유",
      },
    ],
  });
  mount(<CustomerHistory customerId="c" />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "구매·사용 내역 보기" }));
  await screen.findByRole("table", { name: "이용권 전체 원장 대조" });
  expect(screen.getByText("일치")).toBeVisible();
  expect(screen.queryByText(/숨길/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("조회 시작 (한국 시각, 포함)"), {
    target: { value: "2026-11-02T09:00:00" },
  });
  fireEvent.change(screen.getByLabelText("조회 종료 (한국 시각, 미포함)"), {
    target: { value: "2026-11-03T09:00:00" },
  });
  await user.click(screen.getByRole("button", { name: "기간 적용" }));
  await waitFor(() =>
    expect(getCustomerHistory).toHaveBeenLastCalledWith(
      "c",
      "gangnam",
      { from: "2026-11-02T00:00:00.000Z", to: "2026-11-03T00:00:00.000Z" },
      expect.any(AbortSignal),
    ),
  );
});
