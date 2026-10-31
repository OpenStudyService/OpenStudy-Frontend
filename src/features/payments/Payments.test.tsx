import {
  act,
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
import { api, ApiError } from "../../shared/api/client";
import { customerApi } from "../customers/api";
import { Payments } from "./Payments";
import { Passes } from "./Passes";
import { PassPanel } from "./PaymentPanels";
import {
  createPayment,
  getPass,
  getPayment,
  listPasses,
  listPayments,
  refundPayment,
} from "./api";
import type { Pass, Payment } from "./model";

const context = vi.hoisted(() => ({ value: {} as AppContext }));
vi.mock("../../app/context", () => ({ useApp: () => context.value }));
vi.mock("../../shared/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../shared/api/client")>()),
  api: vi.fn(),
}));
vi.mock("../customers/api", () => ({ customerApi: { list: vi.fn() } }));
vi.mock("./api", () => ({
  listPayments: vi.fn(),
  listPasses: vi.fn(),
  getPayment: vi.fn(),
  getPass: vi.fn(),
  createPayment: vi.fn(),
  refundPayment: vi.fn(),
}));
const clients: QueryClient[] = [];
let payment: Payment;
let pass: Pass;
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  const store = new MockStore(false);
  context.value = {
    scope: "gangnam",
    session: {
      user: store.db.employees.find((p) => p.id === "owner")!,
      branches: store.db.branches,
      asOf: store.now(),
      snapshotVersion: "1",
    },
    lookups: {},
  } as AppContext;
  payment = {
    id: "p1",
    version: 1,
    mock: true,
    purpose: "이용권",
    branchId: "gangnam",
    customer: { id: "c1", memberNo: "C001", name: "홍길동" },
    productId: "prod1",
    productName: "무기한 시간권",
    method: "카드",
    amountKrw: 12345,
    status: "승인",
    approvedAt: "2026-11-01T00:00:00Z",
    failedAt: null,
    createdAt: "2026-11-01T00:00:00Z",
    createdBy: { id: "owner", name: "관리자" },
    passId: "pass1",
    refund: null,
    canRefund: true,
  };
  pass = {
    id: "pass1",
    version: 1,
    customer: payment.customer,
    kind: "시간권",
    productId: "prod1",
    productName: "무기한 시간권",
    categoryName: "기본",
    terms: { includedMinutes: 600, validDays: null },
    remainingMinutes: 600,
    remainingCreditKrw: null,
    status: "활성",
    startedAt: "2026-11-01T00:00:00Z",
    expiresAt: null,
    purchaseBranchId: "gangnam",
    purchasePaymentId: "p1",
    createdAt: "2026-11-01T00:00:00Z",
    used: false,
    canRefund: true,
  };
  vi.mocked(customerApi.list).mockResolvedValue({
    items: [
      {
        id: "c1",
        memberNo: "C001",
        name: "홍길동",
        phone: "01012345678",
        status: "정상",
        registeredBranchId: "gangnam",
        registeredAt: "2026-11-01T00:00:00Z",
      },
    ],
    meta: { page: 1, pageSize: 20, total: 1 },
  });
  vi.mocked(api).mockResolvedValue({
    items: [
      {
        id: "prod1",
        name: "무기한 시간권",
        priceKrw: 9000,
        terms: { kind: "시간권", includedMinutes: 600, validDays: null },
        status: "판매 중",
        branchIds: ["gangnam"],
      },
    ],
    meta: { page: 1, pageSize: 20, total: 1 },
  });
  vi.mocked(listPayments).mockImplementation(async () => ({
    items: [payment],
    meta: { page: 1, pageSize: 20, total: 1 },
  }));
  vi.mocked(listPasses).mockImplementation(async () => ({
    items: [pass],
    meta: { page: 1, pageSize: 20, total: 1 },
  }));
  vi.mocked(getPayment).mockImplementation(async () => payment);
  vi.mocked(getPass).mockImplementation(async () => pass);
  vi.mocked(createPayment).mockImplementation(async () => payment);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  clients.forEach((c) => c.clear());
  clients.length = 0;
});
function mount(
  element: React.ReactNode,
  search = "",
  sessionUpdatedAt?: number,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  if (sessionUpdatedAt !== undefined)
    client.setQueryData(["session"], context.value.session, {
      updatedAt: sessionUpdatedAt,
    });
  const router = createMemoryRouter([{ path: "/", element }], {
    initialEntries: [`/${search}`],
  });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  };
}
async function fillSale() {
  const user = userEvent.setup();
  await screen.findByRole("option", { name: /홍길동/ });
  await screen.findByRole("option", { name: /무기한 시간권/ });
  await user.selectOptions(screen.getByLabelText("고객 선택"), "c1");
  await user.selectOptions(screen.getByLabelText("판매 상품"), "prod1");
  return user;
}

it("uses official Mock failure input, sends no amount and renders the server amount without an issued pass", async () => {
  payment = {
    ...payment,
    status: "실패",
    passId: null,
    approvedAt: null,
    failedAt: payment.createdAt,
    canRefund: false,
  };
  mount(<Payments />, "?detail=new");
  const user = await fillSale();
  await user.selectOptions(screen.getByLabelText("Mock 결제 결과"), "FAILED");
  await user.click(screen.getByRole("button", { name: "Mock 결제 요청" }));
  expect(
    await screen.findByText(
      "실패 결제를 기록했으며 이용권은 발급되지 않았어요.",
    ),
  ).toBeInTheDocument();
  expect(createPayment).toHaveBeenCalledWith(
    {
      customerId: "c1",
      branchId: "gangnam",
      productId: "prod1",
      method: "카드",
      mockOutcome: "FAILED",
    },
    expect.any(String),
  );
  expect(
    screen.getAllByText("Mock 결제·실제 금전 이동 없음").length,
  ).toBeGreaterThan(0);
  expect(screen.getByText("서버 산정 금액: 12,345원")).toBeInTheDocument();
  expect(screen.queryByLabelText(/금액/)).not.toBeInTheDocument();
});

it("keeps sale input and key after a network error, then retries the same intent", async () => {
  vi.mocked(createPayment).mockRejectedValueOnce(
    new ApiError(0, { code: "NETWORK_ERROR", message: "응답 유실" }),
  );
  mount(<Payments />, "?detail=new");
  const user = await fillSale();
  await user.click(screen.getByRole("button", { name: "Mock 결제 요청" }));
  await screen.findByRole("button", { name: "같은 결제 다시 시도" });
  expect(screen.getByLabelText("판매 상품")).toHaveValue("prod1");
  await user.click(screen.getByRole("button", { name: "같은 결제 다시 시도" }));
  await screen.findByText("이용권 발급을 완료했어요.");
  expect(vi.mocked(createPayment).mock.calls[0][1]).toBe(
    vi.mocked(createPayment).mock.calls[1][1],
  );
});

it("converts the selected Korean calendar dates into inclusive-start exclusive-end UTC filters", async () => {
  mount(<Payments />, "?from=2026-11-01&to=2026-11-02&status=승인");
  await waitFor(() =>
    expect(listPayments).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "2026-10-31T15:00:00.000Z",
        to: "2026-11-02T15:00:00.000Z",
        status: "승인",
      }),
      expect.anything(),
    ),
  );
});

it.each(["not-a-date", "2026-02-30"])(
  "rejects invalid date URL %s without throwing or making a list request",
  async (from) => {
    mount(<Payments />, `?from=${from}`);
    expect(
      await screen.findByText("올바른 결제 기간을 입력해 주세요"),
    ).toBeInTheDocument();
    expect(listPayments).not.toHaveBeenCalled();
  },
);

it("displays all pass units and explicit start and no-expiry values", async () => {
  const credit = {
    ...pass,
    id: "credit",
    kind: "정액권" as const,
    productName: "정액 이용권",
    remainingMinutes: null,
    remainingCreditKrw: 30000,
  };
  const period = {
    ...pass,
    id: "period",
    kind: "기간권" as const,
    productName: "기간 이용권",
    remainingMinutes: null,
    expiresAt: "2099-11-02T00:00:00Z",
  };
  vi.mocked(listPasses).mockResolvedValue({
    items: [pass, credit, period],
    meta: { page: 1, pageSize: 20, total: 3 },
  });
  mount(<Passes />);
  expect(await screen.findByText("600분")).toBeInTheDocument();
  expect(screen.getByText("30,000원")).toBeInTheDocument();
  expect(screen.getAllByText("만료 없음")).toHaveLength(2);
  expect(
    screen.getByRole("columnheader", { name: "시작 일시" }),
  ).toBeInTheDocument();
});

it("allows a write-only cashier to refund from a pass without reading payment detail", async () => {
  context.value.session.user = {
    ...context.value.session.user,
    owner: false,
    memberships: [
      { branchId: "gangnam", role: "staff", permissions: ["payments:write"] },
    ],
  };
  vi.mocked(refundPayment).mockResolvedValue({
    ...payment,
    status: "환불",
    canRefund: false,
    refund: {
      id: "r1",
      amountKrw: 12345,
      reason: "미사용 환불",
      refundedAt: "2026-11-01T00:01:00Z",
      processingBranchId: "gangnam",
      processedBy: payment.createdBy,
    },
  });
  mount(<PassPanel id="pass1" onClose={() => {}} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "전액 환불" }));
  await user.type(screen.getByLabelText("환불 사유"), "미사용 환불");
  await user.click(screen.getByRole("button", { name: "전액 환불 확정" }));
  expect(await screen.findByText("전액 환불 완료")).toBeInTheDocument();
  expect(refundPayment).toHaveBeenCalledWith(
    "p1",
    { reason: "미사용 환불" },
    expect.any(String),
    "gangnam",
  );
  expect(getPayment).not.toHaveBeenCalled();
});

it("retains the refund intent after an in-flight expiry/SSE update and lost response, while locking duplicate submits", async () => {
  let rejectFirst!: (error: Error) => void;
  const first = new Promise<Payment>((_resolve, reject) => {
    rejectFirst = reject;
  });
  const refunded: Payment = {
    ...payment,
    status: "환불",
    canRefund: false,
    refund: {
      id: "r1",
      amountKrw: 12345,
      reason: "동일 환불",
      refundedAt: "2026-11-01T00:01:00Z",
      processingBranchId: "gangnam",
      processedBy: payment.createdBy,
    },
  };
  vi.mocked(refundPayment)
    .mockReturnValueOnce(first)
    .mockResolvedValue(refunded);
  const onClose = vi.fn();
  const { client } = mount(<PassPanel id="pass1" onClose={onClose} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "전액 환불" }));
  const reason = screen.getByLabelText("환불 사유");
  await user.type(reason, "동일 환불");
  act(() => {
    fireEvent.submit(reason.closest("form")!);
    fireEvent.submit(reason.closest("form")!);
  });
  await waitFor(() => expect(refundPayment).toHaveBeenCalledTimes(1));
  await user.click(screen.getByRole("button", { name: "닫기" }));
  expect(onClose).not.toHaveBeenCalled();
  act(() => {
    client.setQueryData(
      [
        "data",
        context.value.session.user.id,
        "gangnam",
        "passes",
        "detail",
        "pass1",
      ],
      {
        ...pass,
        status: "환불",
        canRefund: false,
        expiresAt: "2020-01-01T00:00:00Z",
      },
    );
  });
  expect(screen.getByLabelText("환불 사유")).toBeInTheDocument();
  await act(async () => {
    rejectFirst(
      new ApiError(0, { code: "NETWORK_ERROR", message: "응답 유실" }),
    );
  });
  await user.click(
    await screen.findByRole("button", { name: "같은 환불 다시 시도" }),
  );
  expect(await screen.findByText("전액 환불 완료")).toBeInTheDocument();
  expect(vi.mocked(refundPayment).mock.calls[0][2]).toBe(
    vi.mocked(refundPayment).mock.calls[1][2],
  );
  await user.click(screen.getByRole("button", { name: "닫기" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it.each(["used", "expired", "other-branch"])(
  "hides refund for %s even when the cached hint says true",
  async (condition) => {
    if (condition === "used") pass.used = true;
    if (condition === "expired") pass.expiresAt = "2020-01-01T00:00:00Z";
    if (condition === "other-branch")
      context.value.session.user = {
        ...context.value.session.user,
        owner: false,
        memberships: [
          { branchId: "other", role: "staff", permissions: ["payments:write"] },
        ],
      };
    mount(<PassPanel id="pass1" onClose={() => {}} />);
    await screen.findByText("구매 지점");
    expect(
      screen.queryByRole("button", { name: "전액 환불" }),
    ).not.toBeInTheDocument();
  },
);

it("anchors refund expiry to the server clock despite a later client date and advances while the panel stays open", async () => {
  context.value.session.asOf = "2026-10-15T00:00:00Z";
  let clientNow = Date.parse("2026-11-10T00:00:00Z");
  vi.spyOn(Date, "now").mockImplementation(() => clientNow);
  pass.startedAt = context.value.session.asOf;
  pass.expiresAt = "2026-10-15T00:01:00Z";
  mount(<PassPanel id="pass1" onClose={() => {}} />);
  expect(
    await screen.findByRole("button", { name: "전액 환불" }),
  ).toBeInTheDocument();
  clientNow += 60001;
  await waitFor(
    () =>
      expect(
        screen.queryByRole("button", { name: "전액 환불" }),
      ).not.toBeInTheDocument(),
    { timeout: 2000 },
  );
});

it("includes cached session age when a panel is opened so time cannot move backwards", async () => {
  context.value.session.asOf = "2026-10-15T00:00:00Z";
  const clientNow = Date.parse("2026-11-10T00:00:00Z");
  vi.spyOn(Date, "now").mockReturnValue(clientNow);
  pass.startedAt = context.value.session.asOf;
  pass.expiresAt = "2026-10-15T00:00:30Z";
  mount(<PassPanel id="pass1" onClose={() => {}} />, "", clientNow - 60000);
  await screen.findByText("구매 지점");
  expect(
    screen.queryByRole("button", { name: "전액 환불" }),
  ).not.toBeInTheDocument();
});
