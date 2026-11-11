import { HttpResponse } from "msw/http";
import { z } from "zod";
import type { components } from "../shared/api/foundation.generated";
import { POC_QUESTIONS } from "../features/analysis/domainlens";
import { AS_OF, can } from "../shared/domain/schema";
import { sales } from "./domain";
import { assert, DomainError, store } from "./store";
import { mockCsv } from "./export-csv";

type AiSchemas = components["schemas"];
type MockAiConditions = AiSchemas["AiConditions"];
type MockAiContext = AiSchemas["AiContext"];
type MockAiTurn = {
  question: string;
  askedAt: string;
  scope: string;
  requestId: string;
  executionId: string | null;
  conditions: MockAiConditions | null;
  sourceExecutionId: string | null;
};
const maxPeriodDays: Record<string, number | null> = {
  "POC-001": 366,
  "POC-002": 92,
  "POC-003": 366,
  "POC-004": null,
  "POC-005": 31,
  "POC-006": 92,
  "POC-007": 366,
  "POC-008": 366,
  "POC-009": null,
  "POC-010": 92,
};

function mockEditable(analysisId: string): AiSchemas["AiEditableFilters"] {
  const code =
    POC_QUESTIONS.find((poc) => poc.analysisId === analysisId)?.code ?? "";
  const maxDays = maxPeriodDays[code];
  return {
    period: maxDays ? { maxDays } : null,
    branches: { single: code === "POC-002" || code === "POC-004" },
    products: code === "POC-003" || code === "POC-006",
  };
}

/** Saved mock AI conditions of this browser session, by employee. Results are rebuilt. */
const aiConversationStore = new Map<
  string,
  {
    id: string;
    employeeId: string;
    title: string;
    scope: string;
    createdAt: string;
    lastAskedAt: string;
    questions: MockAiTurn[];
  }
>();
const aiReplay = new Map<string, ReturnType<typeof mockAiAnswer>>();

function checkAiBranches(conditions: MockAiConditions) {
  const user = store.activeUser();
  assert(
    can(user, "all", "ai:read"),
    "AI 조회 권한이 없습니다.",
    403,
    "AI_PERMISSION_DENIED",
  );
  assert(
    conditions.branchIds.every(
      (id) =>
        store.db.branches.some((branch) => branch.id === id) &&
        can(user, id, "ai:read"),
    ),
    "허용되지 않은 지점이 있습니다.",
    403,
    "BRANCH_SCOPE_DENIED",
  );
  assert(
    conditions.branchIds.length > 0,
    "현재 권한으로 조회 범위를 확인할 수 없습니다.",
    403,
    "AUTHORIZATION_SCOPE_CHECK",
  );
  const poc = POC_QUESTIONS.find(
    (candidate) => candidate.analysisId === conditions.analysisId,
  );
  assert(
    !poc?.requiresSalesRead ||
      conditions.branchIds.every((id) => can(user, id, "sales:read")),
    "매출 조회 권한이 없는 지점이 있습니다.",
    403,
    "SALES_PERMISSION_DENIED",
  );
}

function mockAiAnswer(
  turn: MockAiTurn,
  conversationId: string,
  context: MockAiContext | null = null,
) {
  const { question, scope, requestId, executionId, conditions } = turn;
  const poc = POC_QUESTIONS.find(
    (candidate) => candidate.analysisId === conditions?.analysisId,
  );
  const asOf = new Date().toISOString();
  const status = executionId ? "COMPLETED" : "CLARIFICATION";
  const data = conditions ? mockAiDataset(conditions, poc?.code) : null;
  const view = data && {
    catalogVersion: "openstudy-ui-1.0.0",
    components: [
      {
        id: "mock-ai-result",
        componentRef: {
          id: data.chart ? "BAR_CHART" : "DATA_TABLE",
          version: "1.0.0",
        },
        datasetId: data.id,
        bindings: data.chart
          ? { category: "branch_name", value: "net_krw" }
          : {},
        options: { title: data.title },
        events: [],
      },
    ],
  };
  return {
    requestId,
    executionId,
    conversationId,
    traceId: crypto.randomUUID(),
    status,
    conditions,
    context,
    editableFilters: conditions ? mockEditable(conditions.analysisId) : null,
    httpStatus: 200,
    errorCode: null,
    resultCategory: executionId ? "EXECUTED" : "CLARIFICATION",
    behavior: executionId ? "EXECUTE_ANALYSIS" : "ASK_CLARIFICATION",
    message: executionId ? null : "어떤 분석이 필요한지 더 자세히 알려 주세요.",
    pocCode: poc?.code ?? null,
    analysisId: conditions?.analysisId ?? null,
    intentDomain: poc?.domainKey ?? null,
    viewSpec: view,
    envelope: !data
      ? null
      : {
          requestId,
          executionId,
          status,
          datasets: [
            {
              id: data.id,
              columns: data.columns,
              rows: data.rows.slice(0, 1000),
              totalElements: data.rows.length,
              page: 0,
              size: 50,
              snapshotAt: asOf,
              asOf,
            },
          ],
          view,
          warnings:
            data.rows.length > 1000 ? ["최대 1,000행까지 조회했어요."] : [],
          errorCode: null,
          asOf,
          snapshotVersion: "openstudy-semantic-1.0.0",
          policyVersion: "openstudy-policy-v1",
        },
    truncation: {
      maxRows: 1000,
      pageSize: 50,
      maxChartCategories: 20,
      isTruncated: Boolean(data && data.rows.length > 1000),
      warningCode: null,
      message: null,
    },
    clarificationOptions: [],
    stages: [
      {
        stage: "accepted",
        label: "질문 접수 및 정규화",
        status: "COMPLETED",
        durationMs: 2,
        detail: question,
      },
      {
        stage: "completed",
        label: "결과 검증",
        status: "COMPLETED",
        durationMs: 4,
      },
    ],
    securityGate: {
      requestedScope: scope,
      outcome: executionId ? "EXECUTE" : "CLARIFICATION",
    },
  };
}

function mockAiDataset(conditions: MockAiConditions, code?: string) {
  checkAiBranches(conditions);
  const branches = store.db.branches.filter((branch) =>
    conditions.branchIds.includes(branch.id),
  );
  if (code === "POC-001" && conditions.period) {
    const { from, to } = conditions.period;
    const nextDay = new Date(Date.parse(to) + 86_400_000)
      .toISOString()
      .slice(0, 10);
    return {
      id: "branchSales",
      title: "지점별 매출",
      chart: true,
      columns: [
        { alias: "branch_id", type: "STRING" },
        { alias: "branch_name", type: "STRING" },
        ...["approved_krw", "refund_krw", "net_krw"].map((alias) => ({
          alias,
          type: "INTEGER",
          unit: "KRW",
          precision: 0,
        })),
      ],
      rows: sales(
        store,
        "all",
        from,
        nextDay,
        conditions.refundBasis ?? "processed",
      )
        .filter((row) => conditions.branchIds.includes(row.branchId))
        .map((row) => ({
          branch_id: row.branchId,
          branch_name: row.branch,
          approved_krw: row.approved,
          refund_krw: row.refunds,
          net_krw: row.net,
        })),
    };
  }
  // These scenarios exercise the registered analyses' editable conditions with the demo catalog.
  if (mockEditable(conditions.analysisId).products) {
    return {
      id: "selectedProducts",
      title: "대상 상품",
      chart: false,
      columns: [{ alias: "product_name", type: "STRING" }],
      rows: store.db.products
        .filter(
          (product) =>
            product.branchIds.some((id) => conditions.branchIds.includes(id)) &&
            (!conditions.productIds.length ||
              conditions.productIds.includes(product.id)),
        )
        .map((product) => ({ product_name: product.name })),
    };
  }
  return {
    id: "selectedBranches",
    title: "대상 지점",
    chart: false,
    columns: [{ alias: "branch_name", type: "STRING" }],
    rows: branches.map((branch) => ({ branch_name: branch.name })),
  };
}

function sameIds(left: string[], right: string[]) {
  return left.length === right.length && left.every((id) => right.includes(id));
}

function ownAiExecution(id: string) {
  const employeeId = store.activeUser().id;
  for (const conversation of aiConversationStore.values()) {
    if (conversation.employeeId !== employeeId) continue;
    const turn = conversation.questions.find(
      (item) => item.executionId === id || item.requestId === id,
    );
    if (turn) {
      assert(
        turn.conditions && turn.executionId,
        "다시 실행할 수 없는 질문입니다.",
        422,
        "NOT_EXECUTABLE",
      );
      return { conversation, turn, conditions: turn.conditions };
    }
  }
  throw new DomainError(404, "NOT_FOUND", "AI 실행을 찾을 수 없습니다.");
}

function mockAiPage(
  envelope: NonNullable<ReturnType<typeof mockAiAnswer>["envelope"]>,
  query: URLSearchParams,
) {
  if (
    !["datasetId", "page", "size", "sort", "direction"].some((field) =>
      query.has(field),
    )
  )
    return envelope;
  const datasetId = query.get("datasetId") ?? envelope.datasets[0]?.id;
  const dataset = envelope.datasets.find(({ id }) => id === datasetId);
  const page = Number(query.get("page") ?? 1);
  const size = Number(query.get("size") ?? 20);
  const sort = query.get("sort");
  const direction = query.get("direction") ?? "desc";
  assert(dataset, "결과에 없는 데이터 종류입니다.", 422, "VALIDATION_FAILED");
  assert(
    Number.isInteger(page) &&
      page >= 1 &&
      Number.isInteger(size) &&
      size >= 1 &&
      size <= 50,
    "페이지와 행 수를 확인해 주세요.",
    422,
    "VALIDATION_FAILED",
  );
  assert(
    direction === "asc" || direction === "desc",
    "정렬 방향을 확인해 주세요.",
    422,
    "VALIDATION_FAILED",
  );
  const rows = [...dataset.rows].slice(0, 1000);
  if (sort !== null) {
    assert(
      dataset.columns.some((column) => column.alias === sort),
      "이 데이터 종류에 없는 열입니다.",
      422,
      "VALIDATION_FAILED",
    );
    rows.sort(
      (
        left: Record<string, string | number>,
        right: Record<string, string | number>,
      ) => {
        const a = left[sort];
        const b = right[sort];
        const comparison =
          typeof a === "number" && typeof b === "number"
            ? a - b
            : String(a).localeCompare(String(b));
        return direction === "asc" ? comparison : -comparison;
      },
    );
  }
  const start = (page - 1) * size;
  return {
    ...envelope,
    datasets: envelope.datasets.map((item) =>
      item === dataset
        ? {
            ...item,
            rows: rows.slice(start, start + size),
            page,
            size,
            totalElements: rows.length,
          }
        : item,
    ),
  };
}

function refinementError(
  field: string,
  message: string,
  code = "VALIDATION_FAILED",
): never {
  throw new DomainError(422, code, message, { [field]: message });
}

function mockRefinement(
  before: MockAiConditions,
  body: Record<string, unknown>,
) {
  const editable = mockEditable(before.analysisId);
  const after = { ...before };
  const changed: MockAiContext["changed"] = [];
  for (const field of Object.keys(body)) {
    if (
      !["period", "branchIds", "productIds", "clientRequestKey"].includes(field)
    )
      refinementError(field, "기간·지점·상품만 바꿀 수 있습니다.");
  }
  if ("period" in body) {
    if (!editable.period)
      refinementError(
        "period",
        "실시간 분석은 기간을 바꿀 수 없습니다.",
        "FILTER_NOT_EDITABLE",
      );
    const period = z
      .object({ from: z.iso.date(), to: z.iso.date() })
      .strict()
      .safeParse(body.period);
    if (!period.success || period.data.from > period.data.to)
      refinementError("period", "시작일과 종료일을 확인해 주세요.");
    const { from, to } = period.data;
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
    if (days > editable.period.maxDays)
      refinementError(
        "period",
        `기간은 최대 ${editable.period.maxDays}일까지 고를 수 있습니다.`,
        "PERIOD_TOO_LONG",
      );
    if (from !== before.period?.from || to !== before.period?.to) {
      after.period = { from, to };
      after.periodSource = "EDITED";
      changed.push("PERIOD");
    }
  }
  if ("branchIds" in body) {
    const ids = z.array(z.string().min(1)).min(1).safeParse(body.branchIds);
    if (!ids.success)
      refinementError("branchIds", "지점을 하나 이상 골라 주세요.");
    const branchIds = [...new Set(ids.data)];
    if (editable.branches.single && branchIds.length !== 1)
      refinementError("branchIds", "이 분석은 한 지점만 볼 수 있습니다.");
    if (!sameIds(branchIds, before.branchIds)) {
      after.branchIds = branchIds;
      changed.push("BRANCHES");
    }
  }
  if ("productIds" in body) {
    if (!editable.products)
      refinementError(
        "productIds",
        "상품 조건을 바꿀 수 없습니다.",
        "FILTER_NOT_EDITABLE",
      );
    const ids = z.array(z.string().min(1)).max(20).safeParse(body.productIds);
    if (
      !ids.success ||
      ids.data.some(
        (id) => !store.db.products.some((product) => product.id === id),
      )
    )
      refinementError(
        "productIds",
        "고를 수 없는 상품이 있습니다. 최대 20개까지 선택할 수 있습니다.",
      );
    const productIds = [...new Set(ids.data)];
    if (!sameIds(productIds, before.productIds)) {
      after.productIds = productIds;
      changed.push("PRODUCTS");
    }
  }
  if (!["period", "branchIds", "productIds"].some((field) => field in body))
    refinementError("period", "기간·지점·상품 중 하나 이상을 보내 주세요.");
  assert(
    changed.length,
    "원래 조건과 같습니다. 바꿀 조건을 골라 주세요.",
    422,
    "NO_FILTER_CHANGE",
  );
  return { after, changed };
}

function ownAiConversation(id: string) {
  const c = aiConversationStore.get(id);
  assert(
    c?.employeeId === store.activeUser().id,
    "AI 대화를 찾을 수 없습니다.",
    404,
    "NOT_FOUND",
  );
  return c!;
}
export const mockAi = {
  readiness() {
    return {
      ready: store.scenario !== "ai-unavailable",
      mode: "mock",
      version: "openstudy-semantic-1.0.0",
      asOfKst: AS_OF,
      reasons:
        store.scenario === "ai-unavailable"
          ? ["데모 카탈로그를 준비하고 있어요."]
          : [],
      warnings: [],
    };
  },
  ask(p: Record<string, unknown>) {
    const q = String(p.question || "").trim();
    const s = String(p.scope || "all");
    const employeeId = store.activeUser().id;
    if (store.scenario === "ai-unavailable") {
      return HttpResponse.json(
        {
          requestId: crypto.randomUUID(),
          status: "NOT_READY",
          httpStatus: 503,
          errorCode: "AI_NOT_READY",
        },
        { status: 503 },
      );
    }
    const key =
      typeof p.clientRequestKey === "string"
        ? `${employeeId}:${p.clientRequestKey}`
        : undefined;
    const replay = key ? aiReplay.get(key) : undefined;
    if (replay && aiConversationStore.has(replay.conversationId)) {
      if (replay.conditions) checkAiBranches(replay.conditions);
      return { ...replay, behavior: "REPLAY" };
    }
    const asked = String(p.conversationId || "");
    const saved = asked ? aiConversationStore.get(asked) : undefined;
    assert(
      !asked || saved?.employeeId === employeeId,
      "AI 대화를 찾을 수 없습니다.",
      404,
      "NOT_FOUND",
    );
    const now = new Date().toISOString();
    const conversation = saved ?? {
      id: `conv-${crypto.randomUUID().slice(0, 8)}`,
      employeeId,
      title: q.slice(0, 40),
      scope: s,
      createdAt: now,
      lastAskedAt: now,
      questions: [],
    };
    const prior = [...conversation.questions]
      .reverse()
      .find((turn) => turn.conditions !== null);
    const namedBranch = store.db.branches.find((branch) =>
      q.includes(branch.name),
    );
    const isFollowUp =
      Boolean(namedBranch) ||
      /같은 조건|그대로|이어서|원결제일|환불 처리일|없는 날|0원인 날/.test(q);
    const resetReason = !prior
      ? "NO_PRIOR_RESULT"
      : prior.scope !== s
        ? "SCOPE_CHANGED"
        : prior.conditions?.branchIds.some(
              (id) => !can(store.activeUser(), id, "ai:read"),
            )
          ? "PERMISSION_LOST"
          : null;
    const inherited = prior && !resetReason ? prior.conditions : null;
    const explicit =
      POC_QUESTIONS.find(
        (poc) => q === poc.question || q.includes(poc.shortLabel),
      ) ?? (/지점별 매출/.test(q) ? POC_QUESTIONS[0] : undefined);
    const poc =
      explicit ??
      (isFollowUp
        ? POC_QUESTIONS.find(
            (candidate) => candidate.analysisId === inherited?.analysisId,
          )
        : undefined);
    const editable = poc ? mockEditable(poc.analysisId) : null;
    const allowedBranches = store.db.branches
      .filter(
        (branch) =>
          (s === "all" || s === branch.id) &&
          can(store.activeUser(), branch.id, "ai:read") &&
          (!poc?.requiresSalesRead ||
            can(store.activeUser(), branch.id, "sales:read")),
      )
      .map((branch) => branch.id);
    const sameAnalysis = inherited?.analysisId === poc?.analysisId;
    const branchIds =
      namedBranch && allowedBranches.includes(namedBranch.id)
        ? [namedBranch.id]
        : (inherited?.branchIds ?? allowedBranches);
    const conditions: MockAiConditions | null =
      poc &&
      editable &&
      branchIds.length &&
      (!editable.branches.single || branchIds.length === 1)
        ? {
            analysisId: poc.analysisId,
            period:
              sameAnalysis && inherited
                ? inherited.period
                : editable.period
                  ? { from: "2026-10-01", to: "2026-10-17" }
                  : null,
            periodSource:
              sameAnalysis && inherited
                ? inherited.periodSource
                : editable.period
                  ? "DEFAULT"
                  : null,
            branchIds,
            productIds: sameAnalysis && inherited ? inherited.productIds : [],
            refundBasis:
              poc.domainKey === "sales"
                ? q.includes("원결제일")
                  ? "original"
                  : q.includes("환불 처리일")
                    ? "processed"
                    : (inherited?.refundBasis ?? "processed")
                : null,
            zeroFill:
              poc.code === "POC-007"
                ? /없는 날|0원인 날/.test(q) || Boolean(inherited?.zeroFill)
                : null,
          }
        : null;
    const context: MockAiContext | null = conditions
      ? {
          basedOnExecutionId: inherited ? (prior?.executionId ?? null) : null,
          inherited: [],
          changed: [],
          reset:
            resetReason === "SCOPE_CHANGED" ||
            resetReason === "PERMISSION_LOST",
          resetReason,
        }
      : null;
    if (context && inherited && conditions) {
      (sameAnalysis ? context.inherited : context.changed).push("ANALYSIS");
      (sameIds(conditions.branchIds, inherited.branchIds)
        ? context.inherited
        : context.changed
      ).push("BRANCHES");
      if (sameAnalysis && conditions.period) context.inherited.push("PERIOD");
      if (sameAnalysis && editable?.products)
        context.inherited.push("PRODUCTS");
      if (sameAnalysis && conditions.refundBasis !== null)
        (conditions.refundBasis === inherited.refundBasis
          ? context.inherited
          : context.changed
        ).push("REFUND_BASIS");
      if (sameAnalysis && conditions.zeroFill !== null)
        (conditions.zeroFill === inherited.zeroFill
          ? context.inherited
          : context.changed
        ).push("ZERO_FILL");
    }
    const turn: MockAiTurn = {
      question: q,
      askedAt: now,
      scope: s,
      requestId: crypto.randomUUID(),
      executionId: conditions ? crypto.randomUUID() : null,
      conditions,
      sourceExecutionId: null,
    };
    const answer = mockAiAnswer(turn, conversation.id, context);
    conversation.lastAskedAt = now;
    conversation.questions.push(turn);
    aiConversationStore.set(conversation.id, conversation);
    if (key) aiReplay.set(key, answer);
    return answer;
  },
  recent() {
    const employeeId = store.activeUser().id;
    const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const items = [...aiConversationStore.values()]
      .filter((conversation) => conversation.employeeId === employeeId)
      .flatMap((conversation) =>
        conversation.questions
          .filter((turn) => !turn.sourceExecutionId && turn.askedAt >= cutoff)
          .map((turn) => ({
            requestId: turn.requestId,
            executionId: turn.executionId,
            conversationId: conversation.id,
            conversationTitle: conversation.title,
            question: turn.question,
            status: turn.executionId ? "COMPLETED" : "CLARIFICATION",
            analysisId: turn.conditions?.analysisId ?? null,
            askedAt: turn.askedAt,
            rerunnable: Boolean(turn.executionId),
          })),
      )
      .sort((a, b) => b.askedAt.localeCompare(a.askedAt))
      .slice(0, 20);
    return { items };
  },
  execution(id: string, query: URLSearchParams) {
    const { conversation, turn, conditions } = ownAiExecution(id);
    const answer = mockAiAnswer(turn, conversation.id);
    return {
      id: turn.executionId,
      requestId: turn.requestId,
      conversationId: conversation.id,
      question: turn.question,
      status: "READY",
      pocCode: answer.pocCode,
      analysisId: conditions.analysisId,
      intentDomain: answer.intentDomain,
      envelope: mockAiPage(answer.envelope!, query),
      conditions,
      editableFilters: answer.editableFilters,
      origin: turn.sourceExecutionId ? "REFINEMENT" : "QUESTION",
      sourceExecutionId: turn.sourceExecutionId,
    };
  },
  export(id: string, datasetId: string | null) {
    assert(
      store.scenario !== "forbidden",
      "AI 조회 권한이 없습니다.",
      403,
      "AI_PERMISSION_DENIED",
    );
    assert(
      store.scenario !== "rate-limited",
      "잠시 후 다시 시도해 주세요.",
      429,
      "RATE_LIMITED",
    );
    assert(
      store.scenario !== "error",
      "AI 분석을 지금 사용할 수 없습니다.",
      503,
      "AI_NOT_READY",
    );
    const { turn, conditions } = ownAiExecution(id);
    const code = POC_QUESTIONS.find(
      (poc) => poc.analysisId === conditions.analysisId,
    )?.code;
    const dataset = mockAiDataset(conditions, code);
    assert(
      datasetId === null || datasetId === dataset.id,
      "결과에 없는 데이터셋입니다.",
      422,
      "VALIDATION_FAILED",
    );
    const { period, branchIds, productIds, refundBasis, zeroFill } = conditions;
    return mockCsv({
      title: `AI 분석 결과 · ${turn.question}`,
      filename: "AI 분석 결과",
      asOf: new Date().toISOString(),
      conditions: [
        `분석 ${conditions.analysisId}`,
        `데이터셋 ${dataset.id}`,
        `기간 ${period ? `${period.from} ~ ${period.to} (Asia/Seoul)` : "실시간"}`,
        `지점 ${store.db.branches
          .filter((branch) => branchIds.includes(branch.id))
          .map((branch) => branch.name)
          .join(", ")}`,
        productIds.length ? `상품 ID ${productIds.join(", ")}` : "",
        refundBasis
          ? `환불 기준 ${refundBasis === "original" ? "원결제일" : "처리일"}`
          : "",
        zeroFill ? "0원 날짜 포함" : "",
      ]
        .filter(Boolean)
        .join(" · "),
      money: dataset.columns.some(
        (column) => "unit" in column && column.unit === "KRW",
      ),
      columns: dataset.columns.map((column) =>
        "unit" in column && column.unit
          ? `${column.alias}(${column.unit})`
          : column.alias,
      ),
      rows: dataset.rows.map((row) =>
        dataset.columns.map(
          ({ alias }) => (row as Record<string, unknown>)[alias],
        ),
      ),
    });
  },
  refine(id: string, body: Record<string, unknown>) {
    const { conversation, turn, conditions } = ownAiExecution(id);

    const key =
      body.clientRequestKey == null
        ? undefined
        : z
            .string()
            .regex(/^[A-Za-z0-9._:-]{1,100}$/)
            .safeParse(body.clientRequestKey);
    if (key && !key.success)
      refinementError("clientRequestKey", "요청 키의 형식을 확인해 주세요.");
    const replayKey = key?.success
      ? `${conversation.employeeId}:${key.data}`
      : undefined;
    const replay = replayKey ? aiReplay.get(replayKey) : undefined;
    if (replay?.conditions && aiConversationStore.has(replay.conversationId)) {
      checkAiBranches(replay.conditions);
      return { ...replay, behavior: "REPLAY" };
    }
    const { after, changed } = mockRefinement(conditions, body);
    const inherited: MockAiContext["inherited"] = ["ANALYSIS"];
    if (after.period && !changed.includes("PERIOD")) inherited.push("PERIOD");
    if (!changed.includes("BRANCHES")) inherited.push("BRANCHES");
    if (!changed.includes("PRODUCTS")) inherited.push("PRODUCTS");
    if (after.refundBasis !== null) inherited.push("REFUND_BASIS");
    if (after.zeroFill !== null) inherited.push("ZERO_FILL");
    const next = {
      ...turn,
      requestId: crypto.randomUUID(),
      executionId: crypto.randomUUID(),
      askedAt: new Date().toISOString(),
      conditions: after,
      sourceExecutionId: turn.executionId,
    };
    const answer = mockAiAnswer(next, conversation.id, {
      basedOnExecutionId: turn.executionId,
      inherited,
      changed,
      reset: false,
      resetReason: null,
    });
    conversation.questions.push(next);
    conversation.lastAskedAt = next.askedAt;
    if (replayKey) aiReplay.set(replayKey, answer);
    return answer;
  },
  list() {
    const employeeId = store.activeUser().id;
    return [...aiConversationStore.values()]
      .filter((c) => c.employeeId === employeeId)
      .sort((x, y) => y.lastAskedAt.localeCompare(x.lastAskedAt))
      .map(({ id, title, scope, createdAt, lastAskedAt }) => ({
        id,
        title,
        scope,
        createdAt,
        lastAskedAt,
      }));
  },
  reopen(id: string, scope: string | null) {
    const c = ownAiConversation(id);
    const s = scope || c.scope;
    return {
      id: c.id,
      title: c.title,
      scope: s,
      turns: c.questions.map((t) => {
        let answer;
        try {
          answer = mockAiAnswer(t, c.id);
        } catch (error) {
          if (!(error instanceof DomainError)) throw error;
          answer = {
            requestId: t.requestId,
            executionId: t.executionId,
            conversationId: c.id,
            status: "REFUSED",
            httpStatus: error.status,
            errorCode: error.code,
            message: error.message,
            context: null,
          };
        }
        return {
          question: t.question,
          askedAt: t.askedAt,
          origin: t.sourceExecutionId ? "REFINEMENT" : "QUESTION",
          sourceExecutionId: t.sourceExecutionId,
          response: {
            ...answer,
            executionId: null,
            conditions: null,
            editableFilters: null,
            context: null,
            resultCategory: "REOPENED",
            message:
              answer.status === "COMPLETED"
                ? "저장된 질문을 현재 권한과 기준 시각으로 다시 조회했어요."
                : answer.message,
          },
        };
      }),
    };
  },
  rename(id: string, body: Record<string, unknown>) {
    const c = ownAiConversation(id);
    const title = String(body.title || "").trim();
    assert(
      title.length > 0 && title.length <= 200,
      "대화 제목은 1~200자로 입력해 주세요.",
      422,
      "VALIDATION_FAILED",
    );
    c.title = title;
    return { id: c.id, title };
  },
  remove(id: string) {
    const c = ownAiConversation(id);
    aiConversationStore.delete(c.id);
  },
};
