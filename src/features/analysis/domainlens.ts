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
}

// Parse untrusted results before passing datasets and ViewSpec to the renderer.
export function parseAiResult(raw: unknown): ParsedAiResult {
  const response = raw as AiQueryResponseDto;
  const envelope = resultEnvelopeSchema.safeParse(response.envelope);
  if (!envelope.success) throw new Error("AI 결과의 형식이 올바르지 않아요.");

  const data = envelope.data;
  const view = viewSpecEnvelopeSchema.safeParse(response.viewSpec ?? data.view);
  const viewSpec = view.success ? view.data : null;
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
    title: question?.shortLabel ?? "AI 데이터 분석 결과",
    primaryComponent: componentTypes[0] ?? "DATA_TABLE",
    componentTypes,
    datasetList: data.datasets,
    viewSpec,
    asOf: data.asOf ?? null,
    snapshotVersion: data.snapshotVersion ?? null,
    policyVersion: data.policyVersion ?? null,
    warnings: data.warnings,
    truncation: response.truncation,
    notice: notice.success ? notice.data.message : undefined,
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

export interface SuggestedQuestion extends PocQuestionSpec {
  /** The chip text in "추천 질문". */
  label: string;
}

/**
 * The questions offered as suggestions. POC_QUESTIONS keeps one entry per registered analysis (its titles and names
 * look analyses up there); a suggestion can ask the same analysis over another period, since the server reads the
 * period a question names (OpenStudy-Backend, 2026-11-13). Last month's branch sales sit right beside this month's.
 */
export const SUGGESTED_QUESTIONS: SuggestedQuestion[] = POC_QUESTIONS.flatMap(
  (q) =>
    q.code === "POC-001"
      ? [
          { ...q, label: "이번 달 지점별 매출 비교" },
          {
            ...q,
            code: "POC-001-LAST-MONTH",
            question: "지난 달 지점별 매출을 비교해줘",
            label: "지난 달 지점별 매출 비교",
          },
        ]
      : [{ ...q, label: q.shortLabel }],
);

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
