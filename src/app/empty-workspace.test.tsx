import type { components } from "../shared/api/foundation.generated";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  within,
  waitFor,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { createAppQueryClient } from "./queryClient";
import { Layout } from "./Layout";
import { Home } from "../features/home/Home";
import { ResourcePage } from "../features/records/ResourcePage";
import { Sales } from "../features/analysis/Sales";
import type { CurrentUser } from "../shared/domain/schema";
const session: CurrentUser = {
  user: {
    id: "owner",
    branchId: "all",
    version: 1,
    createdAt: "2026-10-23T00:00:00Z",
    updatedAt: "2026-10-23T00:00:00Z",
    email: "owner@example.com",
    name: "관리자",
    nickname: "관리자",
    avatar: "",
    owner: true,
    status: "활성",
    memberships: [],
  },
  branches: [],
  asOf: "2026-10-23T00:00:00Z",
  snapshotVersion: "test-1",
};
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.unstubAllGlobals();
});

function renderWorkspace(
  respond: (path: string, url: URL) => Response | Promise<Response>,
  route = "/app/all/home",
  current = session,
) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const path = new URL(url, "http://localhost").pathname;
      return Promise.resolve(
        path === "/api/me"
          ? Response.json(current)
          : respond(path, new URL(url, "http://localhost")),
      );
    }),
  );
  const client = createAppQueryClient();
  client.setQueryDefaults(["data"], { gcTime: 0 });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={[route.startsWith("/") ? route : `/app/all/${route}`]}
      >
        <Routes>
          <Route path="/app/:scope" element={<Layout />}>
            <Route path="home" element={<Home />} />
            <Route path="tasks" element={<ResourcePage resource="tasks" />} />
            <Route path="sales" element={<Sales />} />
          </Route>
          <Route path="/login" element={<p>로그인 화면</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

type HomeSummary = components["schemas"]["HomeSummary"];

function emptySummary(mine = false): HomeSummary {
  const emptyRatio = {
    state: "notApplicable",
    percent: null,
    numerator: 0,
    denominator: 0,
  } as const;
  const counts = {
    total: 0,
    open: 0,
    overdue: 0,
    completedToday: 0,
    completionRate: emptyRatio,
  };
  const source = (operationId: string) => ({
    operationId,
    query: { scope: "all" },
    clientFilter: null,
  });
  const link = (
    screen: components["schemas"]["HomeLink"]["screen"],
    query: Record<string, string> = {},
  ) => ({ screen, branchId: null, targetId: null, query });
  return {
    closures: [],
    meta: {
      branchIds: [],
      allBranches: true,
      date: "2026-10-23",
      asOf: session.asOf,
      dayStart: "2026-10-22T15:00:00Z",
      dayEnd: "2026-10-23T15:00:00Z",
      timeZone: "Asia/Seoul",
      taskFilter: { mine, assigneeId: null, defaulted: true },
    },
    seats: {
      total: 0,
      inUse: 0,
      available: 0,
      blocked: 0,
      occupancy: emptyRatio,
      branches: [],
      link: link("seat-board"),
      source: source("getSeatOccupancy"),
    },
    tasks: {
      today: counts,
      mine: counts,
      items: [],
      link: link("task-list", mine ? { mine: "true" } : {}),
      sources: [],
    },
    inquiries: {
      unresolved: 0,
      received: 0,
      inProgress: 0,
      items: [],
      link: link("inquiry-list"),
      source: source("getInquirySummary"),
    },
    facilities: {
      inspectionDue: 0,
      items: [],
      link: link("facility-list", { inspectionDue: "true" }),
      source: source("getFacilitySummary"),
    },
    shifts: {
      count: 0,
      items: [],
      colleagueCount: 0,
      colleagues: [],
      link: link("shift-list", { from: "2026-10-23", to: "2026-10-23" }),
      source: source("listShifts"),
    },
    notices: {
      items: [],
      link: link("notice-list", { status: "게시 중" }),
      source: source("listNotices"),
    },
  };
}

it("renders empty summary cards without loading any chat data", async () => {
  renderWorkspace((path) =>
    Response.json(path === "/api/home/summary" ? emptySummary() : {}),
  );
  expect(await screen.findByText("완료율 해당 없음")).toBeVisible();
  expect(screen.getByText("해당 없음", { exact: true })).toBeVisible();
  for (const title of [
    "오늘 배정된 미완료 업무가 없어요",
    "등록된 점검 항목이 없어요",
    "미처리 문의가 없어요",
    "오늘 예정된 근무가 없어요",
    "등록된 공지사항이 없어요",
  ]) {
    expect(screen.getByRole("heading", { name: title })).toBeVisible();
  }
  expect(
    screen.getByRole("link", { name: /현재 이용 좌석/ }),
  ).toHaveTextContent("0/0석");
  expect(screen.getByRole("link", { name: "AI 채팅 열기" })).toHaveAttribute(
    "href",
    "/app/all/chat",
  );
  expect(
    vi
      .mocked(fetch)
      .mock.calls.map(
        ([url]) => new URL(String(url), "http://localhost").pathname,
      )
      .sort(),
  ).toEqual(["/api/home/summary", "/api/lookups", "/api/me"]);
  await userEvent.click(screen.getByRole("button", { name: "메뉴 열기" }));
  expect(screen.getByRole("combobox", { name: "현재 지점" })).toBeDisabled();
  expect(
    screen.getByRole("option", { name: "등록된 지점 없음" }),
  ).toBeInTheDocument();
});

it.each([
  ["empty object", () => Response.json({})],
  ["null body", () => Response.json(null)],
  ["no content", () => new Response(null, { status: 204 })],
])(
  "preserves the home shell without reporting zero counts for %s",
  async (_, response) => {
    renderWorkspace(response);
    expect(
      (
        await screen.findAllByRole("heading", {
          name: "데이터를 확인할 수 없어요",
        })
      )[0],
    ).toBeVisible();
    expect(screen.getByText("완료율 —")).toBeVisible();
  },
);

it("keeps the shell and home visible when unimplemented endpoints return 404", async () => {
  renderWorkspace(() =>
    Response.json(
      { message: "No static resource api/lookups.", code: "NOT_FOUND" },
      { status: 404 },
    ),
  );
  expect(
    await screen.findByText(
      "공통 정보가 아직 제공되지 않습니다. 화면은 계속 둘러볼 수 있어요.",
    ),
  ).toBeVisible();
  expect(
    await screen.findByText(
      "홈 데이터가 아직 제공되지 않습니다. 화면은 계속 둘러볼 수 있어요.",
    ),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "안녕하세요, 관리자님 ☀" }),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "우리 공간은 지금" }),
  ).toBeVisible();
  expect(screen.getByText("현재 이용 좌석").closest(".card")).toHaveTextContent(
    "—",
  );
  expect(
    screen.getByText("현재 이용 좌석").closest(".card"),
  ).not.toHaveTextContent("0석");
  expect(screen.queryByText(/No static resource/)).not.toBeInTheDocument();
});

it("keeps the layout during loading and displays real data after retrying a failed request", async () => {
  let attempts = 0;
  renderWorkspace((path) => {
    if (path !== "/api/home/summary") return Response.json({});
    attempts++;
    if (attempts === 1)
      return Response.json(
        { code: "ERROR", message: "failed" },
        { status: 500 },
      );
    const summary = emptySummary();
    return Response.json({
      ...summary,
      seats: {
        ...summary.seats,
        total: 1,
        inUse: 1,
        occupancy: {
          state: "value",
          percent: 100,
          numerator: 1,
          denominator: 1,
        },
      },
    });
  });
  const retry = await screen.findByRole("button", {
    name: "홈 데이터 다시 불러오기",
  });
  expect(
    screen.getByRole("heading", { name: "안녕하세요, 관리자님 ☀" }),
  ).toBeVisible();
  await userEvent.click(retry);
  expect(await screen.findByText("0석 이용 가능")).toBeVisible();
  expect(
    screen.getByRole("link", { name: /현재 이용 좌석/ }),
  ).toHaveTextContent("1/1석");
});

it("uses known session branches when lookup arrays are absent", async () => {
  const current = {
    ...session,
    branches: [
      {
        id: "1",
        branchId: "1",
        name: "강남점",
        address: "서울",
        phone: "",
        hours: "",
        status: "운영 중" as const,
        version: 1,
        createdAt: session.asOf,
        updatedAt: session.asOf,
      },
    ],
  };
  renderWorkspace(() => Response.json({}), "home", current);
  await userEvent.click(
    await screen.findByRole("button", { name: "메뉴 열기" }),
  );
  expect(
    await screen.findByRole("option", { name: "강남점" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "현재 지점" })).toHaveValue(
    "all",
  );
  expect(
    screen.getByRole("combobox", { name: "현재 지점" }),
  ).not.toBeDisabled();
});

it("does not treat an authorization failure as empty data", async () => {
  renderWorkspace(() =>
    Response.json(
      { code: "ACCESS_DENIED", message: "접근 권한이 없습니다." },
      { status: 403 },
    ),
  );
  await waitFor(() =>
    expect(screen.getByText("접근 권한이 없습니다.")).toBeVisible(),
  );
  expect(
    screen.queryByRole("heading", { name: "안녕하세요, 관리자님 ☀" }),
  ).not.toBeInTheDocument();
});

function emptyTasks(path: string, page = 1) {
  if (path === "/api/tasks")
    return Response.json({ items: [], meta: { page, pageSize: 20, total: 0 } });
  if (path === "/api/tasks/summary")
    return Response.json({
      asOf: session.asOf,
      totals: { total: 0, todo: 0, inProgress: 0, done: 0, overdue: 0 },
      branches: [],
    });
  return Response.json({});
}

it("keeps list columns and filters with an empty canonical task page", async () => {
  renderWorkspace((path) => emptyTasks(path), "tasks");
  expect(
    await screen.findByRole("heading", { name: "등록된 항목이 없어요" }),
  ).toBeVisible();
  const table = screen.getByRole("table");
  expect(within(table).getAllByRole("columnheader").length).toBeGreaterThan(0);
  expect(screen.getByRole("searchbox", { name: "업무 검색" })).toBeVisible();
  expect(screen.getByText("총 0건 · 1페이지")).toBeVisible();
});

it("shows a missing sales response as an error instead of zero revenue", async () => {
  renderWorkspace(() => new Response(null, { status: 204 }), "sales");
  for (const [tab, count] of [
    ["요약", 2],
    ["판매 분석", 2],
    ["추세", 2],
    ["원장", 1],
  ] as const) {
    await userEvent.click(await screen.findByRole("tab", { name: tab }));
    const panel = within(screen.getByRole("tabpanel", { name: tab }));
    await waitFor(() =>
      expect(panel.getAllByText(/매출 응답을 확인할 수 없어요/)).toHaveLength(
        count,
      ),
    );
    expect(panel.queryByText("0원")).not.toBeInTheDocument();
  }
});

it("clears every former user's scope cache on account changes", async () => {
  renderWorkspace(() => Response.json({}));
  await screen.findByRole("heading", { name: "안녕하세요, 관리자님 ☀" });
  const client = clients[0];
  client.setQueryData(["data", "owner", "other-branch", "sensitive"], {
    secret: true,
  });
  client.setQueryData(["session"], {
    ...session,
    user: {
      ...session.user,
      id: "next-owner",
      name: "새 관리자",
      nickname: "새 관리자",
    },
  });
  await screen.findByRole("heading", { name: "안녕하세요, 새 관리자님 ☀" });
  await waitFor(() =>
    expect(
      client.getQueryCache().findAll({ queryKey: ["data", "owner"] }),
    ).toHaveLength(0),
  );
});
it("preserves search and pagination conditions when switching branch", async () => {
  const current: CurrentUser = {
    ...session,
    branches: [
      {
        id: "1",
        branchId: "1",
        version: 1,
        createdAt: session.asOf,
        updatedAt: session.asOf,
        name: "첫 지점",
        address: "주소",
        phone: "010",
        hours: "24시간",
        status: "운영 중",
      },
      {
        id: "2",
        branchId: "2",
        version: 1,
        createdAt: session.asOf,
        updatedAt: session.asOf,
        name: "둘째 지점",
        address: "주소",
        phone: "010",
        hours: "24시간",
        status: "운영 중",
      },
    ],
  };
  renderWorkspace(
    (path) => emptyTasks(path, 3),
    "tasks?q=검색&page=3",
    current,
  );
  await screen.findByRole("heading", { name: "업무 관리" });
  const client = clients[0];
  client.setQueryData(["data", "owner", "all", "sensitive"], { secret: true });
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("현재 지점"), "2");
  await waitFor(() =>
    expect(
      client.getQueryCache().findAll({ queryKey: ["data", "owner", "all"] }),
    ).toHaveLength(0),
  );
  expect(screen.getByDisplayValue("검색")).toBeVisible();
  expect(
    client
      .getQueryCache()
      .findAll({ queryKey: ["data", "owner", "2", "tasks"] })[0]
      ?.queryKey.at(-1),
  ).toContain("page=3");
});

it("keeps idle reads quiet and refreshes the active menu only on request", async () => {
  const user = userEvent.setup();
  let reads = 0;
  let fail = false;
  renderWorkspace((path) => {
    if (path === "/api/home/summary") {
      reads++;
      if (fail) return new Response(null, { status: 503 });
      return Response.json(emptySummary());
    }
    return Response.json({});
  });
  await screen.findByText("0/0석");
  expect(screen.queryByRole("button", { name: "화면 새로고침" })).toBeNull();
  expect(screen.queryByText(/^마지막 조회$/)).toBeNull();
  expect(reads).toBe(1);

  vi.useFakeTimers();
  try {
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("offline"));
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(reads).toBe(1);
  } finally {
    vi.useRealTimers();
  }

  fail = true;
  await user.click(screen.getByRole("link", { name: "OpenStudy 홈" }));
  expect(
    await screen.findByText(/마지막 조회 결과를 표시합니다/),
  ).toBeVisible();
  expect(screen.getByText("0/0석")).toBeVisible();
  expect(reads).toBe(2);

  fail = false;
  await user.click(screen.getByRole("button", { name: "메뉴 열기" }));
  await user.click(
    within(screen.getByRole("dialog", { name: "메뉴" })).getByRole("link", {
      name: "대시보드",
    }),
  );
  await waitFor(() => expect(reads).toBe(3));
  await waitFor(() =>
    expect(screen.queryByText(/마지막 조회 결과를 표시합니다/)).toBeNull(),
  );
});

it("keeps the URL filters and page when clicking the current menu", async () => {
  renderWorkspace(() => Response.json({}), "tasks?q=보고&page=2");
  await screen.findByRole("heading", { name: "업무 관리" });
  const user = userEvent.setup();
  const taskUrls = () =>
    vi
      .mocked(fetch)
      .mock.calls.map(([url]) => String(url))
      .filter((url) => url.startsWith("/api/tasks?"));
  await waitFor(() => expect(taskUrls()).toHaveLength(1));
  await user.click(screen.getByRole("link", { name: "업무 관리" }));
  await waitFor(() => expect(taskUrls()).toHaveLength(2));
  expect(taskUrls()[1]).toBe(taskUrls()[0]);
  expect(new URL(taskUrls()[1], "http://localhost").searchParams.get("q")).toBe(
    "보고",
  );
});

const homeBranch = {
  id: "2",
  branchId: "2",
  name: "테스트 지점",
  address: "",
  phone: "",
  hours: "",
  status: "운영 중" as const,
  version: 1,
  createdAt: session.asOf,
  updatedAt: session.asOf,
};
const summaryTask = {
  id: "task-2",
  branchId: "2",
  title: "지점 업무",
  status: "할 일",
  priority: "보통",
  dueAt: session.asOf,
  assignee: { id: "staff", name: "직원" },
  overdue: false,
  link: { screen: "task-detail", branchId: "2", targetId: "task-2", query: {} },
} satisfies components["schemas"]["HomeTaskItem"];

it("uses the server's staff default and changes the request and query key with the work filter", async () => {
  const staff: CurrentUser = {
    ...session,
    branches: [homeBranch],
    user: {
      ...session.user,
      id: "staff",
      owner: false,
      memberships: [{ branchId: "2", role: "staff", permissions: [] }],
    },
  };
  const reads: URL[] = [];
  renderWorkspace(
    (path, url) => {
      if (path !== "/api/home/summary") return Response.json({});
      reads.push(url);
      const mine = url.searchParams.get("mine") !== "false";
      const summary = emptySummary(mine);
      if (!mine) {
        summary.tasks.items = [summaryTask];
        summary.tasks.today = {
          total: 1,
          open: 1,
          overdue: 0,
          completedToday: 0,
          completionRate: {
            state: "value",
            percent: 0,
            numerator: 0,
            denominator: 1,
          },
        };
      }
      return Response.json(summary);
    },
    "home",
    staff,
  );
  expect(await screen.findByText("완료율 해당 없음")).toBeVisible();
  expect(screen.getByRole("button", { name: "내 업무" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.queryByRole("link", { name: "채팅" })).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "AI 채팅 열기" }),
  ).not.toBeInTheDocument();
  expect(reads[0].searchParams.has("mine")).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "오늘 업무" }));
  expect(await screen.findByText("완료율 0.0%")).toBeVisible();
  expect(reads[1].searchParams.get("mine")).toBe("false");
  expect(
    clients[0].getQueryData(["data", "staff", "all", "home", false, undefined]),
  ).toBeDefined();
  await userEvent.click(screen.getByRole("button", { name: "메뉴 열기" }));
  await userEvent.selectOptions(screen.getByLabelText("현재 지점"), "2");
  await waitFor(() => expect(reads[2]?.searchParams.get("scope")).toBe("2"));
  expect(reads[2].searchParams.get("mine")).toBe("false");
});

it("puts the assignee in both the request and cache key", async () => {
  const reads: URL[] = [];
  renderWorkspace((path, url) => {
    if (path !== "/api/home/summary") return Response.json({});
    reads.push(url);
    return Response.json(emptySummary());
  }, "home?assigneeId=staff&mine=true");
  expect(await screen.findByText("완료율 해당 없음")).toBeVisible();
  expect(reads[0].searchParams.get("assigneeId")).toBe("staff");
  expect(reads[0].searchParams.has("mine")).toBe(false);
  expect(
    clients[0].getQueryData([
      "data",
      "owner",
      "all",
      "home",
      undefined,
      "staff",
    ]),
  ).toBeDefined();
});

it("preserves branch and target on detail navigation and direct reopening", async () => {
  const current = { ...session, branches: [homeBranch] };
  const detailRequests: URL[] = [];
  const respond = (path: string, url: URL) => {
    if (path === "/api/home/summary") {
      const summary = emptySummary();
      summary.tasks.items = [summaryTask];
      return Response.json(summary);
    }
    if (path === "/api/tasks/task-2") {
      detailRequests.push(url);
      return Response.json({
        ...summaryTask,
        body: "상세 내용",
        category: "운영",
        createdBy: summaryTask.assignee,
        completedAt: null,
        checklist: [],
        checklistTotal: 0,
        checklistDone: 0,
        canEdit: false,
        version: 1,
        createdAt: session.asOf,
        updatedAt: session.asOf,
      });
    }
    if (path.endsWith("/events"))
      return Response.json({
        items: [],
        meta: { page: 1, pageSize: 20, total: 0 },
      });
    if (path === "/api/assignee-candidates")
      return Response.json({ items: [] });
    return emptyTasks(path);
  };
  renderWorkspace(respond, "home", current);
  const item = await screen.findByRole("link", { name: /지점 업무/ });
  const href = item.getAttribute("href")!;
  expect(href).toBe("/app/2/tasks?detail=task-2");
  expect(screen.getByRole("link", { name: /근무표 보기/ })).toHaveAttribute(
    "href",
    "/app/all/attendance?tab=shifts&view=list&from=2026-10-23&to=2026-10-23",
  );
  await userEvent.click(item);
  expect(
    await screen.findByRole("dialog", { name: "지점 업무" }),
  ).toBeVisible();
  cleanup();
  renderWorkspace(respond, href, current);
  expect(
    await screen.findByRole("dialog", { name: "지점 업무" }),
  ).toBeVisible();
  expect(detailRequests.map((url) => url.searchParams.get("scope"))).toEqual([
    "2",
    "2",
  ]);
});

it("drops the previous account's home data while reading for the next account", async () => {
  let account = "owner";
  let finishRead: (response: Response) => void = () => {};
  renderWorkspace((path) => {
    if (path !== "/api/home/summary") return Response.json({});
    if (account !== "owner")
      return new Promise((resolve) => {
        finishRead = resolve;
      });
    const summary = emptySummary();
    summary.tasks.items = [summaryTask];
    return Response.json(summary);
  });
  await screen.findByRole("link", { name: /지점 업무/ });
  account = "next-owner";
  act(() => {
    clients[0].setQueryData(["session"], {
      ...session,
      user: { ...session.user, id: account },
    });
  });
  await waitFor(() =>
    expect(
      clients[0].getQueryState([
        "data",
        account,
        "all",
        "home",
        undefined,
        undefined,
      ])?.fetchStatus,
    ).toBe("fetching"),
  );
  expect(
    screen.queryByRole("link", { name: /지점 업무/ }),
  ).not.toBeInTheDocument();
  act(() => finishRead(Response.json(emptySummary())));
  expect(await screen.findByText("완료율 해당 없음")).toBeVisible();
});
