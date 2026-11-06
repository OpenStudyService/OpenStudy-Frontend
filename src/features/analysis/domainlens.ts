import { z } from "zod";
import {
  api,
  API_BASE,
  ApiError,
  clearCsrf,
  csrf,
} from "../../shared/api/client";

/**
 * Supported ViewSpec component types across OpenStudy × DomainLens (OS-DL-0601).
 * Includes the 9 canonical ViewSpec component types from expected_viewspec.json
 * plusCLARIFICATION and legacy lowercase aliases ("bar", "line", "table").
 */
export const COMPONENT_TYPES = [
  "KPI",
  "BAR_CHART",
  "LINE_CHART",
  "RANKED_BAR_CHART",
  "DATA_TABLE",
  "TABLE",
  "HEATMAP",
  "SEAT_MAP",
  "WEEK_CALENDAR",
  "TASK_LIST",
  "CLARIFICATION",
] as const;

export type ViewComponentType = (typeof COMPONENT_TYPES)[number];

export const LEGACY_VIEW_MODES = [
  "table",
  "bar",
  "line",
  "ranked_bar",
  "heatmap",
  "seat_map",
  "week_calendar",
  "task_list",
  "kpi",
] as const;

export type LegacyViewMode = (typeof LEGACY_VIEW_MODES)[number];

const COMPONENT_LOOKUP: Record<string, ViewComponentType> = {
  KPI: "KPI",
  kpi: "KPI",
  BAR_CHART: "BAR_CHART",
  bar: "BAR_CHART",
  LINE_CHART: "LINE_CHART",
  line: "LINE_CHART",
  RANKED_BAR_CHART: "RANKED_BAR_CHART",
  ranked_bar: "RANKED_BAR_CHART",
  DATA_TABLE: "DATA_TABLE",
  TABLE: "TABLE",
  table: "DATA_TABLE",
  HEATMAP: "HEATMAP",
  heatmap: "HEATMAP",
  SEAT_MAP: "SEAT_MAP",
  seat_map: "SEAT_MAP",
  WEEK_CALENDAR: "WEEK_CALENDAR",
  week_calendar: "WEEK_CALENDAR",
  TASK_LIST: "TASK_LIST",
  task_list: "TASK_LIST",
  CLARIFICATION: "CLARIFICATION",
  clarification: "CLARIFICATION",
};

export function isSupportedComponentType(raw: string): boolean {
  return Boolean(raw && COMPONENT_LOOKUP[raw]);
}

export function normalizeComponentType(
  raw: string | undefined | null,
): ViewComponentType | null {
  if (!raw) return null;
  return COMPONENT_LOOKUP[raw] ?? COMPONENT_LOOKUP[raw.toUpperCase()] ?? null;
}

export function toViewMode(raw: string | undefined | null): string {
  const norm = normalizeComponentType(raw);
  switch (norm) {
    case "BAR_CHART":
      return "bar";
    case "LINE_CHART":
      return "line";
    case "DATA_TABLE":
    case "TABLE":
      return "table";
    case "RANKED_BAR_CHART":
      return "ranked_bar";
    case "HEATMAP":
      return "heatmap";
    case "SEAT_MAP":
      return "seat_map";
    case "WEEK_CALENDAR":
      return "week_calendar";
    case "TASK_LIST":
      return "task_list";
    case "KPI":
      return "kpi";
    default:
      return raw || "bar";
  }
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

export const salesRowSchema = z.object({
  branchId: z.string(),
  branch: z.string(),
  approved: z.number(),
  refunds: z.number(),
  net: z.number(),
});

export const executionSchema = z.object({
  id: z.string(),
  status: z.literal("READY"),
  asOf: z.string(),
  start: z.string(),
  end: z.string(),
  currency: z.literal("KRW"),
  timeZone: z.literal("Asia/Seoul"),
  refundBasis: z.enum(["processed", "original"]),
  viewSpec: z.object({ component: z.string(), title: z.string() }),
  rows: z.array(salesRowSchema),
  // Extended DomainLens Phase 5/6 fields
  requestId: z.string().optional(),
  conversationId: z.string().nullable().optional(),
  question: z.string().optional(),
  pocCode: z.string().nullable().optional(),
  analysisId: z.string().nullable().optional(),
  intentDomain: z.string().nullable().optional(),
  resultCategory: z.string().nullable().optional(),
  semanticStatus: z.string().nullable().optional(),
  snapshotVersion: z.string().nullable().optional(),
  policyVersion: z.string().nullable().optional(),
  warnings: z.array(z.string()).optional(),
  exportApprovalStatus: z.string().nullable().optional(),
  querySpec: z.record(z.string(), z.unknown()).nullable().optional(),
  envelope: resultEnvelopeSchema.nullable().optional(),
});

export type Execution = z.infer<typeof executionSchema>;

export interface StageSpanDto {
  stage: string;
  label: string;
  status: string;
  durationMs: number;
  detail: string;
}

export interface RetrievalCandidateDto {
  id: string;
  kind: string;
  score: number;
}

export interface ClarificationOptionDto {
  id: string;
  label: string;
  targetAnalysisId?: string;
  targetScope?: string;
}

export interface TruncationInfoDto {
  maxRows: number;
  pageSize: number;
  maxChartCategories: number;
  isTruncated: boolean;
  warningCode: string | null;
  message: string | null;
}

export interface AiQueryResponseDto {
  requestId: string;
  executionId: string;
  conversationId: string;
  traceId: string;
  status: string;
  httpStatus: number;
  errorCode: string | null;
  resultCategory: string;
  behavior: string;
  message: string | null;
  pocCode: string | null;
  analysisId: string | null;
  intentDomain: string | null;
  semanticStatus: string | null;
  querySpec: Record<string, unknown> | null;
  viewSpec: ViewSpecEnvelopeDto | null;
  envelope: ResultEnvelopeDto | null;
  summary: Record<string, unknown>;
  truncation: TruncationInfoDto | null;
  clarificationOptions: ClarificationOptionDto[];
  stages: StageSpanDto[];
  retrievedCandidates: RetrievalCandidateDto[];
  securityGate: Record<string, unknown>;
  legacyExecution: Execution | null;
}

export interface ParsedAiResult {
  id: string;
  requestId: string;
  executionId: string;
  status: string;
  title: string;
  primaryComponent: ViewComponentType;
  componentTypes: ViewComponentType[];
  datasets: Record<string, Record<string, unknown>[]>;
  datasetList: TypedDatasetDto[];
  salesRows: z.infer<typeof salesRowSchema>[];
  asOf: string;
  snapshotVersion: string;
  policyVersion: string;
  warnings: string[];
  pocCode: string | null;
  analysisId: string | null;
  intentDomain: string | null;
  semanticStatus: string | null;
  resultCategory: string | null;
  exportApprovalStatus: string | null;
  querySpec: Record<string, unknown> | null;
  viewSpec: ViewSpecEnvelopeDto | null;
  envelope: ResultEnvelopeDto | null;
  summary: Record<string, unknown>;
  stages: StageSpanDto[];
  retrievedCandidates: RetrievalCandidateDto[];
  securityGate: Record<string, unknown>;
  clarificationOptions: ClarificationOptionDto[];
}

/**
 * Parses either a legacy Execution payload, a ResultEnvelope, or an AiQueryResponseDto
 * into a unified ParsedAiResult supporting all 9 ViewSpec component types (OS-DL-0601).
 */
export function parseAiResult(raw: unknown): ParsedAiResult {
  if (!raw || typeof raw !== "object") {
    throw new Error("AI 결과의 형식이 지원되는 화면 계약과 일치하지 않습니다.");
  }
  const obj = raw as Record<string, unknown>;

  const envelopeRaw =
    obj.envelope && typeof obj.envelope === "object"
      ? obj.envelope
      : obj.datasets && Array.isArray(obj.datasets)
        ? obj
        : null;

  const parsedEnvelope = envelopeRaw
    ? resultEnvelopeSchema.safeParse(envelopeRaw)
    : null;
  const envelope =
    parsedEnvelope && parsedEnvelope.success ? parsedEnvelope.data : null;

  const viewSpecRaw =
    obj.viewSpec &&
    typeof obj.viewSpec === "object" &&
    "components" in (obj.viewSpec as Record<string, unknown>)
      ? obj.viewSpec
      : envelope?.view;
  const parsedView = viewSpecRaw
    ? viewSpecEnvelopeSchema.safeParse(viewSpecRaw)
    : null;
  const viewSpec =
    parsedView && parsedView.success
      ? parsedView.data
      : (envelope?.view ?? null);

  const componentTypes: ViewComponentType[] = [];
  if (viewSpec && viewSpec.components.length > 0) {
    for (const comp of viewSpec.components) {
      const norm = normalizeComponentType(comp.componentRef.id);
      if (norm && !componentTypes.includes(norm)) {
        componentTypes.push(norm);
      }
    }
  }

  if (
    obj.viewSpec &&
    typeof obj.viewSpec === "object" &&
    "component" in (obj.viewSpec as Record<string, unknown>)
  ) {
    const legacyComp = String(
      (obj.viewSpec as Record<string, unknown>).component || "",
    );
    const norm = normalizeComponentType(legacyComp);
    if (!norm) {
      throw new Error("지원하지 않는 ViewSpec 컴포넌트입니다: " + legacyComp);
    }
    if (!componentTypes.includes(norm)) {
      componentTypes.unshift(norm);
    }
  }

  if (
    obj.status === "CLARIFICATION" ||
    (Array.isArray(obj.clarificationOptions) &&
      obj.clarificationOptions.length > 0)
  ) {
    if (!componentTypes.includes("CLARIFICATION")) {
      componentTypes.unshift("CLARIFICATION");
    }
  }

  // Prefer specialized visualization component as primaryComponent over KPI/DATA_TABLE when present
  const specializedOrder: ViewComponentType[] = [
    "HEATMAP",
    "RANKED_BAR_CHART",
    "SEAT_MAP",
    "WEEK_CALENDAR",
    "TASK_LIST",
    "LINE_CHART",
    "BAR_CHART",
    "KPI",
    "DATA_TABLE",
    "TABLE",
    "CLARIFICATION",
  ];
  const primaryComponent: ViewComponentType =
    specializedOrder.find((t) => componentTypes.includes(t)) ??
    componentTypes[0] ??
    "BAR_CHART";

  const datasets: Record<string, Record<string, unknown>[]> = {};
  const datasetList: TypedDatasetDto[] = envelope?.datasets ?? [];
  for (const ds of datasetList) {
    datasets[ds.id] = ds.rows;
  }

  let salesRows: z.infer<typeof salesRowSchema>[] = [];
  if (datasets.branchSales) {
    salesRows = datasets.branchSales.map((r) => ({
      branchId: String(r.branch_id ?? ""),
      branch: String(r.branch_name ?? ""),
      approved: Number(r.approved_krw ?? 0),
      refunds: Number(r.refund_krw ?? 0),
      net: Number(r.net_krw ?? 0),
    }));
  } else if (datasetList.length === 0 && Array.isArray(obj.rows)) {
    const parsedRows = z.array(salesRowSchema).safeParse(obj.rows);
    if (parsedRows.success) {
      salesRows = parsedRows.data;
    }
  } else if (
    datasetList.length === 0 &&
    obj.legacyExecution &&
    typeof obj.legacyExecution === "object" &&
    Array.isArray((obj.legacyExecution as Record<string, unknown>).rows)
  ) {
    const parsedRows = z
      .array(salesRowSchema)
      .safeParse((obj.legacyExecution as Record<string, unknown>).rows);
    if (parsedRows.success) {
      salesRows = parsedRows.data;
    }
  }

  const executionId = String(
    obj.executionId ?? obj.id ?? envelope?.executionId ?? "exec-unknown",
  );
  const requestId = String(obj.requestId ?? envelope?.requestId ?? executionId);
  const matchedPoc = POC_QUESTIONS.find(
    (q) =>
      (obj.pocCode && q.code === String(obj.pocCode)) ||
      (obj.analysisId && q.analysisId === String(obj.analysisId)),
  );
  const title = String(
    (obj.viewSpec &&
    typeof obj.viewSpec === "object" &&
    "title" in (obj.viewSpec as Record<string, unknown>)
      ? (obj.viewSpec as Record<string, unknown>).title
      : undefined) ??
      matchedPoc?.shortLabel ??
      obj.question ??
      "AI 데이터 분석 결과",
  );

  return {
    id: executionId,
    requestId,
    executionId,
    status: String(obj.status ?? envelope?.status ?? "READY"),
    title,
    primaryComponent,
    componentTypes:
      componentTypes.length > 0 ? componentTypes : [primaryComponent],
    datasets,
    datasetList,
    salesRows,
    asOf: String(obj.asOf ?? envelope?.asOf ?? "2026-11-02T14:00:00+09:00"),
    snapshotVersion: String(
      obj.snapshotVersion ??
        envelope?.snapshotVersion ??
        "openstudy-semantic-1.0.0",
    ),
    policyVersion: String(
      obj.policyVersion ?? envelope?.policyVersion ?? "openstudy-policy-v1",
    ),
    warnings: Array.isArray(obj.warnings)
      ? obj.warnings.map(String)
      : (envelope?.warnings ?? []),
    pocCode: obj.pocCode ? String(obj.pocCode) : null,
    analysisId: obj.analysisId ? String(obj.analysisId) : null,
    intentDomain: obj.intentDomain ? String(obj.intentDomain) : null,
    semanticStatus: obj.semanticStatus ? String(obj.semanticStatus) : null,
    resultCategory: obj.resultCategory ? String(obj.resultCategory) : null,
    exportApprovalStatus: obj.exportApprovalStatus
      ? String(obj.exportApprovalStatus)
      : null,
    querySpec:
      obj.querySpec && typeof obj.querySpec === "object"
        ? (obj.querySpec as Record<string, unknown>)
        : null,
    viewSpec,
    envelope,
    summary:
      obj.summary && typeof obj.summary === "object"
        ? (obj.summary as Record<string, unknown>)
        : {},
    stages: Array.isArray(obj.stages) ? (obj.stages as StageSpanDto[]) : [],
    retrievedCandidates: Array.isArray(obj.retrievedCandidates)
      ? (obj.retrievedCandidates as RetrievalCandidateDto[])
      : [],
    securityGate:
      obj.securityGate && typeof obj.securityGate === "object"
        ? (obj.securityGate as Record<string, unknown>)
        : {},
    clarificationOptions: Array.isArray(obj.clarificationOptions)
      ? (obj.clarificationOptions as ClarificationOptionDto[])
      : [],
  };
}

// Engine wire DTO -> OpenStudy display contract. Keep engine-specific changes here.
export async function getExecution(id: string): Promise<Execution> {
  const result = await api<unknown>(`/executions/${id}`);
  const parsed = executionSchema.safeParse(result);
  if (!parsed.success)
    throw new Error("AI 결과의 형식이 지원되는 화면 계약과 일치하지 않습니다.");
  return parsed.data;
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
    shortLabel: "주간 스터디룸 예약",
    targetComponents: ["WEEK_CALENDAR", "DATA_TABLE"],
    requiresSalesRead: false,
  },
  {
    code: "POC-006",
    analysisId: "openstudy.passes.expiringSoon",
    domain: "이용권",
    domainKey: "passes",
    question: "앞으로 7일 이내에 만료되는 이용권을 보여줘",
    shortLabel: "7일 내 만료 이용권",
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
  payload: {
    question: string;
    scope?: string;
    conversationId?: string;
    clarificationChoice?: string;
  },
  signal?: AbortSignal,
): Promise<AiQueryResponseDto> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/ai/queries`, {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": await csrf(),
        "Idempotency-Key": crypto.randomUUID(),
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
  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  if (response.status === 401) {
    clearCsrf();
    window.dispatchEvent(new Event("openstudy:session-expired"));
  }
  if (record?.code === "CSRF_INVALID") clearCsrf();
  if (record && ("resultCategory" in record || "status" in record))
    return record as unknown as AiQueryResponseDto;
  throw new ApiError(response.status, {
    code: typeof record?.code === "string" ? record.code : "HTTP_ERROR",
    message:
      typeof record?.message === "string"
        ? record.message
        : `요청에 실패했습니다. (${response.status})`,
  });
}
