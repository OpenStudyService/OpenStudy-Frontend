import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { AppContext } from "../../app/context";
import { MockStore } from "../../mocks/store";
import { ApiError } from "../../shared/api/client";
import { Customers } from "./Customers";
import { customerApi } from "./api";
import type { Customer, CustomerListItem } from "./model";

const context = vi.hoisted(() => ({ value: {} as AppContext }));
vi.mock("../../app/context", () => ({ useApp: () => context.value }));
vi.mock("./api", () => ({
  customerApi: {
    list: vi.fn(),
    detail: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    changeStatus: vi.fn(),
  },
}));
let current: Customer;
const clients: QueryClient[] = [];
function listItem(): CustomerListItem {
  const {
    id,
    memberNo,
    name,
    phone,
    status,
    registeredBranchId,
    registeredAt,
  } = current;
  return {
    id,
    memberNo,
    name,
    phone,
    status,
    registeredBranchId,
    registeredAt,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  const store = new MockStore(false);
  context.value = {
    scope: "gangnam",
    session: {
      user: store.db.employees.find((person) => person.id === "owner")!,
      branches: store.db.branches,
      asOf: store.now(),
      snapshotVersion: "1",
    },
    lookups: {},
  } as AppContext;
  current = {
    id: "c1",
    version: 1,
    memberNo: "C0001",
    name: "기존 회원",
    phone: "01012345678",
    email: "private@example.test",
    memo: "상세 전용 응대 메모",
    status: "정상",
    statusReason: null,
    registeredBranchId: "gangnam",
    registeredAt: "2026-10-17T00:00:00Z",
    updatedAt: "2026-10-17T00:00:00Z",
    canEdit: true,
  };
  vi.mocked(customerApi.list).mockImplementation(async () => ({
    items: [listItem()],
    meta: { page: 1, pageSize: 20, total: 1 },
  }));
  vi.mocked(customerApi.detail).mockImplementation(async () => ({
    ...current,
  }));
  vi.mocked(customerApi.create).mockImplementation(async (_scope, body) => ({
    ...current,
    ...body,
    email: body.email ?? null,
    memo: body.memo ?? null,
  }));
  vi.mocked(customerApi.update).mockImplementation(
    async (_scope, _id, body) => {
      current = { ...current, ...body, version: current.version + 1 };
      return current;
    },
  );
  vi.mocked(customerApi.changeStatus).mockImplementation(
    async (_scope, _id, body) => {
      current = {
        ...current,
        status: body.status,
        statusReason: body.reason,
        version: current.version + 1,
      };
      return current;
    },
  );
});
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.restoreAllMocks();
});
function mount(search = "") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const router = createMemoryRouter(
    [{ path: "/app/:scope/members", element: <Customers /> }],
    { initialEntries: [`/app/gangnam/members${search}`] },
  );
  return {
    ...render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
    router,
    client,
  };
}
async function edit() {
  const view = mount("?detail=c1&edit=1");
  await screen.findByLabelText("회원 이름");
  return view;
}
const conflict = () =>
  new ApiError(409, {
    code: "VERSION_CONFLICT",
    message: "다른 사용자가 수정했습니다.",
  });

it("shows minimal list information and keeps detail closing separate from URL filters", async () => {
  const { router } = mount(
    "?q=기존&status=정상&sort=name&direction=asc&pageSize=50",
  );
  const table = await screen.findByRole("table", { name: "회원 목록" });
  await within(table).findByRole("button", { name: "기존 회원" });
  expect(within(table).queryByText(current.email!)).toBeNull();
  expect(within(table).queryByText(current.memo!)).toBeNull();
  expect(vi.mocked(customerApi.list).mock.calls[0][1]).toMatchObject({
    q: "기존",
    status: "정상",
    sort: "name",
    direction: "asc",
    pageSize: 50,
  });
  await userEvent.click(
    within(table).getByRole("button", { name: "기존 회원" }),
  );
  expect(await screen.findByText(current.memo!)).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "닫기" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(router.state.location.search).toContain("q=");
  expect(router.state.location.search).toContain("pageSize=50");
  expect(router.state.location.search).not.toContain("detail=");
});

it("requires an explicit registration branch in all scope and submits only canonical fields", async () => {
  context.value.scope = "all";
  mount("?detail=new");
  const form = await screen.findByRole("dialog");
  await userEvent.type(within(form).getByLabelText("회원 이름"), "새 회원");
  await userEvent.type(within(form).getByLabelText("연락처"), "010-9999-8888");
  await userEvent.click(
    within(form).getByRole("button", { name: "회원 등록" }),
  );
  expect(
    await within(form).findByText("등록 가능한 지점을 선택해 주세요."),
  ).toBeVisible();
  expect(customerApi.create).not.toHaveBeenCalled();
  await userEvent.selectOptions(
    within(form).getByLabelText("등록 지점"),
    "gangnam",
  );
  await userEvent.click(
    within(form).getByRole("button", { name: "회원 등록" }),
  );
  await waitFor(() => expect(customerApi.create).toHaveBeenCalledTimes(1));
  expect(vi.mocked(customerApi.create).mock.calls[0][1]).toEqual({
    registeredBranchId: "gangnam",
    name: "새 회원",
    phone: "01099998888",
    email: null,
    memo: null,
  });
  expect(vi.mocked(customerApi.create).mock.calls[0][3]).toBeTruthy();
});

it("does not expose registration or direct URL editing to a read-only user", async () => {
  const store = new MockStore(false);
  context.value.session.user = {
    ...store.db.employees.find((person) => person.id === "junho")!,
    memberships: [
      {
        branchId: "gangnam",
        role: "staff",
        status: "활성",
        permissions: [],
        version: 1,
      },
    ],
  };
  current = { ...current, canEdit: false };
  mount("?detail=c1&edit=1");
  await screen.findByRole("heading", {
    name: "이 회원을 수정할 권한이 없어요",
  });
  expect(screen.queryByRole("button", { name: "회원 등록" })).toBeNull();
  expect(screen.queryByLabelText("회원 이름")).toBeNull();
  expect(customerApi.update).not.toHaveBeenCalled();
});

it("preserves 422 inputs and points to the rejected field", async () => {
  vi.mocked(customerApi.update).mockRejectedValueOnce(
    new ApiError(422, {
      code: "VALIDATION_FAILED",
      message: "입력을 확인해 주세요.",
      fieldErrors: { name: "이 이름은 사용할 수 없어요." },
    }),
  );
  await edit();
  const input = screen.getByLabelText("회원 이름");
  await userEvent.clear(input);
  await userEvent.type(input, "입력 유지");
  await userEvent.click(screen.getByRole("button", { name: "저장하기" }));
  expect(await screen.findByText("이 이름은 사용할 수 없어요.")).toBeVisible();
  expect(input).toHaveValue("입력 유지");
  expect(input).toHaveAttribute("aria-invalid", "true");
});

it("compares a refreshed version before saving only the edited field", async () => {
  vi.mocked(customerApi.update).mockRejectedValueOnce(conflict());
  await edit();
  const phone = screen.getByLabelText("연락처");
  await userEvent.clear(phone);
  await userEvent.type(phone, "01055554444");
  await userEvent.click(screen.getByRole("button", { name: "저장하기" }));
  await screen.findByText("다른 사용자가 수정했습니다.");
  expect(phone).toHaveValue("01055554444");
  expect(screen.getByRole("button", { name: "저장하기" })).toBeDisabled();
  current = { ...current, version: 2, name: "다른 사용자의 이름" };
  await userEvent.click(screen.getByRole("button", { name: "최신 내용 확인" }));
  expect(await screen.findByText("다른 사용자의 이름")).toBeVisible();
  expect(phone).toHaveValue("01055554444");
  expect(customerApi.update).toHaveBeenCalledTimes(1);
  await userEvent.click(
    screen.getByRole("button", { name: "최신 기준으로 다시 저장" }),
  );
  await waitFor(() => expect(customerApi.update).toHaveBeenCalledTimes(2));
  expect(vi.mocked(customerApi.update).mock.calls[1][2]).toEqual({
    version: 2,
    phone: "01055554444",
  });
});

it("keeps the conflict blocked after latest lookup fails and permits another lookup", async () => {
  vi.mocked(customerApi.update).mockRejectedValueOnce(conflict());
  await edit();
  await userEvent.type(screen.getByLabelText("회원 이름"), " 수정");
  await userEvent.click(screen.getByRole("button", { name: "저장하기" }));
  await screen.findByText("다른 사용자가 수정했습니다.");
  vi.mocked(customerApi.detail).mockRejectedValueOnce(
    new Error("최신 조회 실패"),
  );
  await userEvent.click(screen.getByRole("button", { name: "최신 내용 확인" }));
  await screen.findByText("최신 조회 실패");
  expect(screen.getByRole("button", { name: "저장하기" })).toBeDisabled();
  expect(screen.getByLabelText("회원 이름")).toHaveValue("기존 회원 수정");
  await userEvent.click(screen.getByRole("button", { name: "최신 내용 확인" }));
  await screen.findByText("최신 회원 · 버전 1");
  expect(
    screen.getByRole("button", { name: "최신 기준으로 다시 저장" }),
  ).toBeEnabled();
});

it("requires a reason for a status change and does not send editable identity fields", async () => {
  mount("?detail=c1&action=status");
  await screen.findByLabelText("변경 사유");
  await userEvent.selectOptions(screen.getByLabelText("상태"), "이용 제한");
  await userEvent.click(screen.getByRole("button", { name: "상태 저장" }));
  expect(
    await screen.findByText("변경 사유를 1~500자로 입력해 주세요."),
  ).toBeVisible();
  expect(customerApi.changeStatus).not.toHaveBeenCalled();
  await userEvent.type(
    screen.getByLabelText("변경 사유"),
    "반복적인 규정 위반",
  );
  await userEvent.click(screen.getByRole("button", { name: "상태 저장" }));
  await waitFor(() =>
    expect(customerApi.changeStatus).toHaveBeenCalledTimes(1),
  );
  expect(vi.mocked(customerApi.changeStatus).mock.calls[0][2]).toEqual({
    version: 1,
    status: "이용 제한",
    reason: "반복적인 규정 위반",
  });
});

it("preserves dirty input when panel closing is cancelled", async () => {
  await edit();
  await userEvent.type(screen.getByLabelText("회원 이름"), " 미저장");
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await userEvent.click(screen.getByRole("button", { name: "닫기" }));
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText("회원 이름")).toHaveValue("기존 회원 미저장");
  confirm.mockReturnValue(true);
  await userEvent.click(screen.getByRole("button", { name: "닫기" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it.each([
  { mode: "edit=1", field: "회원 이름", value: " 미저장 입력" },
  { mode: "action=status", field: "변경 사유", value: "미저장 상태 사유" },
])(
  "preserves a dirty $field through a failed background detail refresh and retry",
  async ({ mode, field, value }) => {
    const { client } = mount(`?detail=c1&${mode}`);
    const input = await screen.findByLabelText(field);
    await userEvent.type(input, value);
    const draft = (input as HTMLInputElement).value;
    vi.mocked(customerApi.detail).mockRejectedValueOnce(
      new ApiError(503, {
        code: "SERVICE_UNAVAILABLE",
        message: "배경 조회 실패",
      }),
    );
    await act(async () => {
      await client.refetchQueries({
        queryKey: ["data", "owner", "gangnam", "customers", "detail", "c1"],
      });
    });
    await screen.findByText("배경 조회 실패");
    expect(screen.getByLabelText(field)).toHaveValue(draft);
    await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() =>
      expect(screen.queryByText("배경 조회 실패")).toBeNull(),
    );
    expect(screen.getByLabelText(field)).toHaveValue(draft);
  },
);

it("closes the editor when a background detail refresh denies access", async () => {
  const { client } = await edit();
  await userEvent.type(screen.getByLabelText("회원 이름"), " 미저장 입력");
  vi.mocked(customerApi.detail).mockRejectedValueOnce(
    new ApiError(404, {
      code: "NOT_FOUND",
      message: "조회 범위가 회수됐어요.",
    }),
  );
  await act(async () => {
    await client.refetchQueries({
      queryKey: ["data", "owner", "gangnam", "customers", "detail", "c1"],
    });
  });
  await screen.findByText("조회 범위가 회수됐어요.");
  expect(screen.queryByLabelText("회원 이름")).toBeNull();
  expect(screen.queryByLabelText("응대 메모")).toBeNull();
});

it("shows the latest detail after a conflicted draft is reverted without sending another PATCH", async () => {
  vi.mocked(customerApi.update).mockRejectedValueOnce(conflict());
  await edit();
  const phone = screen.getByLabelText("연락처");
  await userEvent.clear(phone);
  await userEvent.type(phone, "01055554444");
  await userEvent.click(screen.getByRole("button", { name: "저장하기" }));
  await screen.findByText("다른 사용자가 수정했습니다.");
  current = { ...current, version: 2, name: "최신 이름" };
  await userEvent.click(screen.getByRole("button", { name: "최신 내용 확인" }));
  await screen.findByText("최신 회원 · 버전 2");
  await userEvent.clear(phone);
  await userEvent.type(phone, "01012345678");
  await userEvent.click(
    screen.getByRole("button", { name: "최신 기준으로 다시 저장" }),
  );
  await screen.findByRole("heading", { name: "최신 이름" });
  expect(customerApi.update).toHaveBeenCalledTimes(1);
});
