import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { Layout } from "./Layout";
import { Home } from "../features/home/Home";
import { ResourcePage } from "../features/records/ResourcePage";
import { Sales } from "../features/analysis/Sales";
import { Chat } from "../features/chat/Chat";
import type { CurrentUser } from "../shared/domain/schema";

vi.mock("../shared/api/stream", () => ({ openStream: vi.fn(() => vi.fn()) }));

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
  respond: (path: string) => Response | Promise<Response>,
  route = "home",
  current = session,
) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const path = new URL(url, "http://localhost").pathname;
      return Promise.resolve(
        path === "/api/me" ? Response.json(current) : respond(path),
      );
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/app/all/${route}`]}>
        <Routes>
          <Route path="/app/:scope" element={<Layout />}>
            <Route path="home" element={<Home />} />
            <Route path="tasks" element={<ResourcePage resource="tasks" />} />
            <Route path="sales" element={<Sales />} />
            <Route path="chat" element={<Chat />} />
          </Route>
          <Route path="/login" element={<p>로그인 화면</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it.each([
  ["empty object", () => Response.json({})],
  [
    "empty lists",
    () =>
      Response.json({
        tasks: [],
        seats: [],
        facilities: [],
        inquiries: [],
        notices: [],
        shifts: [],
        messages: [],
        branches: [],
        employees: [],
      }),
  ],
  ["null body", () => Response.json(null)],
  [
    "null collections",
    () =>
      Response.json({
        tasks: null,
        seats: null,
        branches: null,
        employees: null,
        notices: null,
      }),
  ],
  ["no content", () => new Response(null, { status: 204 })],
  ["empty 200 body", () => new Response(null, { status: 200 })],
])(
  "keeps the dashboard and empty sections visible with %s",
  async (_, response) => {
    renderWorkspace(response);
    expect(
      await screen.findByRole("heading", { name: "안녕하세요, 관리자님 ☀" }),
    ).toBeVisible();
    expect(
      await screen.findByRole("heading", { name: "오늘 예정된 근무가 없어요" }),
    ).toBeVisible();
    for (const title of [
      "오늘 배정된 업무가 없어요",
      "등록된 점검 항목이 없어요",
      "아직 공유된 업무가 없어요",
      "등록된 공지사항이 없어요",
    ]) {
      expect(screen.getByRole("heading", { name: title })).toBeVisible();
    }
    expect(screen.getByRole("combobox", { name: "현재 지점" })).toBeDisabled();
    expect(
      screen.getByRole("option", { name: "등록된 지점 없음" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /현재 이용 좌석/ }),
    ).toHaveTextContent("0");
    expect(screen.getByRole("link", { name: "업무 관리" })).toBeVisible();
    expect(
      screen.queryByText("요청을 완료하지 못했어요"),
    ).not.toBeInTheDocument();
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
  expect(
    screen.getByRole("link", { name: /현재 이용 좌석/ }),
  ).toHaveTextContent("—");
  expect(
    screen.getByRole("link", { name: /현재 이용 좌석/ }),
  ).not.toHaveTextContent("0석");
  expect(screen.queryByText(/No static resource/)).not.toBeInTheDocument();
});

it("keeps the layout during loading and displays real data after retrying a failed request", async () => {
  let attempts = 0;
  renderWorkspace((path) => {
    if (path !== "/api/home") return Response.json({});
    attempts++;
    if (attempts === 1)
      return Response.json(
        { code: "ERROR", message: "failed" },
        { status: 500 },
      );
    return Response.json({
      seats: [{ id: "seat-1", branchId: "1", status: "이용 중" }],
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

it("keeps list columns and filters with missing page items", async () => {
  renderWorkspace(() => Response.json({ items: null }), "tasks");
  expect(
    await screen.findByRole("heading", { name: "등록된 항목이 없어요" }),
  ).toBeVisible();
  const table = screen.getByRole("table");
  expect(within(table).getAllByRole("columnheader").length).toBeGreaterThan(0);
  expect(screen.getByRole("searchbox", { name: "업무 검색" })).toBeVisible();
  expect(screen.getByText("총 0건 · 1페이지")).toBeVisible();
});

it("keeps sales totals and table headers with no sales response", async () => {
  renderWorkspace(() => new Response(null, { status: 204 }), "sales");
  expect(
    await screen.findByRole("heading", {
      name: "조회 기간에 매출 내역이 없어요",
    }),
  ).toBeVisible();
  expect(screen.getAllByText("0원")).toHaveLength(3);
  expect(screen.getByRole("columnheader", { name: "순매출" })).toBeVisible();
});

it("shows a channel empty state when chat returns no data", async () => {
  renderWorkspace(() => new Response(null, { status: 204 }), "chat");
  expect(
    await screen.findByRole("heading", {
      name: "아직 참여 중인 대화가 없어요",
    }),
  ).toBeVisible();
  expect(screen.getByRole("heading", { name: "팀 채팅" })).toBeVisible();
});
