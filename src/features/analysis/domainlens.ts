import type { components } from "../../shared/api/foundation.generated";
import { z } from "zod";
import {
  api,
  API_BASE,
  ApiError,
  clearCsrf,
  csrf,
} from "../../shared/api/client";

export const COMPONENT_TYPES = [
  "HEATMAP",
  "RANKED_BAR_CHART",
  "SEAT_MAP",
  "WEEK_CALENDAR",
  "TASK_LIST",
  "LINE_CHART",
  "BAR_CHART",
  "KPI",
  "DATA_TABLE",
] as const;

export type ViewComponentType = (typeof COMPONENT_TYPES)[number];

export function normalizeComponentType(
  raw: string,
): ViewComponentType | undefined {
  return COMPONENT_TYPES.find((type) => type === raw);
}

const VIEW_MODE: Record<ViewComponentType, string> = {
  HEATMAP: "heatmap",
  RANKED_BAR_CHART: "ranked_bar",
  SEAT_MAP: "seat_map",
  WEEK_CALENDAR: "week_calendar",
  TASK_LIST: "task_list",
  LINE_CHART: "line",
  BAR_CHART: "bar",
  KPI: "kpi",
  DATA_TABLE: "table",
};

export function toViewMode(type: ViewComponentType) {
  return VIEW_MODE[type];
}

export const datasetColumnSchema = z.object({
  alias: z.string(),
  /** Display name; generated results carry compiler aliases (d0, m0), so the label comes from their QuerySpec. */
  label: z.string().optional(),
  type: z.string(),
  unit: z.string().nullable().optional(),
  precision: z.number().nullable().optional(),
});

export const typedDatasetSchema = z.object({
  id: z.string(),
  columns: z.array(datasetColumnSchema).default([]),
  rows: z.array(z.record(z.string(), z.unknown())).default([]),
  totalElements: z.number().optional().default(0),
  page: z.number().optional().default(0),
  size: z.number().optional().default(50),
  snapshotAt: z.string().nullable().optional(),
  asOf: z.string().nullable().optional(),
});

export type TypedDatasetDto = z.infer<typeof typedDatasetSchema>;

export const viewSpecComponentSchema = z.object({
  id: z.string(),
  componentRef: z.object({
    id: z.string(),
    version: z.string().optional().default("1.0.0"),
  }),
  datasetId: z.string().nullable().optional(),
  bindings: z.record(z.string(), z.unknown()).optional().default({}),
  options: z.record(z.string(), z.unknown()).optional().default({}),
  events: z
    .array(z.object({ event: z.string(), actionId: z.string() }))
    .optional()
    .default([]),
});

export type ViewSpecComponentDto = z.infer<typeof viewSpecComponentSchema>;

export const viewSpecEnvelopeSchema = z.object({
  catalogVersion: z.string().optional().default("openstudy-ui-1.0.0"),
  components: z.array(viewSpecComponentSchema).default([]),
  layout: z.record(z.string(), z.unknown()).optional(),
});

export type ViewSpecEnvelopeDto = z.infer<typeof viewSpecEnvelopeSchema>;

export const resultEnvelopeSchema = z.object({
  requestId: z.string(),
  executionId: z.string().nullable().optional(),
  status: z.string(),
  datasets: z.array(typedDatasetSchema).default([]),
  view: viewSpecEnvelopeSchema.nullable().optional(),
  warnings: z.array(z.string()).optional().default([]),
  errorCode: z.string().nullable().optional(),
  asOf: z.string().nullable().optional(),
  snapshotVersion: z.string().nullable().optional(),
  policyVersion: z.string().nullable().optional(),
  notice: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type ResultEnvelopeDto = z.infer<typeof resultEnvelopeSchema>;

type AiSchema = components["schemas"];
export type AiQueryResponseDto = AiSchema["AiQueryResponse"];
export type AiQueryRequest = AiSchema["AiQueryRequest"];
export type AiReadiness = AiSchema["AiReadiness"];
export type AiConversationSummary = AiSchema["AiConversationSummary"];
export type StageSpanDto = AiSchema["AiStage"];
export type ClarificationOptionDto = AiSchema["AiClarificationOption"];

export interface ParsedAiResult {
  title: string;
  primaryComponent: ViewComponentType;
  componentTypes: ViewComponentType[];
  datasetList: TypedDatasetDto[];
  viewSpec: ViewSpecEnvelopeDto | null;
  asOf: string | null;
  snapshotVersion: string | null;
  policyVersion: string | null;
  warnings: string[];
  truncation?: AiSchema["AiTruncation"];
  notice?: string;
  /** Set for a result the AI generated (no registered analysis): what it measured, grouped and over which period. */
  generated?: GeneratedConditions;
}

export interface GeneratedConditions {
  metrics: string[];
  dimensions: string[];
  period: { from: string; to: string } | null;
}

/**
 * Generated views name catalog components (PaginatedDataTable, BarChart, KpiGroup …). They render with the same
 * table, bar, line and KPI views as registered results; their page/sort/CSV events are the result screen's own.
 */
const GENERATED_COMPONENTS: Record<string, ViewComponentType> = {
  DataTable: "DATA_TABLE",
  PaginatedDataTable: "DATA_TABLE",
  DetailCard: "DATA_TABLE",
  TABLE: "DATA_TABLE",
  KpiGroup: "KPI",
  BarChart: "BAR_CHART",
  RankList: "BAR_CHART",
  DonutChart: "BAR_CHART",
  LineChart: "LINE_CHART",
  AreaChart: "LINE_CHART",
};

/** Display names of the catalog fields and metrics a generated query can select (OpenStudy semantic catalog). */
export const FIELD_LABELS: Record<string, string> = {
  "sales.approved_amount_krw": "결제 승인액",
  "sales.approved_count": "결제 건수",
  "passes.issued_count": "이용권 발급 수",
  "branch.name": "지점",
  "payment.item_type": "상품 구분",
  "payment.status": "결제 상태",
  "pass.pass_type": "이용권 구분",
  "payment.paid_at": "결제 시각",
  "pass.issued_at": "발급 시각",
};

const selectionSchema = z.object({ field: z.string(), alias: z.string() });
const querySpecSchema = z.object({
  id: z.string(),
  mode: z.string(),
  dimensions: z.array(selectionSchema).default([]),
  metrics: z.array(selectionSchema).default([]),
  filter: z.unknown().optional(),
});
type GeneratedQuery = z.infer<typeof querySpecSchema>;

/** The QuerySpecs of a response: one object, a list (a saved generated result) or none. */
function querySpecsOf(raw: unknown): GeneratedQuery[] {
  const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  return list.flatMap((item) => {
    const parsed = querySpecSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

function fieldLabel(field: string) {
  return FIELD_LABELS[field] ?? field;
}

const KST_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

type FilterLeaf = { field?: unknown; operator?: unknown; values?: unknown };

/** A [from, to) instant range on one field as Asia/Seoul dates, both ends inclusive. */
export function periodOf(filter: unknown): GeneratedConditions["period"] {
  const leaves: FilterLeaf[] = [];
  const collect = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (record.kind === "leaf") leaves.push(record);
    else if (record.junction === "AND" && Array.isArray(record.children))
      record.children.forEach(collect);
  };
  collect(filter);
  const first = (leaf?: FilterLeaf) =>
    Array.isArray(leaf?.values) ? Date.parse(String(leaf.values[0])) : NaN;
  const start = leaves.find((leaf) => leaf.operator === "GTE");
  const end = leaves.find(
    (leaf) => leaf.operator === "LT" && leaf.field === start?.field,
  );
  const from = first(start);
  const to = first(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  return { from: KST_DATE.format(from), to: KST_DATE.format(to - 1) };
}

function normalizeGeneratedView(
  view: ViewSpecEnvelopeDto,
): ViewSpecEnvelopeDto {
  return {
    ...view,
    components: view.components.flatMap((component) => {
      const type =
        GENERATED_COMPONENTS[component.componentRef.id] ??
        normalizeComponentType(component.componentRef.id);
      return type
        ? [
            {
              ...component,
              componentRef: { id: type, version: "1.0.0" },
              events: [],
            },
          ]
        : [];
    }),
  };
}

// Parse untrusted results before passing datasets and ViewSpec to the renderer.
export function parseAiResult(raw: unknown): ParsedAiResult {
  const response = raw as AiQueryResponseDto;
  const envelope = resultEnvelopeSchema.safeParse(response.envelope);
  if (!envelope.success) throw new Error("AI 결과의 형식이 올바르지 않아요.");

  const data = envelope.data;
  const view = viewSpecEnvelopeSchema.safeParse(response.viewSpec ?? data.view);
  const queries = querySpecsOf(
    (response as { querySpec?: unknown }).querySpec,
  );
  // A registered analysis runs as REGISTERED_ANALYSIS; any other query was generated (OpenStudy-Backend#233).
  const isGenerated =
    queries.length > 0 &&
    queries.every((query) => query.mode !== "REGISTERED_ANALYSIS");
  const viewSpec = view.success
    ? isGenerated
      ? normalizeGeneratedView(view.data)
      : view.data
    : null;
  const labels = new Map(
    queries.flatMap((query) =>
      [...query.dimensions, ...query.metrics].map(
        (selection) => [selection.alias, fieldLabel(selection.field)] as const,
      ),
    ),
  );
  const datasetList = isGenerated
    ? data.datasets.map((dataset) => ({
        ...dataset,
        columns: dataset.columns.map((column) => ({
          ...column,
          label: column.label ?? labels.get(column.alias),
        })),
      }))
    : data.datasets;
  const generated: GeneratedConditions | undefined = isGenerated
    ? {
        metrics: [
          ...new Set(
            queries.flatMap((q) => q.metrics.map((m) => fieldLabel(m.field))),
          ),
        ],
        dimensions: [
          ...new Set(
            queries.flatMap((q) =>
              q.dimensions.map((d) => fieldLabel(d.field)),
            ),
          ),
        ],
        period: periodOf(queries[0]?.filter),
      }
    : undefined;
  const componentTypes = COMPONENT_TYPES.filter((type) =>
    viewSpec?.components.some(
      (component) => component.componentRef.id === type,
    ),
  );
  const question = POC_QUESTIONS.find(
    (q) => q.code === response.pocCode || q.analysisId === response.analysisId,
  );
  const notice = z.object({ message: z.string() }).safeParse(data.notice);
  return {
    title:
      question?.shortLabel ??
      (generated
        ? `${generated.dimensions.length ? `${generated.dimensions.join("·")}별 ` : ""}${generated.metrics.join("·")}`
        : "AI 데이터 분석 결과"),
    primaryComponent: componentTypes[0] ?? "DATA_TABLE",
    componentTypes,
    datasetList,
    viewSpec,
    asOf: data.asOf ?? null,
    snapshotVersion: data.snapshotVersion ?? null,
    policyVersion: data.policyVersion ?? null,
    warnings: data.warnings,
    truncation: response.truncation,
    notice: notice.success ? notice.data.message : undefined,
    generated,
  };
}

export interface PocQuestionSpec {
  code: string;
  analysisId: string;
  domain: "매출" | "좌석" | "이용권" | "스터디룸" | "업무" | "근태";
  domainKey: string;
  question: string;
  shortLabel: string;
  targetComponents: ViewComponentType[];
  requiresSalesRead: boolean;
}

export const POC_QUESTIONS: PocQuestionSpec[] = [
  {
    code: "POC-001",
    analysisId: "openstudy.sales.branchComparison",
    domain: "매출",
    domainKey: "sales",
    question: "이번 달 지점별 매출을 비교해줘",
    shortLabel: "지점별 매출 비교",
    targetComponents: ["KPI", "BAR_CHART", "DATA_TABLE"],
    requiresSalesRead: true,
  },
  {
    code: "POC-002",
    analysisId: "openstudy.seats.hourlyCongestion",
    domain: "좌석",
    domainKey: "seats",
    question: "강남점은 언제 가장 붐벼?",
    shortLabel: "요일·시간대 혼잡도",
    targetComponents: ["HEATMAP"],
    requiresSalesRead: false,
  },
  {
    code: "POC-003",
    analysisId: "openstudy.passes.topProducts",
    domain: "이용권",
    domainKey: "passes",
    question: "지난달 가장 잘 팔린 이용권 TOP 5를 보여줘",
    shortLabel: "인기 이용권 TOP 5",
    targetComponents: ["RANKED_BAR_CHART", "DATA_TABLE"],
    requiresSalesRead: true,
  },
  {
    code: "POC-004",
    analysisId: "openstudy.seats.realtimeAvailability",
    domain: "좌석",
    domainKey: "seats",
    question: "지금 강남점에 빈자리가 얼마나 있어?",
    shortLabel: "실시간 좌석 현황",
    targetComponents: ["KPI", "SEAT_MAP"],
    requiresSalesRead: false,
  },
  {
    code: "POC-005",
    analysisId: "openstudy.rooms.weeklyReservations",
    domain: "스터디룸",
    domainKey: "rooms",
    question: "이번 주 스터디룸 예약 현황을 보여줘",
    shortLabel: "스터디룸 예약 현황",
    targetComponents: ["WEEK_CALENDAR", "DATA_TABLE"],
    requiresSalesRead: false,
  },
  {
    code: "POC-006",
    analysisId: "openstudy.passes.expiringSoon",
    domain: "이용권",
    domainKey: "passes",
    question: "앞으로 7일 이내에 만료되는 이용권을 보여줘",
    shortLabel: "만료 예정 이용권",
    targetComponents: ["KPI", "DATA_TABLE"],
    requiresSalesRead: false,
  },
  {
    code: "POC-007",
    analysisId: "openstudy.sales.dailyTrend",
    domain: "매출",
    domainKey: "sales",
    question: "지난달 일별 매출 추이를 그래프로 보여줘",
    shortLabel: "일별 매출 추이",
    targetComponents: ["LINE_CHART", "DATA_TABLE"],
    requiresSalesRead: true,
  },
  {
    code: "POC-008",
    analysisId: "openstudy.sales.byItemType",
    domain: "매출",
    domainKey: "sales",
    question:
      "지난달 이용권, 스터디룸, 사물함 중 어디서 매출이 가장 많이 나왔어?",
    shortLabel: "항목별 매출 비중",
    targetComponents: ["BAR_CHART", "KPI"],
    requiresSalesRead: true,
  },
  {
    code: "POC-009",
    analysisId: "openstudy.tasks.urgentTodo",
    domain: "업무",
    domainKey: "tasks",
    question: "지금 급하게 처리해야 할 업무가 뭐야?",
    shortLabel: "긴급 처리 업무",
    targetComponents: ["TASK_LIST"],
    requiresSalesRead: false,
  },
  {
    code: "POC-010",
    analysisId: "openstudy.attendance.weeklyWorkMinutes",
    domain: "근태",
    domainKey: "attendance",
    question: "지난주 직원별 근무시간을 비교해줘",
    shortLabel: "직원별 근무시간 비교",
    targetComponents: ["BAR_CHART", "DATA_TABLE"],
    requiresSalesRead: false,
  },
];

/**
 * POST /ai/queries. Unlike the generic client, a refused query (403·422·429) still carries the AI response body
 * (status, errorCode, message), so it is returned instead of thrown. The request sends the session CSRF token like
 * every other command; a lost session raises the shared session-expired event.
 */
export async function executeAiQuery(
  payload: AiQueryRequest,
  signal?: AbortSignal,
): Promise<AiQueryResponseDto> {
  const token = await csrf();
  signal?.throwIfAborted();
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/ai/queries`, {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": token,
      },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, {
      code: "NETWORK_ERROR",
      message: "연결하지 못했습니다. 네트워크와 서버를 확인해 주세요.",
    });
  }
  let body: unknown;
  try {
    const text = await response.text();
    body = text.trim() ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  signal?.throwIfAborted();
  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  if (response.status === 401) {
    clearCsrf();
    window.dispatchEvent(new Event("openstudy:session-expired"));
  }
  if (record?.code === "CSRF_INVALID") clearCsrf();
  if (
    response.status !== 401 &&
    record &&
    typeof record.status === "string" &&
    typeof record.requestId === "string"
  )
    return record as unknown as AiQueryResponseDto;
  throw new ApiError(response.status, {
    code: typeof record?.code === "string" ? record.code : "HTTP_ERROR",
    message:
      typeof record?.message === "string"
        ? record.message
        : `요청에 실패했습니다. (${response.status})`,
  });
}

export const aiConversations = {
  list: (signal?: AbortSignal) =>
    api<AiConversationSummary[]>("/ai/conversations", { signal }),
  reopen: (id: string, scope: string, signal?: AbortSignal) =>
    api<AiSchema["AiReopenedConversation"]>(
      `/ai/conversations/${encodeURIComponent(id)}?scope=${encodeURIComponent(scope)}`,
      { signal },
    ),
  rename: (id: string, title: string) =>
    api<AiSchema["AiConversationTitle"]>(
      `/ai/conversations/${encodeURIComponent(id)}`,
      { method: "PATCH", body: { title } },
    ),
  remove: (id: string) =>
    api<void>(`/ai/conversations/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
};
