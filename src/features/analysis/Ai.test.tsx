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
import { Ai } from "./Ai";
import { ApiError } from "../../shared/api/client";
import type { CurrentUser } from "../../shared/domain/schema";
import type { AiQueryResponseDto } from "./domainlens";
import { generatedResponse } from "./generated-results.fixture";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  execute: vi.fn(),
  history: {
    list: vi.fn(),
    reopen: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
  },
  context: {} as { session: CurrentUser; scope: string },
}));
vi.mock("../../app/context", () => ({ useApp: () => mocks.context }));
vi.mock("../../shared/api/client", async (load) => ({
  ...(await load<typeof import("../../shared/api/client")>()),
  api: mocks.api,
}));
vi.mock("./domainlens", async (load) => ({
  ...(await load<typeof import("./domainlens")>()),
  executeAiQuery: mocks.execute,
  aiConversations: mocks.history,
}));
function session(permissions: string[]): CurrentUser {
  return {
    user: {
      id: "10",
      branchId: "1",
      owner: false,
      status: "활성",
      memberships: [{ branchId: "1", role: "staff", permissions, version: 1 }],
      version: 1,
      name: "직원",
    },
    branches: [{ id: "1", name: "강남점" }],
    asOf: "2026-11-06T05:00:00Z",
  } as CurrentUser;
}
function response(over: Partial<AiQueryResponseDto>): AiQueryResponseDto {
  return {
    requestId: "req-1",
    executionId: "exec-1",
    conversationId: "conv-1",
    traceId: "trc-1",
    status: "COMPLETED",
    httpStatus: 200,
    errorCode: null,
    resultCategory: "EXECUTED",
    behavior: "EXECUTE_ANALYSIS",
    message: null,
    pocCode: "POC-001",
    analysisId: "openstudy.sales.branchComparison",
    intentDomain: "sales",
    semanticStatus: null,
    querySpec: null,
    viewSpec: {
      catalogVersion: "openstudy-ui-1.0.0",
      components: [
        {
          id: "kpi",
          componentRef: { id: "KPI", version: "1.0.0" },
          datasetId: "salesTotals",
          bindings: { values: ["net_krw"] },
        },
        {
          id: "comp_bar",
          componentRef: { id: "BAR_CHART", version: "1.0.0" },
          datasetId: "branchSales",
          bindings: { category: "branch_name", value: "net_krw" },
          options: {},
          events: [],
        },
      ],
    },
    envelope: {
      requestId: "req-1",
      executionId: "exec-1",
      status: "COMPLETED",
      datasets: [
        {
          id: "branchSales",
          columns: [
            { alias: "branch_id", type: "INTEGER", unit: null, precision: 0 },
            {
              alias: "branch_name",
              type: "STRING",
              unit: null,
              precision: null,
            },
            {
              alias: "approved_krw",
              type: "INTEGER",
              unit: "KRW",
              precision: 0,
            },
            { alias: "refund_krw", type: "INTEGER", unit: "KRW", precision: 0 },
            { alias: "net_krw", type: "INTEGER", unit: "KRW", precision: 0 },
          ],
          rows: [
            {
              branch_id: 1,
              branch_name: "강남점",
              approved_krw: 30000,
              refund_krw: 5000,
              net_krw: 25000,
            },
          ],
        },
        {
          id: "salesTotals",
          columns: [
            { alias: "net_krw", type: "INTEGER", unit: "KRW", precision: 0 },
          ],
          rows: [{ net_krw: 25000 }],
        },
      ],
      asOf: "2026-11-06T05:00:00Z",
      snapshotVersion: "s1",
      policyVersion: "p1",
      warnings: [],
    },
    summary: {},
    clarificationOptions: [],
    stages: [],
    retrievedCandidates: [],
    securityGate: {},
    ...over,
  } as AiQueryResponseDto;
}
let client: QueryClient;
beforeEach(() => {
  mocks.context = { session: session(["ai:read", "sales:read"]), scope: "1" };
  mocks.api.mockResolvedValue({ ready: true });
  mocks.history.list.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  client?.clear();
  vi.clearAllMocks();
});
function show() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const view = () => (
    <QueryClientProvider client={client}>
      <Ai />
    </QueryClientProvider>
  );
  const rendered = render(view());
  return () => rendered.rerender(view());
}
async function ask(text: string) {
  const user = userEvent.setup();
  const box = screen.getByLabelText("AI에게 질문");
  await user.type(box, text);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "질문하기" })).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: "질문하기" }));
  return user;
}

it("shows a permission notice without ai:read and never asks the engine", () => {
  mocks.context = { session: session(["sales:read"]), scope: "1" };
  show();
  expect(screen.getByText("AI 조회 권한이 필요해요")).toBeInTheDocument();
  expect(mocks.api).not.toHaveBeenCalled();
});

it("asks with the current scope and shows the answer with its sales totals", async () => {
  const answer = response({ message: "강남점 매출이에요." });
  mocks.execute.mockResolvedValue(answer);
  mocks.api.mockImplementation(async (path: string) =>
    path.startsWith("/ai/executions/")
      ? { envelope: answer.envelope }
      : { ready: true },
  );
  show();
  await ask("이번 달 매출");
  expect(mocks.execute).toHaveBeenCalledWith(
    expect.objectContaining({
      question: "이번 달 매출",
      scope: "1",
      clientRequestKey: expect.stringMatching(/^[\w.:-]{1,100}$/),
    }),
    expect.any(AbortSignal),
  );
  expect(await screen.findByText("강남점 매출이에요.")).toBeInTheDocument();
  expect(screen.getByText("이번 달 매출")).toBeInTheDocument();
  expect(screen.getAllByText("25,000원")[0]).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "결과 보기" })).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "branchSales CSV 다운로드" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "salesTotals CSV 다운로드" }),
  ).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "표로 보기" }));
  expect(
    screen.getByRole("button", { name: "표로 보기", pressed: true }),
  ).toBeInTheDocument();
  expect(
    await screen.findByRole("table", { name: "결과 데이터 표" }),
  ).toBeVisible();
});

it("explains a refused question without showing any result", async () => {
  mocks.execute.mockResolvedValue(
    response({
      status: "REFUSED",
      resultCategory: "PERMISSION_DENIED",
      message: "이 지점의 매출 조회 권한이 없어요.",
      envelope: null,
    }),
  );
  show();
  await ask("홍대점 매출");
  expect(
    await screen.findByText("이 지점의 매출 조회 권한이 없어요."),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("group", { name: "결과 보기" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /CSV 다운로드|PNG 저장/ }),
  ).not.toBeInTheDocument();
});

it("resends a clarification choice with its option id", async () => {
  mocks.execute
    .mockResolvedValueOnce(
      response({
        status: "CLARIFICATION",
        envelope: null,
        errorCode: "BRANCH_REQUIRED",
        clarificationOptions: [
          { id: "branch:1:openstudy.seats.hourlyCongestion", label: "강남점" },
        ],
      }),
    )
    .mockResolvedValueOnce(response({}));
  show();
  const user = await ask("좌석 혼잡도");
  expect(
    screen.queryByRole("button", { name: /CSV 다운로드|PNG 저장/ }),
  ).not.toBeInTheDocument();
  await user.click(
    await screen.findByRole("button", {
      name: "강남점",
    }),
  );
  await waitFor(() =>
    expect(mocks.execute).toHaveBeenLastCalledWith(
      {
        question: "좌석 혼잡도",
        scope: "1",
        clarificationChoice: "branch:1:openstudy.seats.hourlyCongestion",
        clientRequestKey: expect.any(String),
        conversationId: "conv-1",
      },
      expect.any(AbortSignal),
    ),
  );
});

it("keeps every turn in one log and conversation, with suggestions under it", async () => {
  mocks.execute
    .mockResolvedValueOnce(
      response({
        message: "첫 답변이에요.",
        stages: [
          {
            stage: "accepted",
            label: "질문 접수 및 정규화",
            status: "COMPLETED",
            durationMs: 2,
            detail: "",
          },
          {
            stage: "executing",
            label: "데이터베이스 집계 실행",
            status: "COMPLETED",
            durationMs: 40,
            detail: "",
          },
        ],
      }),
    )
    .mockResolvedValueOnce(response({ message: "두 번째 답변이에요." }));
  show();
  const user = await ask("이번 달 매출");
  expect(await screen.findByText("첫 답변이에요.")).toBeInTheDocument();
  expect(screen.getByText(/처리 과정 2단계/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "추천 질문" }));
  await user.click(screen.getByRole("button", { name: "인기 이용권 TOP 5" }));
  expect(await screen.findByText("두 번째 답변이에요.")).toBeInTheDocument();
  expect(screen.getByText("첫 답변이에요.")).toBeInTheDocument();
  expect(mocks.execute).toHaveBeenLastCalledWith(
    expect.objectContaining({ conversationId: "conv-1" }),
    expect.any(AbortSignal),
  );
});

it("disables sales examples without sales:read and blocks asking while the engine is not ready", async () => {
  mocks.context = { session: session(["ai:read"]), scope: "1" };
  mocks.api.mockResolvedValue({ ready: false });
  show();
  expect(
    await screen.findByText("AI 엔진이 아직 준비되지 않았어요."),
  ).toBeInTheDocument();
  const sales = screen.getByRole("button", {
    name: /이번 달 지점별 매출을 비교해줘/,
  });
  expect(sales).toBeDisabled();
  expect(sales).toHaveTextContent("매출 조회 권한이 있어야 볼 수 있어요.");
  await userEvent.type(screen.getByLabelText("AI에게 질문"), "좌석 현황");
  expect(screen.getByRole("button", { name: "질문하기" })).toBeDisabled();
});

const saved = {
  id: "conv-1",
  title: "매출 점검",
  scope: "1",
  createdAt: "2026-11-06T01:00:00Z",
  lastAskedAt: "2026-11-06T01:05:00Z",
};

it("reopens a saved conversation with each question re-run, and keeps asking in it", async () => {
  mocks.history.list.mockResolvedValue([saved]);
  mocks.history.reopen.mockResolvedValue({
    id: "conv-1",
    title: "매출 점검",
    scope: "1",
    turns: [
      {
        question: "지점별 매출",
        askedAt: "2026-11-06T01:00:00Z",
        response: response({ message: "다시 조회했어요." }),
      },
      {
        question: "옛 지점 매출",
        askedAt: "2026-11-06T01:05:00Z",
        response: response({
          status: "REFUSED",
          envelope: null,
          errorCode: "ANALYSIS_UNAVAILABLE",
        }),
      },
    ],
  });
  mocks.execute.mockResolvedValue(response({ message: "이어서 답했어요." }));
  show();
  const user = userEvent.setup();
  await user.click(
    (await screen.findAllByRole("button", { name: /^매출 점검/ }))[0],
  );
  expect(mocks.history.reopen).toHaveBeenCalledWith(
    "conv-1",
    "1",
    expect.any(AbortSignal),
  );
  expect(await screen.findByText("다시 조회했어요.")).toBeInTheDocument();
  expect(
    screen.getByText(
      "저장된 질문의 분석은 현재 제공되지 않아요. 다시 질문해 주세요.",
    ),
  ).toBeInTheDocument();
  expect(screen.getAllByRole("group", { name: "결과 보기" })).toHaveLength(1);
  await ask("이어서 질문");
  expect(await screen.findByText("이어서 답했어요.")).toBeInTheDocument();
  expect(mocks.execute).toHaveBeenLastCalledWith(
    expect.objectContaining({ conversationId: "conv-1" }),
    expect.any(AbortSignal),
  );
});

it("renames and deletes a saved conversation from the history", async () => {
  mocks.history.list.mockResolvedValue([saved]);
  mocks.history.rename.mockResolvedValue({ id: "conv-1", title: "새 제목" });
  mocks.history.remove.mockResolvedValue(undefined);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  show();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "매출 점검 제목 변경" }),
  );
  const title = screen.getByLabelText("대화 제목");
  await user.clear(title);
  await user.type(title, "새 제목");
  await user.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() =>
    expect(mocks.history.rename).toHaveBeenCalledWith("conv-1", "새 제목"),
  );
  await user.click(screen.getByRole("button", { name: "매출 점검 삭제" }));
  expect(confirm).toHaveBeenCalled();
  await waitFor(() =>
    expect(mocks.history.remove).toHaveBeenCalledWith("conv-1"),
  );
  confirm.mockRestore();
});

it("shows readiness reasons after a 503 and retries the same request as a normal result", async () => {
  mocks.execute
    .mockResolvedValueOnce(
      response({
        status: "NOT_READY",
        httpStatus: 503,
        errorCode: "AI_NOT_READY",
        envelope: null,
      }),
    )
    .mockResolvedValueOnce(response({ behavior: "REPLAY" }));
  mocks.api
    .mockResolvedValueOnce({ ready: true })
    .mockResolvedValueOnce({
      ready: false,
      reasons: ["등록 분석을 준비하고 있어요."],
    })
    .mockResolvedValueOnce({ ready: true });
  show();
  const user = await ask("매출");
  expect(await screen.findByText("등록 분석을 준비하고 있어요.")).toBeVisible();
  const retry = screen.getByRole("button", { name: "같은 질문 다시 시도" });
  expect(retry).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "다시 확인" }));
  await waitFor(() => expect(retry).toBeEnabled());
  await user.click(retry);
  expect(mocks.execute.mock.calls[1][0]).toEqual(
    mocks.execute.mock.calls[0][0],
  );
  expect(await screen.findByText("순매출")).toBeVisible();
});

it.each([
  ["QUESTION_LENGTH_EXCEEDED", 400, "질문을 1~500자로 입력해 주세요."],
  ["VALIDATION_FAILED", 422, "조회 지점이나 선택한 조건을 확인해 주세요."],
  [
    "REJECT_RAW_SQL",
    400,
    "코드 실행이나 변경 요청은 처리할 수 없어요. 조회할 내용을 질문해 주세요.",
  ],
  [
    "PII_MINIMIZATION",
    403,
    "개인정보, 인증 정보 또는 제한된 원천은 조회할 수 없어요.",
  ],
  [
    "BRANCH_SCOPE_DENIED",
    403,
    "현재 권한과 지점 범위로는 이 질문을 조회할 수 없어요.",
  ],
  ["DATE_RANGE_LIMIT_EXCEEDED", 400, "조회 기간을 366일 이내로 줄여 주세요."],
  [
    "RATE_LIMITED",
    429,
    "질문 요청이 너무 많아요. 잠시 기다린 뒤 다시 시도해 주세요.",
  ],
  ["OUT_OF_DOMAIN", 200, "지원하는 업무 지표로 질문해 주세요."],
])(
  "shows a specific message for %s",
  async (errorCode, httpStatus, message) => {
    mocks.execute.mockResolvedValue(
      response({ status: "DENIED", errorCode, httpStatus, envelope: null }),
    );
    show();
    await ask("조회");
    expect(await screen.findByText(message)).toBeVisible();
  },
);

it("announces truncation and clears old results on a scope change and on session expiry", async () => {
  mocks.execute.mockResolvedValue(
    response({
      truncation: {
        maxRows: 1000,
        pageSize: 50,
        maxChartCategories: 20,
        isTruncated: true,
      },
    }),
  );
  const rerender = show();
  await ask("매출");
  expect(await screen.findByText(/최대 1000행/)).toBeVisible();
  expect(
    screen.getByRole("button", { name: "branchSales CSV 다운로드" }),
  ).toHaveAccessibleDescription("CSV에는 앞의 1,000행만 담겨요.");
  mocks.context.scope = "all";
  rerender();
  expect(screen.queryByText("순매출")).toBeNull();
  await ask("새 범위 매출");
  expect(await screen.findByText("순매출")).toBeVisible();
  expect(mocks.execute.mock.calls[1][0].scope).toBe("all");
  act(() => window.dispatchEvent(new Event("openstudy:session-expired")));
  expect(screen.queryByText("순매출")).toBeNull();
});

it("clears sales results when permission is revoked within the same scope", async () => {
  mocks.execute.mockResolvedValue(response({}));
  const rerender = show();
  await ask("매출");
  expect(await screen.findByText("순매출")).toBeVisible();
  mocks.context.session = session(["ai:read"]);
  rerender();
  expect(screen.queryByText("순매출")).toBeNull();
});

it("blocks duplicate submissions and discards a response received after cancellation", async () => {
  let complete!: (res: AiQueryResponseDto) => void;
  mocks.execute.mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  show();
  const user = await ask("매출");
  await user.type(screen.getByLabelText("AI에게 질문"), "다른 질문{Enter}");
  expect(mocks.execute).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "질문 대기 취소" }));
  await act(async () => complete(response({})));
  expect(await screen.findByText("질문 대기를 취소했어요.")).toBeVisible();
  expect(screen.queryByText("순매출")).toBeNull();
});

it.each([
  ["AI_PERMISSION_DENIED", "AI 분석 조회 권한이 없어요."],
  ["BRANCH_SCOPE_DENIED", "조회 조건에 접근 권한이 없는 지점이 있어요."],
  [
    "SALES_PERMISSION_DENIED",
    "조회 조건에 매출 조회 권한이 없는 지점이 있어요.",
  ],
  ["AUTHORIZATION_SCOPE_CHECK", "현재 권한으로 조회 범위를 확인할 수 없어요."],
])(
  "shows the reason for %s and hides denied detail rows",
  async (code, reason) => {
    mocks.execute.mockResolvedValue(response({}));
    mocks.api.mockImplementation(async (path: string) => {
      if (path.startsWith("/ai/executions/"))
        throw new ApiError(403, { code, message: "권한 거절" });
      return { ready: true };
    });
    show();
    const user = await ask("이번 달 매출");
    await user.click(await screen.findByRole("button", { name: "표로 보기" }));
    expect(
      await screen.findByText(
        `${reason} 조회 범위를 줄여 조건을 변경하거나 다시 질문해 주세요.`,
      ),
    ).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "막대" }));
    expect(screen.getByText("현재 조건으로 결과를 볼 수 없어요")).toBeVisible();
    expect(screen.queryByText("25,000원")).not.toBeInTheDocument();
  },
);

it("clears earlier results when a successful response reports permission loss", async () => {
  mocks.execute.mockResolvedValueOnce(response({}));
  mocks.execute.mockResolvedValueOnce(
    response({
      context: {
        basedOnExecutionId: null,
        inherited: [],
        changed: [],
        reset: true,
        resetReason: "PERMISSION_LOST",
      },
    }),
  );
  show();
  await ask("지점별 매출");
  await screen.findByText("순매출");
  await ask("다시 조회");
  await screen.findByText(/이전 결과의 지점 권한이 바뀌어/);
  expect(screen.queryByText("지점별 매출")).not.toBeInTheDocument();
  const answer = await screen.findByRole("region", {
    name: "지점별 매출 비교 결과",
  });
  expect(
    within(answer).getByText(/이전 결과의 지점 권한이 바뀌어/),
  ).toBeVisible();
  expect(within(answer).queryByText("유지")).not.toBeInTheDocument();
  expect(within(answer).queryByText("변경된 조건")).not.toBeInTheDocument();
});

it("uses server page metadata and resets the page and sort when switching data kinds", async () => {
  const answer = response({});
  const source = answer.envelope!.datasets[0];
  answer.envelope!.datasets.push({ ...source, id: "comparison" });
  mocks.execute.mockResolvedValue(answer);
  mocks.api.mockImplementation(async (path: string) => {
    if (!path.startsWith("/ai/executions/")) return { ready: true };
    const query = new URL(path, "http://localhost").searchParams;
    return {
      envelope: {
        ...answer.envelope,
        asOf: "2026-11-11T09:01:00+09:00",
        datasets: answer.envelope!.datasets.map((dataset) => ({
          ...dataset,
          totalElements: 21,
          page: Number(query.get("page")),
          size: Number(query.get("size")),
        })),
      },
    };
  });
  show();
  const user = await ask("이번 달 매출");
  await user.click(await screen.findByRole("button", { name: "표로 보기" }));
  await user.click(await screen.findByRole("button", { name: "다음" }));
  expect(await screen.findByText("2페이지 · 총 21개")).toBeVisible();
  const table = screen.getByRole("table", { name: "결과 데이터 표" });
  await user.click(
    within(table).getByRole("button", { name: "net_krw (KRW)" }),
  );
  await waitFor(() =>
    expect(mocks.api).toHaveBeenCalledWith(
      "/ai/executions/exec-1?datasetId=branchSales&page=1&size=20&sort=net_krw&direction=desc",
      expect.anything(),
    ),
  );
  await user.selectOptions(screen.getByLabelText("데이터 종류"), "comparison");
  await waitFor(() =>
    expect(mocks.api).toHaveBeenLastCalledWith(
      "/ai/executions/exec-1?datasetId=comparison&page=1&size=20",
      expect.anything(),
    ),
  );
  expect(await screen.findByText("1페이지 · 총 21개")).toBeVisible();
  expect(screen.getByText(/표 기준 시각/)).toHaveTextContent("09:01");
});

it("shows an AI-generated answer with its own conditions and no condition editing (#122)", async () => {
  const generated = {
    ...generatedResponse(),
    conversationId: "conv-g",
    traceId: "trc-g",
    httpStatus: 200,
    message: null,
    stages: [],
    clarificationOptions: [],
    retrievedCandidates: [],
    securityGate: {},
    summary: {},
    conditions: {
      analysisId: null,
      period: null,
      periodSource: null,
      branchIds: ["1"],
      productIds: [],
      refundBasis: "processed",
      zeroFill: null,
    },
    context: { inherited: [], changed: [], reset: false, resetReason: null },
    editableFilters: { period: null, branches: { single: false }, products: false },
  } as unknown as AiQueryResponseDto;
  mocks.execute.mockResolvedValue(generated);
  mocks.api.mockImplementation(async (path: string) =>
    path.startsWith("/ai/executions/")
      ? { ...generated, id: "exec-g", querySpec: [generated.querySpec] }
      : { ready: true },
  );
  show();
  await ask("이번 달 지점별 결제 금액 합계 보여줘");
  expect(await screen.findByRole("heading", { name: "지점별 결제 승인액", level: 3 })).toBeVisible();
  const conditions = screen.getByText("적용 조건").parentElement!;
  expect(within(conditions).getByText("AI 생성 조회")).toBeVisible();
  expect(within(conditions).getByText("결제 승인액")).toBeVisible();
  expect(within(conditions).getByText("2026-11-01 ~ 2026-11-30")).toBeVisible();
  expect(within(conditions).getByText("강남점")).toBeVisible();
  expect(screen.queryByRole("button", { name: "조건 변경" })).not.toBeInTheDocument();
  expect(screen.getAllByText("가온점").length).toBeGreaterThan(0);
  expect(screen.queryByText("지원하는 결과 표시 명세가 없어요.")).not.toBeInTheDocument();
});

it("shows a generated answer whose context is empty, as the backend first sent it (#122 browser check)", async () => {
  const generated = {
    ...generatedResponse(),
    conversationId: "conv-g",
    traceId: "trc-g",
    httpStatus: 200,
    message: null,
    stages: [],
    clarificationOptions: [],
    retrievedCandidates: [],
    securityGate: {},
    summary: {},
    conditions: {
      analysisId: null,
      period: null,
      periodSource: null,
      branchIds: ["1"],
      productIds: [],
      refundBasis: "processed",
      zeroFill: null,
    },
    context: {},
    editableFilters: { period: null, branches: { single: false }, products: false },
  } as unknown as AiQueryResponseDto;
  mocks.execute.mockResolvedValue(generated);
  mocks.api.mockImplementation(async (path: string) =>
    path.startsWith("/ai/executions/") ? generated : { ready: true },
  );
  show();
  await ask("이번 달 지점별 결제 금액 합계 보여줘");
  expect(await screen.findByRole("heading", { name: "지점별 결제 승인액", level: 3 })).toBeVisible();
  expect(screen.getAllByText("가온점").length).toBeGreaterThan(0);
});
