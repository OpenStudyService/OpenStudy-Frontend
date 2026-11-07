import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AppContext } from "../../app/context";
import { MockStore } from "../../mocks/store";
import { ApiError } from "../../shared/api/client";
import { lockerApi } from "./api";
import { LockerPanel } from "./LockerPanel";
import { AssignmentPanel, AssignmentInfo } from "./AssignmentPanel";
import { Lockers } from "./Lockers";
import type { Locker, LockerAssignment } from "./model";

const context = vi.hoisted(() => ({ value: {} as AppContext }));
vi.mock("../../app/context", () => ({ useApp: () => context.value }));
vi.mock("./api", () => ({
  lockerApi: {
    lockers: vi.fn(),
    locker: vi.fn(),
    occupancy: vi.fn(),
    createLocker: vi.fn(),
    updateLocker: vi.fn(),
    lockerStatus: vi.fn(),
    applyRate: vi.fn(),
    assignments: vi.fn(),
    assignment: vi.fn(),
    createAssignment: vi.fn(),
    extend: vi.fn(),
    returnLocker: vi.fn(),
  },
}));
vi.mock("../payments/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../payments/shared")>()),
  CustomerSelector: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (id: string) => void;
  }) => (
    <label>
      고객 선택
      <select
        aria-label="고객 선택"
        value={value}
        required
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">선택</option>
        <option value="c1">고객</option>
      </select>
    </label>
  ),
}));
let locker: Locker, assignment: LockerAssignment;
const clients: QueryClient[] = [];
beforeEach(() => {
  vi.resetAllMocks();
  const store = new MockStore(false);
  store.persona = "owner";
  context.value = {
    scope: "gangnam",
    session: {
      user: store.user(),
      branches: store.db.branches,
      asOf: "2026-11-03T03:00:00Z",
      snapshotVersion: "test",
    },
    lookups: { ...store.db },
  };
  locker = {
    id: "l1",
    branchId: "gangnam",
    version: 1,
    lockerNo: "L-01",
    ratePer4WeeksKrw: 10000,
    status: "사용 가능",
    assignmentState: "사용 가능",
    activeAssignment: null,
  };
  assignment = {
    id: "a1",
    branchId: "gangnam",
    version: 1,
    status: "배정",
    locker: { id: "l1", lockerNo: "L-01" },
    customer: { id: "c1", memberNo: "C1", name: "고객" },
    startDate: "2026-11-03",
    endDate: "2026-12-01",
    overdue: false,
    returnedAt: null,
    assignedBy: { id: "owner", name: "사장님" },
    lastChangedBy: null,
    reason: null,
    charges: [
      {
        id: "ch1",
        kind: "최초",
        startDate: "2026-11-03",
        endDate: "2026-12-01",
        terms: 1,
        ratePer4WeeksKrw: 10000,
        amountKrw: 10000,
        status: "적용",
        paymentId: "p1",
        createdAt: "2026-11-03T03:00:00Z",
        appliedAt: "2026-11-03T03:00:00Z",
      },
    ],
    createdAt: "2026-11-03T03:00:00Z",
    updatedAt: "2026-11-03T03:00:00Z",
  };
  vi.mocked(lockerApi.locker).mockResolvedValue(locker);
  vi.mocked(lockerApi.lockers).mockResolvedValue({
    items: [locker],
    meta: { page: 1, pageSize: 20, total: 1 },
  });
  vi.mocked(lockerApi.occupancy).mockResolvedValue({
    items: [
      {
        branchId: "gangnam",
        total: 1,
        available: 1,
        blocked: 0,
        inUse: 0,
        overdue: 0,
        asOf: "2026-11-03T03:00:00Z",
      },
    ],
  });
  vi.mocked(lockerApi.assignment).mockResolvedValue(assignment);
  vi.mocked(lockerApi.assignments).mockResolvedValue({
    items: [assignment],
    meta: { page: 1, pageSize: 20, total: 1 },
  });
});
afterEach(() => {
  cleanup();
  clients.forEach((c) => c.clear());
  clients.length = 0;
  vi.restoreAllMocks();
});
function mount(element: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return { ...render(element, { wrapper }), user: userEvent.setup(), client };
}
async function selectCustomer(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(await screen.findByLabelText("고객 선택"), "c1");
}
it("keeps 28-day paid input and same request key after response loss; displays only the returned amount", async () => {
  vi.mocked(lockerApi.createAssignment)
    .mockRejectedValueOnce(
      new ApiError(0, { code: "NETWORK_ERROR", message: "응답 유실" }),
    )
    .mockResolvedValue({
      ...assignment,
      endDate: "2026-12-29",
      charges: [{ ...assignment.charges![0], amountKrw: 23456 }],
    });
  const { user } = mount(
    <AssignmentPanel id="new" lockerId="l1" onClose={vi.fn()} />,
  );
  await selectCustomer(user);
  await user.clear(screen.getByLabelText("이용 기간 (4주 단위)"));
  await user.type(screen.getByLabelText("이용 기간 (4주 단위)"), "2");
  expect(screen.getByText(/2026-11-03 ~ 2026-12-29/)).toBeVisible();
  expect(screen.queryByText(/20,000/)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Mock 결제 후 배정" }));
  await screen.findByText("응답 유실");
  expect(screen.getByLabelText("이용 기간 (4주 단위)")).toHaveValue(2);
  await user.click(screen.getByRole("button", { name: "Mock 결제 후 배정" }));
  await screen.findByText(/23,456원/);
  const calls = vi.mocked(lockerApi.createAssignment).mock.calls;
  expect(calls[0][1]).toEqual({
    branchId: "gangnam",
    lockerId: "l1",
    customerId: "c1",
    startDate: "2026-11-03",
    endDate: "2026-12-29",
    method: "카드",
    mockOutcome: "APPROVED",
  });
  expect(calls[0][3]).toBe(calls[1][3]);
});
it("uses a synchronous submit lock and distinguishes successful HTTP with a failed payment", async () => {
  let resolve!: (value: LockerAssignment) => void;
  vi.mocked(lockerApi.createAssignment).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const { user } = mount(
    <AssignmentPanel id="new" lockerId="l1" onClose={vi.fn()} />,
  );
  await selectCustomer(user);
  const form = screen
    .getByRole("button", { name: "Mock 결제 후 배정" })
    .closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(lockerApi.createAssignment).toHaveBeenCalledTimes(1);
  await act(async () =>
    resolve({
      ...assignment,
      status: "결제 실패",
      charges: [{ ...assignment.charges![0], status: "실패", appliedAt: null }],
    }),
  );
  expect(
    await screen.findByText(
      /Mock 결제 실패: 이용 기간과 점유는 추가되지 않았습니다/,
    ),
  ).toBeVisible();
});
it("keeps period-conflict input, reloads actual assignment periods, and does not offer version comparison", async () => {
  vi.mocked(lockerApi.createAssignment).mockRejectedValue(
    new ApiError(409, { code: "LOCKER_PERIOD_CONFLICT", message: "기간 충돌" }),
  );
  const { user } = mount(
    <AssignmentPanel id="new" lockerId="l1" onClose={vi.fn()} />,
  );
  await selectCustomer(user);
  await user.click(screen.getByRole("button", { name: "Mock 결제 후 배정" }));
  await screen.findByRole("region", { name: "최신 사물함 배정 현황" });
  expect(screen.getByLabelText("고객 선택")).toHaveValue("c1");
  expect(
    screen.queryByRole("button", { name: "최신 내용 확인" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "배정 현황 다시 조회" }));
  await waitFor(() => expect(lockerApi.assignments).toHaveBeenCalledTimes(2));
});
it("keeps 422 fields and displays field errors", async () => {
  vi.mocked(lockerApi.updateLocker).mockRejectedValue(
    new ApiError(422, {
      code: "VALIDATION_ERROR",
      message: "입력 확인",
      fieldErrors: { lockerNo: "중복 번호" },
    }),
  );
  const { user } = mount(
    <LockerPanel id="l1" onClose={vi.fn()} onAssignment={vi.fn()} />,
  );
  await user.click(await screen.findByRole("button", { name: "수정하기" }));
  await user.clear(screen.getByLabelText("사물함 번호"));
  await user.type(screen.getByLabelText("사물함 번호"), "NEW");
  await user.click(screen.getByRole("button", { name: "저장" }));
  await screen.findByText(/중복 번호/);
  expect(screen.getByLabelText("사물함 번호")).toHaveValue("NEW");
});
it("compares a version conflict then patches only the user's changed locker field", async () => {
  vi.mocked(lockerApi.updateLocker)
    .mockRejectedValueOnce(
      new ApiError(409, { code: "VERSION_CONFLICT", message: "버전 충돌" }),
    )
    .mockResolvedValue({
      ...locker,
      version: 3,
      lockerNo: "NEW",
      ratePer4WeeksKrw: 15000,
    });
  const { user } = mount(
    <LockerPanel id="l1" onClose={vi.fn()} onAssignment={vi.fn()} />,
  );
  await user.click(await screen.findByRole("button", { name: "수정하기" }));
  await user.clear(screen.getByLabelText("사물함 번호"));
  await user.type(screen.getByLabelText("사물함 번호"), "NEW");
  await user.click(screen.getByRole("button", { name: "저장" }));
  await screen.findByText("버전 충돌");
  expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  vi.mocked(lockerApi.locker).mockResolvedValue({
    ...locker,
    version: 2,
    ratePer4WeeksKrw: 15000,
  });
  await user.click(screen.getByRole("button", { name: "최신 내용 확인" }));
  await screen.findByRole("heading", { name: "최신 서버 내용" });
  await user.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(lockerApi.updateLocker).toHaveBeenCalledTimes(2));
  expect(vi.mocked(lockerApi.updateLocker).mock.calls[1][2]).toEqual({
    version: 2,
    lockerNo: "NEW",
  });
});
it("does not shift an extension onto a changed server end date after comparison", async () => {
  vi.mocked(lockerApi.extend).mockRejectedValue(
    new ApiError(409, { code: "VERSION_CONFLICT", message: "버전 충돌" }),
  );
  const { user } = mount(
    <AssignmentPanel id="a1" lockerId="l1" onClose={vi.fn()} />,
  );
  await user.click(await screen.findByRole("button", { name: "유료 연장" }));
  await user.click(screen.getByRole("button", { name: "Mock 결제 후 연장" }));
  await screen.findByText("버전 충돌");
  vi.mocked(lockerApi.assignment).mockResolvedValue({
    ...assignment,
    version: 2,
    endDate: "2026-12-29",
  });
  await user.click(screen.getByRole("button", { name: "최신 내용 확인" }));
  await screen.findByText(/서버의 종료일이 변경되었습니다/);
  expect(
    screen.getByRole("button", { name: "Mock 결제 후 연장" }),
  ).toBeDisabled();
  expect(vi.mocked(lockerApi.extend).mock.calls[0][2].endDate).toBe(
    "2026-12-29",
  );
});
it("lets a branch employee return on a stopped branch without payment visibility or management", async () => {
  const store = new MockStore(false);
  store.persona = "junho";
  context.value.session.user = store.user();
  context.value.session.branches = context.value.session.branches.map((b) => ({
    ...b,
    status: "운영 중지",
  }));
  vi.mocked(lockerApi.locker).mockResolvedValue({
    ...locker,
    status: "운영 중단",
    assignmentState: "운영 중단",
  });
  vi.mocked(lockerApi.assignment).mockResolvedValue({
    ...assignment,
    charges: null,
  });
  vi.mocked(lockerApi.returnLocker).mockResolvedValue({
    ...assignment,
    status: "반납",
    returnedAt: "2026-11-03T03:00:00Z",
    charges: null,
  });
  const { user } = mount(
    <AssignmentPanel id="a1" lockerId="l1" onClose={vi.fn()} />,
  );
  await user.click(await screen.findByRole("button", { name: "반납 처리" }));
  expect(
    screen.queryByRole("button", { name: "유료 연장" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/10,000원/)).not.toBeInTheDocument();
  expect(screen.getByText(/조기 반납에 따른 환불은 없습니다/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "환불 없이 반납 확정" }));
  await screen.findByText(/반납 처리되었습니다/);
  expect(vi.mocked(lockerApi.returnLocker).mock.calls[0][2]).toEqual({
    version: 1,
  });
});
it("does not disclose non-null cached charges after the payment grant is revoked", () => {
  const store = new MockStore(false);
  store.persona = "junho";
  context.value.session.user = store.user();
  mount(<AssignmentInfo assignment={assignment} />);
  expect(screen.queryByText(/10,000원/)).not.toBeInTheDocument();
  expect(screen.queryByText("서버 확정 결제 내역")).not.toBeInTheDocument();
});
it("retains the original return version while a refresh observes its committed outcome", async () => {
  vi.mocked(lockerApi.returnLocker)
    .mockRejectedValueOnce(
      new ApiError(0, { code: "NETWORK_ERROR", message: "응답 유실" }),
    )
    .mockResolvedValue({
      ...assignment,
      version: 2,
      status: "반납",
      returnedAt: "2026-11-03T03:00:00Z",
    });
  const { user, client } = mount(
    <AssignmentPanel id="a1" lockerId="l1" onClose={vi.fn()} />,
  );
  await user.click(await screen.findByRole("button", { name: "반납 처리" }));
  await user.type(screen.getByLabelText("반납 사유 (선택)"), "반납");
  await user.click(screen.getByRole("button", { name: "환불 없이 반납 확정" }));
  await screen.findByText("응답 유실");
  await act(async () =>
    client.setQueryData(
      [
        "data",
        context.value.session.user.id,
        "gangnam",
        "locker-assignments",
        "detail",
        "a1",
      ],
      {
        ...assignment,
        version: 2,
        status: "반납",
        returnedAt: "2026-11-03T03:00:00Z",
      },
    ),
  );
  expect(screen.getByLabelText("반납 사유 (선택)")).toHaveValue("반납");
  await user.click(screen.getByRole("button", { name: "환불 없이 반납 확정" }));
  await screen.findByText(/반납 처리되었습니다/);
  expect(vi.mocked(lockerApi.returnLocker).mock.calls.map((c) => c[2])).toEqual(
    [
      { version: 1, reason: "반납" },
      { version: 1, reason: "반납" },
    ],
  );
});
it("hides management on denied access and ignores a late response after scope change", async () => {
  let resolve!: (value: LockerAssignment) => void;
  vi.mocked(lockerApi.createAssignment).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const { user, rerender } = mount(<Lockers />);
  await user.click(await screen.findByRole("button", { name: "L-01" }));
  await user.click(await screen.findByRole("button", { name: "유료 배정" }));
  await selectCustomer(user);
  await user.click(screen.getByRole("button", { name: "Mock 결제 후 배정" }));
  context.value = { ...context.value, scope: "seongsu" };
  vi.mocked(lockerApi.locker).mockRejectedValue(
    new ApiError(404, { code: "NOT_FOUND", message: "접근 불가" }),
  );
  rerender(<Lockers />);
  await screen.findByText("접근 불가");
  await act(async () => resolve(assignment));
  expect(
    screen.queryByText("Mock 결제가 적용되었습니다."),
  ).not.toBeInTheDocument();
});
it("bulk-applies a selected branch rate with no assignment amount and refreshes occupancy alongside the list", async () => {
  vi.mocked(lockerApi.applyRate).mockResolvedValue({
    updated: 8,
    ratePer4WeeksKrw: 15000,
  });
  const { user } = mount(<Lockers />);
  await screen.findByRole("button", { name: "L-01" });
  await user.click(screen.getByRole("button", { name: "새로고침" }));
  await waitFor(() => expect(lockerApi.occupancy).toHaveBeenCalledTimes(2));
  expect(lockerApi.lockers).toHaveBeenCalledTimes(2);
  await user.click(screen.getByRole("button", { name: "지점 요금 일괄 적용" }));
  await user.clear(screen.getByLabelText("4주 요금 (원)"));
  await user.type(screen.getByLabelText("4주 요금 (원)"), "15000");
  await user.click(screen.getByRole("button", { name: "요금 일괄 적용" }));
  await waitFor(() => expect(lockerApi.applyRate).toHaveBeenCalled());
  expect(vi.mocked(lockerApi.applyRate).mock.calls[0].slice(0, 2)).toEqual([
    "gangnam",
    { ratePer4WeeksKrw: 15000 },
  ]);
});
