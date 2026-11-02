/** Synthetic demonstration contract. No engine, SQL execution or business API. */
export const DEMO_AS_OF = "2026-10-17T02:00:00.000Z";
export const DEMO_CLOCK = "2026.10.17 11:00 · Asia/Seoul";
export type Cell = string | number;
export type Row = Record<string, Cell> & { id: string; branchId: string };
export type View =
  "bar" | "line" | "donut" | "table" | "list" | "calendar" | "timeline";
export type Outcome =
  | "ready"
  | "clarification"
  | "unsupported"
  | "empty"
  | "denied"
  | "scope"
  | "failed"
  | "canceled"
  | "fallback";
export interface SourceRef {
  table: string;
  fields: string[];
}
export interface Domain {
  id: string;
  name: string;
  icon: string;
  description: string;
  sources: SourceRef[];
  relations: string[];
  apiPaths: string[];
  readiness: string;
  policy: string;
}
export interface DemoScenario {
  id: string;
  domainId: string;
  prompt: string;
  title: string;
  outcome: Outcome;
  view: View;
  columns: { key: string; label: string; unit?: string }[];
  rows: Row[];
  period: string;
  start: string | null;
  end: string | null;
  metric: string;
  grain: string;
  summary: string;
  valueKey?: string;
  valueUnit?: string;
  filters: { field: string; op: string; value: Cell | Cell[] }[];
}
const src = (table: string, fields: string): SourceRef => ({
  table,
  fields: fields.split(" "),
});
export const domains: Domain[] = [
  {
    id: "organization",
    name: "지점·직원",
    icon: "01",
    description: "지점, 소속과 초대",
    sources: [
      src("branches", "id name status"),
      src("employees", "id name status"),
      src("branch_memberships", "employee_id branch_id status"),
      src("employee_invitations", "id branch_id status expires_at"),
    ],
    relations: [
      "branch_memberships.branch_id → branches.id",
      "branch_memberships.employee_id → employees.id",
      "employee_invitations.branch_id → branches.id",
    ],
    apiPaths: ["/branches", "/employees", "/invitations"],
    readiness: "원본 조회 API 있음 · 자연어 집계 연결 예정",
    policy: "OWNER 전용 시연 · 도메인별 AI 권한 정책 미확정",
  },
  {
    id: "customers",
    name: "회원",
    icon: "02",
    description: "등록 추이와 회원 상태",
    sources: [
      src(
        "customers",
        "id member_no name status registered_at registered_branch_id",
      ),
    ],
    relations: ["customers.registered_branch_id → branches.id (V2)"],
    apiPaths: ["/customers"],
    readiness: "원본 조회 API 있음 · 자연어 집계 연결 예정",
    policy: "OWNER 전용 시연 · 이름은 가상·마스킹, 연락처 제외",
  },
  {
    id: "products",
    name: "상품·이용권",
    icon: "03",
    description: "판매 상품과 만료 예정",
    sources: [
      src("products", "id name kind sale_status price_krw"),
      src("product_branches", "product_id branch_id"),
      src(
        "passes",
        "id customer_id purchase_branch_id kind status expires_at remaining_minutes remaining_credit_krw",
      ),
    ],
    relations: [
      "product_branches.product_id → products.id",
      "passes.customer_id → customers.id",
    ],
    apiPaths: ["/products", "/passes"],
    readiness: "원본 조회 API 있음 · 자연어 집계 연결 예정",
    policy: "OWNER 전용 시연 · 기간권 시작 전은 만료 예정에서 제외",
  },
  {
    id: "sales",
    name: "결제·환불·매출",
    icon: "04",
    description: "지점별 수치와 거래 근거",
    sources: [
      src("payments", "id branch_id amount_krw purpose status approved_at"),
      src(
        "refunds",
        "id payment_id processing_branch_id amount_krw refunded_at",
      ),
    ],
    relations: [
      "refunds.payment_id → payments.id",
      "payments.branch_id → branches.id",
    ],
    apiPaths: ["/payments"],
    readiness: "결제 원본 API 있음 · M9 집계·M10 엔진 연결 예정",
    policy:
      "ai:read + 대상 모든 지점의 sales:read · 거래 상세에는 payments:read 추가",
  },
  {
    id: "seats",
    name: "좌석·입퇴실",
    icon: "05",
    description: "현재 이용과 완료 세션",
    sources: [
      src("seats", "id branch_id seat_no zone status"),
      src(
        "seat_sessions",
        "id branch_id seat_id status effective_checked_in_at effective_checked_out_at billed_minutes billed_krw",
      ),
    ],
    relations: ["seat_sessions.seat_id + branch_id → seats.id + branch_id"],
    apiPaths: ["/seats/occupancy", "/seat-sessions"],
    readiness: "원본·좌석 현황 API 있음 · 자연어 연결 예정",
    policy: "OWNER 전용 시연 · 완료 이용은 유효 퇴실 시각 기준",
  },
  {
    id: "rooms",
    name: "스터디룸·예약",
    icon: "06",
    description: "오늘의 일정과 주간 예약",
    sources: [
      src("rooms", "id branch_id name capacity"),
      src("room_reservations", "id room_id branch_id start_at end_at status"),
    ],
    relations: ["room_reservations.room_id + branch_id → rooms.id + branch_id"],
    apiPaths: ["/rooms", "/room-reservations"],
    readiness: "DB 정의 있음 · 정본 조회 API 준비 여부 별도 확인",
    policy: "OWNER 전용 시연 · 취소·결제 실패 제외, 예약 시작일 기준",
  },
  {
    id: "lockers",
    name: "사물함",
    icon: "07",
    description: "배정 현황과 기간 종료",
    sources: [
      src("lockers", "id branch_id locker_no status"),
      src(
        "locker_assignments",
        "id locker_id start_date end_date status returned_at",
      ),
    ],
    relations: ["locker_assignments.locker_id → lockers.id"],
    apiPaths: ["/lockers"],
    readiness: "DB 정의 있음 · 정본 조회 API 준비 여부 별도 확인",
    policy: "OWNER 전용 시연 · 배정 종료일 기준, 회원 연락처 제외",
  },
  {
    id: "facilities",
    name: "시설·점검",
    icon: "08",
    description: "점검 지연과 진행 작업",
    sources: [
      src(
        "facilities",
        "id branch_id name status inspection_interval_days last_inspected_on",
      ),
      src(
        "facility_works",
        "id facility_id kind status opened_at completed_at",
      ),
    ],
    relations: ["facility_works.facility_id → facilities.id"],
    apiPaths: ["/facilities", "/facilities/summary"],
    readiness: "원본·시설 요약 API 있음 · 자연어 연결 예정",
    policy: "OWNER 전용 시연 · 다음 점검일은 최근 점검일 + 점검 주기",
  },
  {
    id: "tasks",
    name: "업무·채팅",
    icon: "09",
    description: "기한과 채널 업무 공유",
    sources: [
      src("work_tasks", "id branch_id title status due_at completed_at"),
      src("messages", "id conversation_id related_task_id kind sent_at"),
      src("conversations", "id branch_id kind name"),
      src("conversation_members", "conversation_id employee_id"),
    ],
    relations: [
      "messages.related_task_id → work_tasks.id",
      "messages.conversation_id → conversations.id",
      "conversation_members.conversation_id → conversations.id",
    ],
    apiPaths: ["/tasks", "/channels/{id}/messages"],
    readiness: "업무 API 있음 · 채팅은 계약 정의, 실제 연결 후속",
    policy: "OWNER 전용 시연 · 현재 참여 채널만, DM 본문 조회 제외",
  },
  {
    id: "support",
    name: "문의·공지",
    icon: "10",
    description: "미답변 문의와 게시 공지",
    sources: [
      src("inquiries", "id branch_id subject status created_at answered_at"),
      src("announcements", "id title target status is_pinned published_at"),
      src("announcement_branches", "announcement_id branch_id"),
    ],
    relations: ["announcement_branches.announcement_id → announcements.id"],
    apiPaths: ["/inquiries", "/notices"],
    readiness: "계약 정의 확인 · 실제 구현 준비 상태 별도 확인",
    policy: "OWNER 전용 시연 · 문의 본문·답변 원문 제외",
  },
  {
    id: "attendance",
    name: "근무·근태",
    icon: "11",
    description: "근무표와 정정 신청",
    sources: [
      src("shifts", "id employee_id branch_id starts_at ends_at status"),
      src(
        "attendance_records",
        "id employee_id branch_id clock_in_at clock_out_at",
      ),
      src(
        "attendance_corrections",
        "id attendance_id correction_kind status created_at",
      ),
    ],
    relations: [
      "attendance_corrections.attendance_id → attendance_records.id",
      "shifts.employee_id + branch_id → branch_memberships.employee_id + branch_id",
    ],
    apiPaths: ["/shifts", "/attendance-corrections"],
    readiness: "DB 정의 있음 · 정본 조회 API 준비 여부 별도 확인",
    policy: "OWNER 전용 시연 · 정정 사유 원문 제외",
  },
  {
    id: "leave",
    name: "휴가·대체근무",
    icon: "12",
    description: "승인 휴가와 교대 신청",
    sources: [
      src(
        "leave_requests",
        "id employee_id starts_on ends_on requested_days status",
      ),
      src(
        "shift_swaps",
        "id original_shift_id requested_by replacement_employee_id status",
      ),
      src("shifts", "id branch_id employee_id"),
    ],
    relations: [
      "leave_requests.employee_id → employees.id",
      "shift_swaps.original_shift_id → shifts.id",
    ],
    apiPaths: ["/leave-requests", "/shift-swaps"],
    readiness: "DB 정의 있음 · 정본 조회 API 준비 여부 별도 확인",
    policy:
      "OWNER 전용 시연 · 휴가는 전사 직원 기준, 지점 귀속은 정책 협의 필요",
  },
  {
    id: "audit",
    name: "감사 이력",
    icon: "13",
    description: "업무와 결제의 처리 기록",
    sources: [
      src(
        "audit_events",
        "id actor_employee_id branch_id entity_type entity_id action occurred_at result",
      ),
    ],
    relations: [
      "audit_events.branch_id → branches.id",
      "audit_events.actor_employee_id → employees.id",
    ],
    apiPaths: ["/audit-events"],
    readiness: "DB 정의 있음 · 정본 조회 API 준비 여부 별도 확인",
    policy: "OWNER 전용 시연 · before_json·after_json·reason 원문 제외",
  },
];
const cols = (...items: string[]) =>
  items.map((item) => {
    const [key, label, unit] = item.split(":");
    return { key, label, ...(unit ? { unit } : {}) };
  });
const rows = (items: Cell[][], keys: string[]): Row[] =>
  items.map((values, i) => ({
    id: `row-${i + 1}`,
    branchId: i % 2 ? "seongsu" : "gangnam",
    branch: i % 2 ? "성수점" : "강남점",
    ...Object.fromEntries(keys.map((key, j) => [key, values[j]])),
  }));
const counts = (items: Cell[][]) => rows(items, ["label", "value"]);
const month = {
  period: "이번 달 · 10.01–10.17",
  start: "2026-10-01T00:00:00+09:00",
  end: "2026-10-18T00:00:00+09:00",
};
const today = {
  period: "오늘 · 10.17",
  start: "2026-10-17T00:00:00+09:00",
  end: "2026-10-18T00:00:00+09:00",
};
const week = {
  period: "이번 주 · 10.12–10.18",
  start: "2026-10-12T00:00:00+09:00",
  end: "2026-10-19T00:00:00+09:00",
};
const next7 = {
  period: "앞으로 7일 · 10.17–10.23",
  start: DEMO_AS_OF,
  end: "2026-10-24T00:00:00+09:00",
};
function scenario(
  id: string,
  domainId: string,
  prompt: string,
  view: View,
  columns: DemoScenario["columns"],
  data: Row[],
  metric: string,
  options: Partial<DemoScenario> = {},
): DemoScenario {
  return {
    id,
    domainId,
    prompt,
    title: prompt.replace(/을 보여줘|를 보여줘| 보여줘| 알려줘/g, ""),
    outcome: "ready",
    view,
    columns:
      columns.some((c) => c.key === "branch" || c.label === "지점") ||
      data.some((r) => ["global", "channel"].includes(r.branchId))
        ? columns
        : [...columns, { key: "branch", label: "지점" }],
    rows: data,
    period: "기준 시각 현재",
    start: null,
    end: null,
    metric,
    grain: "상세 레코드",
    summary: "고정된 가상 데이터에서 조회 조건에 맞는 결과를 준비했습니다.",
    filters: [],
    ...options,
  };
}
export const scenarios: DemoScenario[] = [
  scenario(
    "org-active",
    "organization",
    "지점별 활성 직원 수를 보여줘",
    "bar",
    cols("label:지점", "value:활성 직원:명"),
    counts([
      ["강남점", 8],
      ["성수점", 6],
    ]),
    "활성 소속과 활성 직원의 지점별 DISTINCT 직원 수. OWNER는 소속 레코드가 있을 때만 포함.",
    {
      valueKey: "value",
      valueUnit: "명",
      grain: "지점",
      filters: [
        { field: "employees.status", op: "EQ", value: "ACTIVE" },
        { field: "branch_memberships.status", op: "EQ", value: "ACTIVE" },
      ],
    },
  ),
  scenario(
    "org-pending",
    "organization",
    "승인 대기 소속과 초대 현황을 보여줘",
    "list",
    cols("label:항목", "branch:지점", "status:상태", "date:만료·신청일"),
    rows(
      [
        ["소속 신청 001", "강남점", "승인 대기", "2026-10-17"],
        ["초대 002", "성수점", "수락 대기", "2026-10-20"],
        ["초대 003", "강남점", "승인 대기", "2026-10-21"],
      ],
      ["label", "branch", "status", "date"],
    ),
    "소속 PENDING 및 초대 PENDING/ACCEPTED, 만료되지 않은 초대를 별도 종류로 UNION. 중복 직원 합산 안 함.",
  ),
  scenario(
    "customers-new",
    "customers",
    "이번 달 신규 회원 추이를 보여줘",
    "line",
    cols("label:등록일", "value:신규 회원:명"),
    counts([
      ["10.01", 12],
      ["10.01", 8],
      ["10.05", 17],
      ["10.05", 11],
      ["10.09", 14],
      ["10.09", 10],
      ["10.13", 22],
      ["10.13", 16],
      ["10.17", 18],
      ["10.17", 12],
    ]),
    "등록일의 KST 날짜별 신규 회원 수. 등록 지점 없는 기존 회원의 지점 집계 귀속은 별도 협의.",
    { ...month, valueKey: "value", valueUnit: "명", grain: "등록일·등록 지점" },
  ),
  scenario(
    "customers-restricted",
    "customers",
    "이용 제한 회원 목록을 보여줘",
    "table",
    cols("label:회원", "number:회원번호", "status:상태", "date:등록일"),
    rows(
      Array.from({ length: 12 }, (_, i) => [
        `가상회원 ${i + 1}**`,
        `M-DEMO-${String(i + 1).padStart(3, "0")}`,
        "이용 제한",
        `2026-10-${String(i + 1).padStart(2, "0")}`,
      ]),
      ["label", "number", "status", "date"],
    ),
    "customers.status = RESTRICTED. 연락처·메모·상태 변경 사유 제외.",
    { filters: [{ field: "customers.status", op: "EQ", value: "RESTRICTED" }] },
  ),
  scenario(
    "products-active",
    "products",
    "판매 중 상품의 유형별 현황을 보여줘",
    "donut",
    cols("label:상품 유형", "value:판매 상품:개"),
    counts([
      ["시간권", 5],
      ["시간권", 3],
      ["기간권", 4],
      ["기간권", 3],
      ["정액권", 2],
      ["정액권", 1],
    ]),
    "판매 중 상품을 판매 지점별 DISTINCT products.id로 집계. 전체 지점 선택 시 같은 상품의 지점 중복 제거가 필요하며, 이 fixture의 상품은 서로 다름.",
    {
      valueKey: "value",
      valueUnit: "개",
      grain: "상품 유형·판매 지점",
      filters: [{ field: "products.sale_status", op: "EQ", value: "ON_SALE" }],
    },
  ),
  scenario(
    "passes-expiring",
    "products",
    "7일 안에 만료되는 이용권을 보여줘",
    "table",
    cols("label:이용권", "customer:회원", "date:만료일", "remaining:잔량"),
    rows(
      [
        ["50시간권", "가상회원 01**", "2026-10-19", "120분"],
        ["4주 기간권", "가상회원 02**", "2026-10-20", "기간형"],
        ["10만원 정액권", "가상회원 03**", "2026-10-22", "18,000원"],
      ],
      ["label", "customer", "date", "remaining"],
    ),
    "활성 이용권 중 expires_at이 기준 시각 이후이고 종료 경계 미만. 시작 전·만료 없음 제외.",
    {
      ...next7,
      filters: [{ field: "passes.status", op: "EQ", value: "ACTIVE" }],
    },
  ),
  scenario(
    "sales-net",
    "sales",
    "지난달 지점별 순매출을 보여줘",
    "bar",
    cols(
      "label:지점",
      "approved:승인액:원",
      "refunds:환불액:원",
      "net:순매출:원",
    ),
    rows(
      [
        ["강남점", 18400000, 1200000, 17200000],
        ["성수점", 12600000, 600000, 12000000],
      ],
      ["label", "approved", "refunds", "net"],
    ),
    "승인액 − 환불액. 이용권·룸·사물함 모두 포함. 환불 처리일 기준, 원결제 지점 귀속. 환불 이후 상태가 REFUNDED인 승인 원거래도 승인액에 포함.",
    {
      period: "지난달 · 09.01–09.30",
      start: "2026-09-01T00:00:00+09:00",
      end: "2026-10-01T00:00:00+09:00",
      valueKey: "net",
      valueUnit: "원",
      grain: "원결제 지점",
      summary:
        "두 지점의 순매출을 비교했습니다. 차트와 표는 같은 원 단위 데이터에서 계산합니다.",
    },
  ),
  scenario(
    "sales-refunds",
    "sales",
    "이번 달 환불 내역을 보여줘",
    "table",
    cols(
      "label:환불",
      "payment:원결제",
      "value:환불액:원",
      "date:처리일",
      "branch:원결제 지점",
    ),
    rows(
      [
        ["RF-001", "PAY-120", 120000, "2026-10-03", "강남점"],
        ["RF-002", "PAY-134", 80000, "2026-10-12", "성수점"],
        ["RF-003", "PAY-152", 50000, "2026-10-16", "강남점"],
      ],
      ["label", "payment", "value", "date", "branch"],
    ),
    "refunded_at이 기간에 속하는 환불 원장. 처리 지점이 달라도 payments.branch_id로 귀속.",
    { ...month, valueKey: "value", valueUnit: "원" },
  ),
  scenario(
    "seats-now",
    "seats",
    "현재 지점별 좌석 이용 현황을 보여줘",
    "bar",
    cols(
      "label:지점",
      "occupied:이용 중:석",
      "available:이용 가능:석",
      "blocked:사용 불가:석",
      "total:전체:석",
    ),
    rows(
      [
        ["강남점", 32, 14, 2, 48],
        ["성수점", 21, 10, 1, 32],
      ],
      ["label", "occupied", "available", "blocked", "total"],
    ),
    "활성 좌석 세션 기준 점유 좌석 수. 이용 가능 + 이용 중 + 사용 불가 = 전체 좌석. 점유율 분모 정책은 정본 API와 대조.",
    { valueKey: "occupied", valueUnit: "석", grain: "지점" },
  ),
  scenario(
    "seats-completed",
    "seats",
    "오늘 완료된 좌석 이용 내역을 보여줘",
    "table",
    cols(
      "label:이용 기록",
      "seat:좌석",
      "start:입실",
      "end:퇴실",
      "minutes:이용 시간:분",
    ),
    rows(
      [
        ["SS-001", "A-01", "2026-10-17 07:00", "2026-10-17 09:20", 140],
        ["SS-002", "B-03", "2026-10-17 08:00", "2026-10-17 10:00", 120],
        ["SS-003", "A-12", "2026-10-17 08:30", "2026-10-17 10:10", 100],
      ],
      ["label", "seat", "start", "end", "minutes"],
    ),
    "유효 퇴실 시각이 오늘인 완료 세션. 보정된 시각을 사용하고 청구분은 billed_minutes를 별도로 표시.",
    { ...today },
  ),
  scenario(
    "rooms-today",
    "rooms",
    "오늘의 스터디룸 예약을 보여줘",
    "calendar",
    cols("label:예약", "date:날짜", "time:시간", "status:상태"),
    rows(
      [
        ["스터디룸 A · 4인", "2026-10-17", "10:00–12:00", "예약 확정"],
        ["스터디룸 B · 6인", "2026-10-17", "13:00–15:00", "예약 확정"],
        ["스터디룸 A · 4인", "2026-10-17", "16:00–18:00", "예약 확정"],
      ],
      ["label", "date", "time", "status"],
    ),
    "오늘과 시간 구간이 겹치는 예약. 취소·결제 실패 제외, 구간 겹침은 start < dayEnd AND end > dayStart.",
    { ...today },
  ),
  scenario(
    "rooms-week",
    "rooms",
    "이번 주 룸별 예약 건수를 보여줘",
    "bar",
    cols("label:스터디룸", "value:예약:건"),
    counts([
      ["강남 A", 16],
      ["성수 A", 12],
      ["강남 B", 10],
      ["성수 B", 8],
    ]),
    "예약 시작일이 이번 주인 예약의 COUNT. 취소·결제 실패 제외. 주 시작 월요일.",
    { ...week, valueKey: "value", valueUnit: "건", grain: "룸" },
  ),
  scenario(
    "lockers-status",
    "lockers",
    "사물함 배정 현황을 보여줘",
    "donut",
    cols("label:배정 상태", "value:사물함:개"),
    counts([
      ["사용 중", 28],
      ["사용 중", 18],
      ["이용 가능", 10],
      ["이용 가능", 8],
      ["사용 불가", 2],
      ["사용 불가", 2],
    ]),
    "활성 배정의 사물함 수와 사용 불가 상태를 구분. 사물함당 중복 배정 없이 집계.",
    { valueKey: "value", valueUnit: "개", grain: "배정 상태·지점" },
  ),
  scenario(
    "lockers-ending",
    "lockers",
    "7일 안에 배정 기간이 끝나는 사물함을 보여줘",
    "list",
    cols("label:사물함", "date:종료일", "status:상태"),
    rows(
      [
        ["강남 L-03", "2026-10-19", "사용 중"],
        ["성수 L-12", "2026-10-21", "사용 중"],
        ["강남 L-08", "2026-10-23", "사용 중"],
      ],
      ["label", "date", "status"],
    ),
    "미반납 배정의 end_date가 10월 17일 이상·24일 미만. DATE 종료일의 포함 규칙은 업무 계약 확인.",
    { ...next7 },
  ),
  scenario(
    "facilities-overdue",
    "facilities",
    "점검 예정일이 지난 시설을 보여줘",
    "list",
    cols("label:시설", "date:점검 예정일", "status:상태", "owner:담당"),
    rows(
      [
        ["강남 공기청정기", "2026-10-14", "점검 지연", "가상직원 A"],
        ["성수 출입 장치", "2026-10-15", "점검 지연", "가상직원 B"],
        ["강남 정수기", "2026-10-16", "점검 지연", "가상직원 C"],
      ],
      ["label", "date", "status", "owner"],
    ),
    "last_inspected_on + inspection_interval_days < KST 오늘. 최초 점검일 없음은 별도 미점검 상태로 다룸.",
  ),
  scenario(
    "facilities-open",
    "facilities",
    "진행 중인 시설 작업을 보여줘",
    "table",
    cols("label:작업", "kind:구분", "status:상태", "date:접수일"),
    rows(
      [
        ["출입 장치 부품 점검", "수리", "진행 중", "2026-10-15"],
        ["냉난방 필터 점검", "점검", "진행 중", "2026-10-16"],
      ],
      ["label", "kind", "status", "date"],
    ),
    "facility_works.status = IN_PROGRESS, facility_id로 지점 귀속.",
    {
      filters: [
        { field: "facility_works.status", op: "EQ", value: "IN_PROGRESS" },
      ],
    },
  ),
  scenario(
    "tasks-overdue",
    "tasks",
    "기한이 지난 미완료 업무를 보여줘",
    "list",
    cols("label:업무", "date:기한", "status:상태", "priority:우선순위"),
    rows(
      [
        ["좌석 안내 표지 교체", "2026-10-15", "진행 중", "높음"],
        ["주간 물품 재고 확인", "2026-10-16", "할 일", "보통"],
        ["주말 운영 안내 게시", "2026-10-17 10:00", "할 일", "긴급"],
      ],
      ["label", "date", "status", "priority"],
    ),
    "due_at < asOf AND status != DONE. 단순 날짜 비교가 아닌 시각 기준.",
  ),
  scenario(
    "chat-task-shares",
    "tasks",
    "현재 채널의 업무 공유 메시지를 보여줘",
    "timeline",
    cols("label:업무 카드", "date:공유 시각", "status:연결 상태"),
    rows(
      [
        ["주말 운영 안내", "2026-10-17 09:20", "업무 카드"],
        ["물품 점검 업무", "2026-10-17 10:05", "업무 카드"],
      ],
      ["label", "date", "status"],
    ).map((r) => ({ ...r, branchId: "channel" })),
    "현재 conversation_id의 TASK_CARD만 조회. 참여 여부·업무 원본 접근을 각각 확인.",
    { grain: "현재 채널 메시지" },
  ),
  scenario(
    "support-unanswered",
    "support",
    "아직 답변하지 않은 문의를 보여줘",
    "list",
    cols("label:문의 제목", "date:접수일", "status:상태"),
    rows(
      [
        ["룸 예약 시간 문의", "2026-10-16", "접수"],
        ["사물함 배정 문의", "2026-10-17", "처리 중"],
        ["상품 이용 기간 문의", "2026-10-17", "접수"],
      ],
      ["label", "date", "status"],
    ),
    "answered_at IS NULL인 미종결 문의. 문의·답변 본문과 연락처는 결과에 포함하지 않음.",
  ),
  scenario(
    "notices-live",
    "support",
    "현재 게시 중인 지점 공지를 보여줘",
    "list",
    cols("label:공지 제목", "date:게시일", "status:게시 상태"),
    rows(
      [
        ["주말 시설 점검 안내", "2026-10-15", "게시 중"],
        ["스터디룸 이용 안내", "2026-10-16", "게시 중"],
      ],
      ["label", "date", "status"],
    ),
    "게시 상태와 게시 시각을 확인하고 announcement_branches 또는 전체 공지 대상으로 조회.",
  ),
  scenario(
    "shifts-week",
    "attendance",
    "이번 주 직원 근무표를 보여줘",
    "calendar",
    cols("label:직원", "date:날짜", "time:근무 시간", "status:상태"),
    rows(
      [
        ["가상직원 A", "2026-10-12", "09:00–18:00", "예정"],
        ["가상직원 B", "2026-10-14", "13:00–21:00", "예정"],
        ["가상직원 C", "2026-10-17", "09:00–18:00", "예정"],
        ["가상직원 D", "2026-10-18", "10:00–19:00", "예정"],
      ],
      ["label", "date", "time", "status"],
    ),
    "이번 주와 구간이 겹치는 취소되지 않은 근무. 직원 소속 지점이 아닌 shifts.branch_id 사용.",
    { ...week },
  ),
  scenario(
    "attendance-pending",
    "attendance",
    "처리 대기 근태 정정 신청을 보여줘",
    "table",
    cols(
      "label:정정 신청",
      "employee:직원",
      "kind:정정 구분",
      "date:신청일",
      "status:상태",
    ),
    rows(
      [
        ["AC-001", "가상직원 A", "출퇴근 시각", "2026-10-16", "신청"],
        ["AC-002", "가상직원 B", "휴게 시각", "2026-10-17", "신청"],
      ],
      ["label", "employee", "kind", "date", "status"],
    ),
    "REQUESTED 신청만 조회하고 attendance_records.branch_id로 범위를 제한. 개인 사유 원문 제외.",
    {
      filters: [
        {
          field: "attendance_corrections.status",
          op: "EQ",
          value: "REQUESTED",
        },
      ],
    },
  ),
  scenario(
    "leave-approved",
    "leave",
    "이번 달 승인된 휴가를 보여줘",
    "calendar",
    cols(
      "label:직원",
      "date:시작일",
      "end:종료일",
      "value:일수:일",
      "status:상태",
    ),
    rows(
      [
        ["가상직원 A", "2026-10-19", "2026-10-20", 2, "승인"],
        ["가상직원 B", "2026-10-22", "2026-10-22", 1, "승인"],
        ["가상직원 C", "2026-10-26", "2026-10-26", 0.5, "승인"],
      ],
      ["label", "date", "end", "value", "status"],
    ).map((r) => ({ ...r, branchId: "global" })),
    "APPROVED이며 월간 구간과 겹치는 휴가. 전사 직원 기준, 합계는 신청 일수이며 월 경계 일할 계산 아님.",
    {
      period: "이번 달 휴가 · 10.01–10.31",
      start: "2026-10-01T00:00:00+09:00",
      end: "2026-11-01T00:00:00+09:00",
      valueKey: "value",
      valueUnit: "일",
      filters: [
        { field: "leave_requests.status", op: "EQ", value: "APPROVED" },
      ],
    },
  ),
  scenario(
    "swaps-pending",
    "leave",
    "처리 대기 대체근무 신청을 보여줘",
    "table",
    cols(
      "label:대체 신청",
      "requester:신청 직원",
      "replacement:대체 직원",
      "status:상태",
    ),
    rows(
      [
        ["SW-001", "가상직원 A", "가상직원 C", "신청"],
        ["SW-002", "가상직원 B", "가상직원 D", "신청"],
      ],
      ["label", "requester", "replacement", "status"],
    ),
    "REQUESTED인 대체 신청. 원근무 shifts.branch_id로 지점 범위 적용.",
    {
      filters: [{ field: "shift_swaps.status", op: "EQ", value: "REQUESTED" }],
    },
  ),
  scenario(
    "audit-today",
    "audit",
    "오늘의 업무 변경 이력을 보여줘",
    "timeline",
    cols("label:대상", "action:행위", "date:발생 시각", "status:결과"),
    rows(
      [
        ["TASK-DEMO-01", "상태 변경", "2026-10-17 09:12", "성공"],
        ["TASK-DEMO-02", "체크리스트 변경", "2026-10-17 10:02", "성공"],
        ["TASK-DEMO-03", "담당자 변경", "2026-10-17 10:40", "성공"],
      ],
      ["label", "action", "date", "status"],
    ),
    "entity_type이 업무인 오늘의 감사 메타정보. before_json·after_json은 반환하지 않음.",
    { ...today },
  ),
  scenario(
    "audit-payments",
    "audit",
    "결제·환불 관련 처리 이력을 보여줘",
    "timeline",
    cols("label:대상", "action:행위", "date:발생 시각", "status:결과"),
    rows(
      [
        ["PAY-DEMO-01", "결제 승인", "2026-10-16 13:10", "성공"],
        ["RF-DEMO-01", "환불 처리", "2026-10-17 09:30", "성공"],
        ["PAY-DEMO-02", "결제 실패", "2026-10-17 10:20", "실패"],
      ],
      ["label", "action", "date", "status"],
    ),
    "결제·환불의 감사 메타정보만 조회. 현재 업무 원장의 성공 상태와 감사 실행 결과를 구분.",
    { ...month },
  ),
];
const special: [string, string, Outcome, string][] = [
  [
    "state-clarification",
    "매출 현황을 비교해줘",
    "clarification",
    "어떤 기간을 비교할까요? 준비된 조건을 선택해 주세요.",
  ],
  [
    "state-unsupported",
    "내년 현금흐름을 예측해줘",
    "unsupported",
    "이 데모는 준비된 조회 예문만 지원합니다. 예문에서 질문을 골라 주세요.",
  ],
  [
    "state-empty",
    "이번 달 100만 원 이상 환불 내역을 보여줘",
    "empty",
    "적용한 조건에 맞는 결과가 없습니다. 합계 0과 조회 실패를 구분합니다.",
  ],
  [
    "state-denied",
    "권한 없는 매출 조회를 시연해줘",
    "denied",
    "조회 권한이 없습니다. 실제 서버 권한 검사가 아닌 차단 화면 시뮬레이션입니다.",
  ],
  [
    "state-scope",
    "접근 범위 밖 지점을 조회해줘",
    "scope",
    "현재 조회 범위를 벗어난 요청입니다. 다른 지점의 이름과 수치는 반환하지 않습니다.",
  ],
  [
    "state-failed",
    "조회 실패를 시연해줘",
    "failed",
    "조회 중 연결 오류가 발생했습니다. 결과를 성공이나 빈 목록으로 바꾸지 않았습니다.",
  ],
  [
    "state-canceled",
    "조회 취소를 시연해줘",
    "canceled",
    "요청을 취소했습니다. 뒤늦은 응답은 결과를 변경하지 않습니다.",
  ],
  [
    "state-fallback",
    "지원하지 않는 차트의 표 대체를 시연해줘",
    "fallback",
    "등록되지 않은 UI 대신 검증된 동일 데이터를 표로 표시했습니다.",
  ],
];
for (const [id, prompt, outcome, summary] of special)
  scenarios.push({
    ...structuredClone(
      scenarios.find(
        (s) => s.id === (outcome === "empty" ? "sales-refunds" : "sales-net"),
      )!,
    ),
    id,
    prompt,
    title: prompt,
    outcome,
    summary,
    ...(outcome === "empty"
      ? {
          rows: [],
          filters: [{ field: "refunds.amount_krw", op: "GTE", value: 1000000 }],
        }
      : {}),
  });
export const domainFor = (s: DemoScenario) =>
  domains.find((d) => d.id === s.domainId)!;
export const normalizePrompt = (text: string) =>
  text
    .trim()
    .replace(/^@DomainLenz\s*/i, "")
    .trim()
    .replace(/[.!?。！？]+$/, "");
export function matchScenario(text: string): DemoScenario | undefined {
  const q = normalizePrompt(text);
  return scenarios.find((s) => normalizePrompt(s.prompt) === q);
}
export function scopedRows(s: DemoScenario, scope: string): Row[] {
  return structuredClone(
    s.rows.filter(
      (r) =>
        scope === "all" || r.branchId === scope || r.branchId === "channel",
    ),
  );
}
export function querySpecFor(
  s: DemoScenario,
  scope: string,
  channelId = "general",
) {
  const baseId = s.id.startsWith("state-")
    ? s.outcome === "empty"
      ? "sales-refunds"
      : "sales-net"
    : s.id;
  const timeFields: Record<string, string[]> = {
    "customers-new": ["customers.registered_at"],
    "passes-expiring": ["passes.expires_at"],
    "sales-net": ["payments.approved_at", "refunds.refunded_at"],
    "sales-refunds": ["refunds.refunded_at"],
    "seats-completed": ["seat_sessions.effective_checked_out_at"],
    "rooms-today": ["room_reservations.start_at", "room_reservations.end_at"],
    "rooms-week": ["room_reservations.start_at"],
    "lockers-ending": ["locker_assignments.end_date"],
    "shifts-week": ["shifts.starts_at", "shifts.ends_at"],
    "leave-approved": ["leave_requests.starts_on", "leave_requests.ends_on"],
    "audit-today": ["audit_events.occurred_at"],
    "audit-payments": ["audit_events.occurred_at"],
  };
  const fields = timeFields[baseId] ?? [];
  const overlap = ["rooms-today", "shifts-week", "leave-approved"].includes(
    baseId,
  );
  const dateOnly = ["lockers-ending", "leave-approved"].includes(baseId);
  const bound = (value: string | null) =>
    dateOnly ? value?.slice(0, 10) : value;
  const timeConstraints = !s.start
    ? []
    : overlap
      ? [
          { field: fields[0], op: "LT", value: bound(s.end) },
          {
            field: fields[1],
            op: baseId === "leave-approved" ? "GTE" : "GT",
            value: bound(s.start),
          },
        ]
      : fields.flatMap((field) => [
          { field, op: "GTE", value: bound(s.start) },
          { field, op: "LT", value: bound(s.end) },
        ]);
  return {
    schemaVersion: "demo-v1-proposal",
    status:
      s.outcome === "clarification"
        ? "NEEDS_CLARIFICATION"
        : s.outcome === "unsupported"
          ? "UNSUPPORTED"
          : ["denied", "scope", "failed", "canceled"].includes(s.outcome)
            ? "NOT_EXECUTED"
            : "READY",
    sourceRefs: domainFor(s).sources,
    grain: s.grain,
    metrics: [{ id: `openstudy.demo.${s.id}`, definition: s.metric }],
    filters: [
      ...s.filters,
      ...(s.id === "chat-task-shares"
        ? [{ field: "messages.conversation_id", op: "EQ", value: channelId }]
        : []),
    ],
    timeConstraints,
    timeConstraintPolicy:
      baseId === "sales-net"
        ? "승인·환불 각각의 원장에서 독립 집계 후 지점별 결합"
        : "AND",
    effectiveScope: {
      branch: scope,
      channelId,
      origin: "demo-context; production scope must be server-owned",
    },
    pagination: { page: 0, size: 5 },
    asOf: DEMO_AS_OF,
    timeZone: "Asia/Seoul",
    currency: "KRW",
    refundBasis: "processed",
    note: "연동 협의용 초안. 물리 필드와 지표 정의를 설명하며 엔진 확정 계약이 아닙니다. 매출은 승인·환불을 별도 집계하여 일대다 조인의 중복 합계를 방지합니다.",
  };
}
export function viewSpecFor(s: DemoScenario) {
  return {
    schemaVersion: "demo-v1-proposal",
    layout: "stack",
    datasetId: s.id,
    components: [
      { type: "KpiGroup" },
      {
        type: s.outcome === "fallback" ? "UnregisteredChart" : s.view,
        bindings: { label: s.columns[0].key, value: s.valueKey },
      },
      { type: "PaginatedDataTable", columns: s.columns, pageSize: 5 },
    ],
    actions: ["sort", "page", "drillDetail", "refineFilter"],
    note: "허용 컴포넌트만 렌더링. 엔진 확정 스키마 아님.",
  };
}
