import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Ai } from "./Ai";
import type { CurrentUser } from "../../shared/domain/schema";
import type { AiQueryResponseDto } from "./domainlens";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  execute: vi.fn(),
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
}));
vi.mock("./Charts", () => ({
  ViewSpecRenderer: ({ activeView }: { activeView?: string }) => (
    <p>결과 화면: {activeView}</p>
  ),
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
          id: "comp_bar",
          componentRef: { id: "BAR_CHART", version: "1.0.0" },
          datasetId: "branchSales",
          bindings: {},
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
      ],
      asOf: "2026-11-06T05:00:00Z",
      snapshotVersion: "s1",
      policyVersion: "p1",
      warnings: [],
    },
    summary: {},
    truncation: null,
    clarificationOptions: [],
    stages: [],
    retrievedCandidates: [],
    securityGate: {},
    legacyExecution: null,
    ...over,
  } as AiQueryResponseDto;
}
let client: QueryClient;
beforeEach(() => {
  mocks.context = { session: session(["ai:read", "sales:read"]), scope: "1" };
  mocks.api.mockResolvedValue({ ready: true });
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
  return render(
    <QueryClientProvider client={client}>
      <Ai />
    </QueryClientProvider>,
  );
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
  mocks.execute.mockResolvedValue(response({ message: "강남점 매출이에요." }));
  show();
  await ask("이번 달 매출");
  expect(mocks.execute).toHaveBeenCalledWith(
    { question: "이번 달 매출", scope: "1", clarificationChoice: undefined },
    expect.any(AbortSignal),
  );
  expect(await screen.findByText("강남점 매출이에요.")).toBeInTheDocument();
  expect(screen.getByText("이번 달 매출")).toBeInTheDocument();
  expect(screen.getByText("25,000원")).toBeInTheDocument();
  expect(screen.getByText("결과 화면: bar")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "표" }));
  expect(screen.getByText("결과 화면: table")).toBeInTheDocument();
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
  expect(screen.queryByText(/결과 화면/)).not.toBeInTheDocument();
});

it("resends a clarification choice with its option id", async () => {
  mocks.execute
    .mockResolvedValueOnce(
      response({
        status: "CLARIFICATION",
        envelope: null,
        message: "어떤 매출을 볼까요?",
        clarificationOptions: [
          { id: "branch-sales", label: "이번 달 지점별 매출을 비교해줘" },
        ],
      }),
    )
    .mockResolvedValueOnce(response({}));
  show();
  const user = await ask("매출");
  await user.click(
    await screen.findByRole("button", {
      name: "이번 달 지점별 매출을 비교해줘",
    }),
  );
  await waitFor(() =>
    expect(mocks.execute).toHaveBeenLastCalledWith(
      {
        question: "이번 달 지점별 매출을 비교해줘",
        scope: "1",
        clarificationChoice: "branch-sales",
      },
      expect.any(AbortSignal),
    ),
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
