import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { handlers } from "../../mocks/handlers";
import { store } from "../../mocks/store";
import { Ai } from "./Ai";
import { aiReuse } from "./ai-reuse-api";
import { exportAiDataset } from "./export-api";
import { aiConversations, executeAiQuery, parseAiResult } from "./domainlens";

vi.mock("../../app/context", () => ({
  useApp: () => ({
    session: { user: store.activeUser(), branches: store.db.branches },
    scope: "all",
  }),
}));

const server = setupServer(...handlers);
const requests: { method: string; path: string }[] = [];
beforeAll(() => {
  server.listen();
  server.events.on("request:start", ({ request }) => {
    requests.push({
      method: request.method,
      path: new URL(request.url).pathname,
    });
  });
});
afterAll(() => server.close());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("uses only the canonical AI routes for questions and saved conversations", async () => {
  store.reset();
  store.persona = "owner";
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <Ai />
    </QueryClientProvider>,
  );
  await user.type(screen.getByLabelText("AI에게 질문"), "지점별 매출");
  const send = screen.getByRole("button", { name: "질문하기" });
  await waitFor(() => expect(send).toBeEnabled());
  await user.click(send);
  const saved = await screen.findByRole("button", {
    name: /^지점별 매출$/,
  });
  await user.click(saved);
  expect(
    await screen.findByText(/저장된 질문을 현재 권한과 기준 시각으로/),
  ).toBeVisible();
  await user.click(
    screen.getByRole("button", { name: "지점별 매출 제목 변경" }),
  );
  const title = screen.getByLabelText("대화 제목");
  await user.clear(title);
  await user.type(title, "수정된 제목");
  await user.click(screen.getByRole("button", { name: "저장" }));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await user.click(
    await screen.findByRole("button", { name: "수정된 제목 삭제" }),
  );
  expect(await screen.findByText(/아직 저장된 대화가 없어요/)).toBeVisible();

  expect(requests).toEqual(
    expect.arrayContaining([
      { method: "GET", path: "/api/ai/catalog/readiness" },
      { method: "POST", path: "/api/ai/queries" },
      { method: "GET", path: "/api/ai/conversations" },
      ...["GET", "PATCH", "DELETE"].map((method) => ({
        method,
        path: expect.stringMatching(/^\/api\/ai\/conversations\/conv-/),
      })),
    ]),
  );
  expect(requests.filter(({ path }) => !path.startsWith("/api/ai/"))).toEqual([
    { method: "GET", path: "/api/auth/csrf" },
  ]);
  client.clear();
});

it("returns the requested AI dataset as CSV and checks ownership, limits and availability", async () => {
  store.reset();
  store.scenario = "normal";
  store.persona = "owner";
  const result = await executeAiQuery({
    question: "이번 달 지점별 매출을 비교해줘",
    scope: "all",
    clientRequestKey: "ai-export-test",
  });
  const id = result.executionId!;
  expect(id).toBeTruthy();
  try {
    const csv = await exportAiDataset(id, "branchSales");
    expect(csv.disposition).toContain("filename*=UTF-8''");
    const bytes = new Uint8Array(await csv.blob.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const body = new TextDecoder().decode(bytes);
    expect(body).toContain("데이터셋 branchSales");
    expect(body).toContain("net_krw(KRW)");
    expect((await exportAiDataset(id)).disposition).toContain(
      "filename*=UTF-8''",
    );
    await expect(exportAiDataset(id, "unknown")).rejects.toMatchObject({
      status: 422,
    });
    store.persona = store.db.employees.find(
      (employee) => employee.id !== "owner" && employee.status === "활성",
    )!.id;
    await expect(exportAiDataset(id)).rejects.toMatchObject({
      status: 404,
      detail: { code: "NOT_FOUND" },
    });
    store.persona = "owner";
    for (const [scenario, status, code] of [
      ["forbidden", 403, "AI_PERMISSION_DENIED"],
      ["rate-limited", 429, "RATE_LIMITED"],
      ["error", 503, "AI_NOT_READY"],
    ] as const) {
      store.scenario = scenario;
      await expect(exportAiDataset(id)).rejects.toMatchObject({
        status,
        detail: { code },
      });
    }
  } finally {
    store.persona = "owner";
    store.scenario = "normal";
    await aiConversations.remove(result.conversationId!);
  }
});

it("saves changed conditions in the same conversation and runs recent questions through the correct routes", async () => {
  store.reset();
  store.persona = "owner";
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <Ai />
    </QueryClientProvider>,
  );

  async function ask(question: string) {
    await user.type(screen.getByLabelText("AI에게 질문"), question);
    const send = screen.getByRole("button", { name: "질문하기" });
    await waitFor(() => expect(send).toBeEnabled());
    await user.click(send);
  }

  await ask("이번 달 지점별 매출을 비교해줘");
  const edit = await screen.findByRole("button", { name: "조건 변경" });
  expect(
    screen.getByRole("button", { name: "지점별 매출 CSV 다운로드" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "지점별 매출 PNG 저장" }),
  ).toBeVisible();
  expect(screen.queryByText("유지")).not.toBeInTheDocument();
  await user.click(edit);
  await user.click(
    screen.getByRole("button", { name: "변경한 조건으로 조회" }),
  );
  expect(await screen.findByText(/원래 조건과 같아요/)).toBeVisible();
  const start = screen.getByLabelText("시작 날짜");
  fireEvent.change(start, { target: { value: "2024-01-01" } });
  await user.click(
    screen.getByRole("button", { name: "변경한 조건으로 조회" }),
  );
  expect(
    await screen.findByText(/기간은 최대 366일까지 고를 수 있어요/),
  ).toBeVisible();

  fireEvent.change(start, { target: { value: "2026-10-02" } });
  let payload: unknown;
  const capture = ({ request }: { request: Request }) => {
    if (request.url.endsWith("/refinements"))
      void request
        .clone()
        .json()
        .then((body) => {
          payload = body;
        });
  };
  server.events.on("request:start", capture);
  try {
    await user.click(
      screen.getByRole("button", { name: "변경한 조건으로 조회" }),
    );
    expect(
      (await screen.findByText("변경된 조건")).parentElement,
    ).toHaveTextContent("변경된 조건 기간");
    expect(payload).toEqual({
      period: { from: "2026-10-02", to: "2026-10-17" },
      clientRequestKey: expect.any(String),
    });
  } finally {
    server.events.removeListener("request:start", capture);
  }

  await ask("원결제일 기준으로");
  await waitFor(() =>
    expect(screen.getAllByText("변경된 조건")).toHaveLength(2),
  );
  const answer = screen.getAllByRole("region", {
    name: "지점별 매출 비교 결과",
  })[2];
  expect(within(answer).getByText("유지").parentElement).toHaveTextContent(
    "분석 종류, 지점, 기간",
  );
  expect(
    within(answer).getByText("변경된 조건").parentElement,
  ).toHaveTextContent("환불 집계 기준");
  expect(
    within(answer).getByText("2026-10-02 ~ 2026-10-17 · 변경한 기간"),
  ).toBeVisible();
  await user.click(within(answer).getByRole("button", { name: "표로 보기" }));
  const table = await within(answer).findByRole("table", {
    name: "결과 데이터 표",
  });
  await user.click(
    within(table).getByRole("button", { name: "net_krw (KRW)" }),
  );
  expect(
    await within(answer).findByRole("columnheader", { name: "net_krw (KRW)" }),
  ).toHaveAttribute("aria-sort", "descending");
  expect(within(answer).getByText(/표 기준 시각/)).toBeVisible();

  const prior = (await aiReuse.recent()).items;
  const originalId = prior.find(
    (item) => item.question === "이번 달 지점별 매출을 비교해줘",
  )?.executionId;
  const followUpId = prior.find(
    (item) => item.question === "원결제일 기준으로",
  )?.executionId;
  expect(originalId).toBeTruthy();
  expect(followUpId).toBeTruthy();
  const [conversation] = await aiConversations.list();
  const reopened = await aiConversations.reopen(conversation.id, "all");
  expect(reopened.turns.map((turn) => turn.origin)).toEqual([
    "QUESTION",
    "REFINEMENT",
    "QUESTION",
  ]);
  expect(reopened.turns[1].sourceExecutionId).toBe(originalId);
  for (const { response } of reopened.turns) {
    expect(response).toMatchObject({
      status: "COMPLETED",
      context: null,
      executionId: null,
      conditions: null,
      editableFilters: null,
    });
  }

  await ask("지원 범위를 알 수 없는 질문");
  await screen.findByText("어떤 분석이 필요한지 더 자세히 알려 주세요.");
  await user.click(screen.getByRole("button", { name: "최근 질문" }));
  const recent = await screen.findByRole("list", { name: "최근 질문 목록" });
  const items = within(recent).getAllByRole("listitem");
  expect(items).toHaveLength(3);
  expect(items[0]).toHaveTextContent("지원 범위를 알 수 없는 질문");
  expect(items[1]).toHaveTextContent("원결제일 기준으로");
  const beforeReplay = requests.length;
  await user.click(
    within(items[1]).getByRole("button", { name: "결과 다시 조회" }),
  );
  expect(
    await screen.findByText("최근 질문의 결과를 다시 조회했어요."),
  ).toBeVisible();
  expect(requests.slice(beforeReplay)).toContainEqual({
    method: "GET",
    path: `/api/ai/executions/${followUpId}`,
  });
  expect(requests.slice(beforeReplay)).not.toContainEqual({
    method: "POST",
    path: "/api/ai/queries",
  });
  const beforeNew = requests.length;
  await user.click(
    within(items[0]).getByRole("button", { name: "새 질문으로 보내기" }),
  );
  await screen.findByText("어떤 분석이 필요한지 더 자세히 알려 주세요.");
  expect(requests.slice(beforeNew)).toContainEqual({
    method: "POST",
    path: "/api/ai/queries",
  });
  expect(await aiConversations.list()).toHaveLength(2);
  await Promise.all(
    (await aiConversations.list()).map(({ id }) => aiConversations.remove(id)),
  );
  client.clear();
});

it("enforces execution paging and checks the current owner and branch scope on reuse", async () => {
  store.reset();
  store.persona = "owner";
  const asked = await executeAiQuery({ question: "지점별 매출", scope: "all" });
  const id = asked.executionId!;
  const execution = await aiReuse.execution(id);
  const original = parseAiResult(execution).datasetList[0];
  const paged = await aiReuse.execution(id, {
    datasetId: original.id,
    page: 2,
    size: 1,
    sort: "net_krw",
    direction: "desc",
  });
  expect(paged.envelope.datasets[0]).toMatchObject({
    totalElements: original.rows.length,
    page: 2,
    size: 1,
  });
  expect(paged.envelope.datasets[0].rows).toEqual(
    [...original.rows]
      .sort((a, b) => Number(b.net_krw) - Number(a.net_krw))
      .slice(1, 2),
  );
  await expect(
    aiReuse.execution(id, { sort: "unknown" }),
  ).rejects.toMatchObject({
    status: 422,
    detail: { code: "VALIDATION_FAILED" },
  });
  await expect(aiReuse.refine(id, { productIds: [] })).rejects.toMatchObject({
    status: 422,
    detail: {
      code: "FILTER_NOT_EDITABLE",
      fieldErrors: { productIds: expect.any(String) },
    },
  });
  await expect(
    aiReuse.refine(id, { period: { from: "2024-01-01", to: "2026-10-17" } }),
  ).rejects.toMatchObject({
    status: 422,
    detail: { code: "PERIOD_TOO_LONG" },
  });
  await expect(
    aiReuse.refine(id, { branchIds: execution.conditions!.branchIds }),
  ).rejects.toMatchObject({
    status: 422,
    detail: { code: "NO_FILTER_CHANGE" },
  });

  const owner = store.activeUser();
  owner.owner = false;
  owner.memberships = [
    {
      branchId: execution.conditions!.branchIds[0],
      permissions: ["ai:read", "sales:read"],
      role: "staff",
      status: "활성",
      version: 1,
    },
  ];
  await expect(aiReuse.execution(id)).rejects.toMatchObject({
    status: 403,
    detail: { code: "BRANCH_SCOPE_DENIED" },
  });
  const contextAfterLoss = await executeAiQuery({
    question: "지점별 매출",
    scope: "all",
    conversationId: asked.conversationId!,
  });
  expect(contextAfterLoss.context).toMatchObject({
    reset: true,
    resetReason: "PERMISSION_LOST",
    inherited: [],
  });
  const narrowed = await aiReuse.refine(id, {
    branchIds: [owner.memberships[0].branchId],
  });
  expect(narrowed.conditions?.branchIds).toEqual([
    owner.memberships[0].branchId,
  ]);

  store.persona = store.db.employees.find(
    (employee) => employee.id !== owner.id && employee.status === "활성",
  )!.id;
  await expect(aiReuse.execution(id)).rejects.toMatchObject({ status: 404 });
  expect(
    (await aiReuse.recent()).items.some(
      (item) => item.requestId === asked.requestId,
    ),
  ).toBe(false);
  store.persona = "owner";
  owner.owner = true;
  await aiConversations.remove(asked.conversationId!);
  await expect(aiReuse.execution(id)).rejects.toMatchObject({ status: 404 });
});

it("keeps the newest 20 of the employee's questions in the 30-day window", async () => {
  store.reset();
  store.persona = "owner";
  const now = new Date(Date.now() + 1000);
  try {
    vi.setSystemTime(new Date(now.getTime() - 31 * 86_400_000));
    const expired = await executeAiQuery({
      question: "31일 전 질문",
      scope: "all",
    });
    vi.setSystemTime(now);
    expect(
      (await aiReuse.recent()).items.some(
        (item) => item.requestId === expired.requestId,
      ),
    ).toBe(false);
    const responses = await Promise.all(
      Array.from({ length: 21 }, (_, index) =>
        executeAiQuery({ question: `최근 질문 ${index}`, scope: "all" }),
      ),
    );
    const list = (await aiReuse.recent()).items;
    expect(list).toHaveLength(20);
    expect(
      list.every((item) =>
        responses.some((response) => response.requestId === item.requestId),
      ),
    ).toBe(true);
    expect(list.map((item) => item.askedAt)).toEqual(
      list
        .map((item) => item.askedAt)
        .sort()
        .reverse(),
    );
    expect(
      list.every((item) => !item.rerunnable && item.executionId === null),
    ).toBe(true);
  } finally {
    vi.useRealTimers();
    await Promise.all(
      (await aiConversations.list()).map(({ id }) =>
        aiConversations.remove(id),
      ),
    );
  }
});

it("offers one branch and no period or products for realtime seats, and keeps urgent tasks multi-branch", async () => {
  store.reset();
  store.persona = "owner";
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <Ai />
    </QueryClientProvider>,
  );
  await user.type(
    screen.getByLabelText("AI에게 질문"),
    "지금 강남점에 빈자리가 얼마나 있어?",
  );
  const send = screen.getByRole("button", { name: "질문하기" });
  await waitFor(() => expect(send).toBeEnabled());
  await user.click(send);
  await user.click(await screen.findByRole("button", { name: "조건 변경" }));
  expect(screen.queryByLabelText("시작 날짜")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("group", { name: "상품 선택" }),
  ).not.toBeInTheDocument();
  const branches = within(screen.getByRole("group", { name: "지점 1개 선택" }));
  expect(branches.getByRole("radio", { name: "강남점" })).toBeChecked();
  await user.click(branches.getByRole("radio", { name: "성수점" }));
  expect(branches.getByRole("radio", { name: "강남점" })).not.toBeChecked();

  const task = await executeAiQuery({
    question: "지금 급하게 처리해야 할 업무가 뭐야?",
    scope: "all",
  });
  expect(task.editableFilters).toEqual({
    period: null,
    branches: { single: false },
    products: false,
  });
  const otherScope = store.db.branches[0].id;
  const next = await executeAiQuery({
    question: "지금 급하게 처리해야 할 업무가 뭐야?",
    scope: otherScope,
    conversationId: task.conversationId!,
  });
  expect(next.context).toMatchObject({
    reset: true,
    resetReason: "SCOPE_CHANGED",
    inherited: [],
  });
  const products = await executeAiQuery({
    question: "앞으로 7일 이내에 만료되는 이용권을 보여줘",
    scope: "all",
  });
  expect(products.editableFilters).toEqual({
    period: { maxDays: 92 },
    branches: { single: false },
    products: true,
  });
  await expect(
    aiReuse.refine(products.executionId!, {
      productIds: Array.from({ length: 21 }, (_, index) => String(index + 1)),
    }),
  ).rejects.toMatchObject({
    status: 422,
    detail: {
      code: "VALIDATION_FAILED",
      fieldErrors: { productIds: expect.any(String) },
    },
  });
  await Promise.all(
    (await aiConversations.list()).map(({ id }) => aiConversations.remove(id)),
  );
  client.clear();
});
