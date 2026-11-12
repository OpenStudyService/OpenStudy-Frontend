import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CurrentUser } from "../../shared/domain/schema";
import { api, ApiError } from "../../shared/api/client";
import { AuditLog } from "./AuditLog";
import { AuditEventDetail } from "./AuditDetail";
import type { AuditDetail, AuditEvent, AuditPage } from "./audit-model";
import { Settings } from "./Settings";

const context = vi.hoisted(() => ({
  session: {} as CurrentUser,
  scope: "all",
}));
vi.mock("../../app/context", () => ({ useApp: () => context }));
vi.mock("../../shared/api/client", async (original) => ({
  ...(await original<typeof import("../../shared/api/client")>()),
  api: vi.fn(),
  MOCK: false,
}));
vi.mock("./ProfileForm", () => ({ ProfileForm: () => <div>프로필 폼</div> }));
vi.mock("../auth/Login", () => ({ ThemePicker: () => <div>테마 선택</div> }));

const item: AuditEvent = {
  id: "5",
  occurredAt: "2026-11-11T01:00:00Z",
  action: "UPDATE_PROFILE",
  result: "SUCCESS",
  entityType: "employee",
  entityId: "20",
  reason: null,
  requestId: "req-fixture",
  actor: null,
  branch: null,
  hasChanges: true,
};
const detail: AuditDetail = {
  ...item,
  before: { profile: { name: "이전", removed: true }, token: "***" },
  after: { profile: { name: "이후", added: true }, token: "***" },
};
const page: AuditPage = {
  items: [item],
  meta: { page: 1, pageSize: 2, total: 3 },
  period: { from: "2026-11-05", to: "2026-11-11" },
};
const clients: QueryClient[] = [];
beforeEach(() => {
  context.scope = "all";
  context.session = {
    user: {
      id: "10",
      branchId: "all",
      version: 1,
      createdAt: "2026-11-11T00:00:00Z",
      updatedAt: "2026-11-11T00:00:00Z",
      name: "직원",
      nickname: "직원",
      email: "owner@example.test",
      avatar: "",
      owner: true,
      status: "활성",
      memberships: [],
    },
    branches: [],
    asOf: "2026-11-11T00:00:00Z",
    snapshotVersion: "1",
    sessionMode: "WORKSPACE",
  };
  vi.mocked(api).mockImplementation(async (path) =>
    path.startsWith("/audit-events/") ? detail : page,
  );
});
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.mocked(api).mockReset();
});

function show(path = "/app/all/audit") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const router = createMemoryRouter(
    [
      {
        path: "/app/:scope",
        children: [
          { path: "home", element: <div>홈</div> },
          { path: "settings", element: <Settings /> },
          { path: "audit", element: <AuditLog /> },
          { path: "spaces", element: <div>공간 관리</div> },
          { path: "branches", element: <div>지점 관리</div> },
        ],
      },
    ],
    { initialEntries: ["/app/1/home", path] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, client };
}

it.each(["manager", "staff"])(
  "denies old and new audit links for %s",
  async (role) => {
    context.session.user.owner = false;
    context.session.user.memberships = [
      {
        branchId: "1",
        role: role === "manager" ? "admin" : "staff",
        permissions: [],
      },
    ];
    const { router } = show("/app/1/settings?tab=audit&detail=5");
    expect(screen.getByText("변경 이력을 볼 권한이 없어요")).toBeVisible();
    expect(router.state.location.pathname).toBe("/app/1/settings");
    await act(() => router.navigate("/app/1/audit?detail=5"));
    expect(screen.getByText("변경 이력을 볼 권한이 없어요")).toBeVisible();
    expect(api).not.toHaveBeenCalled();
  },
);

it("keeps personal controls at the plain settings address", () => {
  show("/app/1/settings");
  expect(screen.getByRole("heading", { name: "개인 설정" })).toBeVisible();
  expect(screen.getByText("프로필 폼")).toBeVisible();
  expect(screen.getByRole("heading", { name: "비밀번호 변경" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "알림 범위" })).toBeNull();
  expect(api).not.toHaveBeenCalled();
});

it.each([
  [
    "tab=audit&requestId=req-fixture&detail=5&page=2&status=unused&branchSearch=ignored",
    "/app/1/audit",
    { requestId: "req-fixture", page: "2", detail: "5" },
  ],
  [
    "tab=rooms&status=ready&page=3&detail=room-1&branchSearch=ignored&requestId=ignored",
    "/app/1/spaces",
    { tab: "rooms", status: "ready", page: "3", detail: "room-1" },
  ],
  [
    "branchSearch=강남&branchPage=2&status=unused&detail=ignored",
    "/app/1/branches",
    { branchSearch: "강남", branchPage: "2" },
  ],
])(
  "replaces a legacy settings entry and keeps destination parameters (%s)",
  async (query, pathname, expected) => {
    const { router } = show("/app/1/settings?" + query);
    await waitFor(() => expect(router.state.location.pathname).toBe(pathname));
    expect(
      Object.fromEntries(new URLSearchParams(router.state.location.search)),
    ).toEqual(expected);
    expect(router.state.historyAction).toBe("REPLACE");
    if (pathname === "/app/1/audit") {
      expect(
        await screen.findByRole("dialog", { name: "변경 이력 상세" }),
      ).toBeVisible();
    }
    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe("/app/1/home");
  },
);

it("restores filters from the address, excludes UI queries, and displays the response period", async () => {
  show(
    "/app/all/audit?scope=all&sort=name&q=ignored&from=2026-11-07&action=UPDATE_PROFILE&entityType=employee&entityId=20&actorEmployeeId=10&branchId=1&result=SUCCESS&requestId=req-fixture&pageSize=2",
  );
  expect(
    await screen.findByText(/적용 기간.*2026-11-05 ~ 2026-11-11/),
  ).toBeVisible();
  const request = new URL(
    vi.mocked(api).mock.calls[0][0],
    "https://example.test",
  );
  expect(request.searchParams.get("from")).toBe("2026-11-07");
  expect(request.searchParams.get("entityType")).toBe("employee");
  for (const key of ["scope", "sort", "q", "tab", "detail"])
    expect(request.searchParams.has(key)).toBe(false);
  expect(screen.getByLabelText("행위")).toHaveValue("UPDATE_PROFILE");
  expect(screen.getByLabelText("작업자 ID")).toHaveValue("10");
  expect(screen.getByText("시스템 / 알 수 없음")).toBeVisible();
  expect(screen.getByText("변경 내용 있음")).toBeVisible();
});

it("updates URL search conditions and uses the response meta for pagination", async () => {
  vi.mocked(api).mockImplementation(async (path) => {
    const query = new URL(path, "https://example.test").searchParams;
    return {
      ...page,
      meta: { ...page.meta, page: Number(query.get("page") || 1) },
    };
  });
  const { router } = show("/app/all/audit?pageSize=2");
  await screen.findByText("변경 내용 있음");
  fireEvent.change(screen.getByLabelText("행위"), {
    target: { value: "LOGIN_FAILED" },
  });
  fireEvent.click(screen.getByRole("button", { name: "검색" }));
  await waitFor(() =>
    expect(router.state.location.search).toContain("action=LOGIN_FAILED"),
  );
  expect(router.state.location.search).toContain("page=1");
  fireEvent.click(await screen.findByRole("button", { name: "다음" }));
  await waitFor(() => expect(router.state.location.search).toContain("page=2"));
  expect(router.state.location.search).toContain("action=LOGIN_FAILED");
  expect(router.state.location.search).toContain("pageSize=2");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "다음" })).toBeDisabled(),
  );
});

it("links details and searches the same request using the displayed period", async () => {
  const { router } = show("/app/all/audit?action=UPDATE_PROFILE&detail=5");
  const dialog = await screen.findByRole("dialog", { name: "변경 이력 상세" });
  expect(await within(dialog).findByText("profile › name")).toBeVisible();
  expect(within(dialog).getByText("추가")).toBeVisible();
  expect(within(dialog).getByText("삭제")).toBeVisible();
  expect(within(dialog).getByText("변경", { exact: true })).toBeVisible();
  expect(within(dialog).getAllByText("***")).toHaveLength(2);
  fireEvent.click(
    within(dialog).getByRole("button", { name: "같은 요청 보기" }),
  );
  await waitFor(() =>
    expect(router.state.location.search).toContain("requestId=req-fixture"),
  );
  const query = new URLSearchParams(router.state.location.search);
  expect(query.get("from")).toBe(page.period.from);
  expect(query.get("to")).toBe(page.period.to);
  expect(query.has("action")).toBe(false);
  expect(query.has("detail")).toBe(false);
  expect(query.has("tab")).toBe(false);
  expect(router.state.location.pathname).toBe("/app/all/audit");
});

it.each([
  [null, { name: "created" }, "변경 후", "변경 전"],
  [{ name: "deleted" }, null, "변경 전", "변경 후"],
] as const)(
  "shows the populated side of a one-sided snapshot",
  (before, after, visible, hidden) => {
    render(
      <AuditEventDetail
        event={{ ...detail, before, after }}
        onSameRequest={vi.fn()}
      />,
    );
    expect(screen.getByRole("columnheader", { name: visible })).toBeVisible();
    expect(screen.queryByRole("columnheader", { name: hidden })).toBeNull();
  },
);

it("validates long periods and dependent entity filters before sending a search", async () => {
  const { router } = show();
  await screen.findByText("변경 내용 있음");
  vi.mocked(api).mockClear();
  fireEvent.change(screen.getByLabelText("시작일"), {
    target: { value: "2026-01-01" },
  });
  fireEvent.change(screen.getByLabelText("종료일"), {
    target: { value: "2026-04-03" },
  });
  fireEvent.click(screen.getByRole("button", { name: "검색" }));
  expect(screen.getByRole("alert")).toHaveTextContent("92일");
  expect(api).not.toHaveBeenCalled();
  expect(router.state.location.search).toBe("");
  fireEvent.change(screen.getByLabelText("시작일"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("종료일"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("대상 ID"), {
    target: { value: "20" },
  });
  fireEvent.click(screen.getByRole("button", { name: "검색" }));
  expect(screen.getByRole("alert")).toHaveTextContent("대상 유형");
  expect(api).not.toHaveBeenCalled();
});

it.each([403, 404, 422])("shows a %s API error", async (status) => {
  vi.mocked(api).mockRejectedValue(
    new ApiError(status, {
      code:
        status === 422
          ? "PERIOD_TOO_LONG"
          : status === 403
            ? "FORBIDDEN"
            : "NOT_FOUND",
      message: "서버 오류",
      ...(status === 422 ? { fieldErrors: { to: "기간을 줄여 주세요." } } : {}),
    }),
  );
  show();
  expect(
    await screen.findByText(
      status === 403
        ? "변경 이력을 볼 권한이 없어요"
        : status === 404
          ? "감사 기록을 찾을 수 없어요"
          : "조회 기간은 최대 92일입니다. 기간을 줄여 주세요.",
    ),
  ).toBeVisible();
});

it("reports a missing record in a directly linked detail", async () => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.startsWith("/audit-events/"))
      throw new ApiError(404, { code: "NOT_FOUND", message: "없음" });
    return page;
  });
  show("/app/all/audit?detail=999");
  expect(await screen.findByText("감사 기록을 찾을 수 없어요")).toBeVisible();
});
