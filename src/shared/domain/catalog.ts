import type { Permission, Resource } from "./schema";
export interface Field {
  key: string;
  label: string;
  type?:
    | "text"
    | "textarea"
    | "number"
    | "date"
    | "datetime-local"
    | "select"
    | "multiselect"
    | "checkbox"
    | "checks";
  options?: string[];
  ref?: Resource;
  required?: boolean;
  min?: number;
  step?: number;
}
export interface Action {
  key: string;
  label: string;
  danger?: boolean;
}
export interface Definition {
  title: string;
  singular: string;
  description: string;
  permission?: Permission;
  admin?: boolean;
  fields: Field[];
  columns: string[];
  actions?: Action[];
  create?: boolean;
  edit?: boolean;
}
const f = (
  key: string,
  label: string,
  type: Field["type"] = "text",
  extra: Partial<Field> = {},
): Field => ({ key, label, type, required: true, ...extra });
const branch = f("branchId", "지점", "select", { ref: "branches" }),
  member = f("memberId", "회원", "select", { ref: "members" }),
  employee = f("employeeId", "직원", "select", { ref: "employees" }),
  assignee = f("assigneeId", "담당자", "select", { ref: "employees" }),
  body = f("body", "내용", "textarea"),
  reason = f("reason", "사유", "textarea");
export const catalog: Partial<Record<Resource, Definition>> = {
  channels: {
    title: "채널 관리",
    singular: "채널",
    description: "지점별 업무 대화와 참여 동료를 관리해요.",
    admin: true,
    create: true,
    edit: true,
    fields: [
      branch,
      f("name", "채널 이름"),
      f("description", "채널 설명", "textarea"),
      f("participantIds", "참여 직원", "multiselect", { ref: "employees" }),
    ],
    columns: ["name", "branchId", "description", "participantIds", "status"],
  },
  branches: {
    title: "지점 설정",
    singular: "지점",
    description: "공간의 운영 정보와 상태를 관리해요.",
    admin: true,
    create: true,
    edit: true,
    fields: [
      f("name", "지점명"),
      f("address", "주소"),
      f("phone", "연락처"),
      f("hours", "운영 시간"),
      f("status", "운영 상태", "select", { options: ["운영 중", "운영 중지"] }),
    ],
    columns: ["name", "address", "hours", "status"],
  },
  employees: {
    title: "직원 관리",
    singular: "직원",
    description: "함께하는 동료의 소속과 지점별 권한을 관리해요.",
    admin: true,
    edit: true,
    fields: [
      f("name", "이름"),
      f("status", "재직 상태", "select", {
        options: ["활성", "이용 제한", "비활성"],
      }),
    ],
    columns: ["name", "email", "memberships", "status"],
  },
  invitations: {
    title: "직원 초대",
    singular: "초대",
    description: "초대 수락 후 최종 승인하면 해당 지점 권한이 활성화돼요.",
    admin: true,
    create: true,
    fields: [
      branch,
      f("name", "이름"),
      f("email", "초대 이메일"),
      f("role", "초기 역할", "select", { options: ["staff", "admin"] }),
    ],
    columns: [
      "name",
      "email",
      "branchId",
      "role",
      "delivery",
      "status",
      "expiresAt",
    ],
    actions: [
      { key: "approve", label: "최종 승인" },
      { key: "reject", label: "거절", danger: true },
      { key: "reissue", label: "재발급" },
      { key: "cancel", label: "초대 취소", danger: true },
    ],
  },
  tasks: {
    title: "업무 관리",
    singular: "업무",
    description: "작은 업무도 놓치지 않도록, 우리 팀의 하루를 함께 채워요.",
    create: true,
    edit: true,
    fields: [
      branch,
      f("title", "업무 제목"),
      body,
      assignee,
      f("due", "기한", "date"),
      f("priority", "우선순위", "select", {
        options: ["보통", "높음", "낮음"],
      }),
      f("category", "분류", "select", {
        options: [
          "운영",
          "시설 점검",
          "인수인계",
          "청소",
          "소모품",
          "회원 관리",
        ],
      }),
      f("status", "상태", "select", { options: ["할 일", "진행 중", "완료"] }),
      f("checks", "체크리스트", "checks", { required: false }),
    ],
    columns: ["title", "branchId", "assigneeId", "due", "priority", "status"],
    actions: [
      { key: "progress", label: "진행하기" },
      { key: "complete", label: "완료하기" },
      { key: "reopen", label: "다시 열기" },
      { key: "share", label: "운영 채널에 공유" },
    ],
  },
  members: {
    title: "회원·이용권",
    singular: "회원",
    description: "회원의 이용 상황과 응대 이력을 한곳에서 확인해요.",
    permission: "members:write",
    create: true,
    edit: true,
    fields: [
      branch,
      f("name", "회원명"),
      f("phone", "연락처"),
      f("email", "이메일", "text", { required: false }),
      f("status", "상태", "select", {
        options: ["정상", "이용 제한", "비활성"],
      }),
      f("note", "응대 메모", "textarea", { required: false }),
    ],
    columns: ["name", "phone", "branchId", "status"],
    actions: [{ key: "history", label: "전 지점 이용 이력" }],
  },
  passes: {
    title: "보유 이용권",
    singular: "이용권",
    description:
      "구매 시 조건과 잔여량을 확인해요. 구매는 결제 관리에서 진행해 주세요.",
    columns: ["memberId", "name", "remaining", "expiresAt", "status"],
    fields: [],
    actions: [{ key: "adjust", label: "잔여량·유효기간 조정" }],
  },
  payments: {
    title: "결제·환불",
    singular: "결제",
    description:
      "실제 금전 이동 없는 내부 Mock 결제입니다. 승인·실패·환불은 원장에 기록돼요.",
    permission: "payments:write",
    create: true,
    fields: [
      branch,
      member,
      f("productId", "구매 상품", "select", { ref: "products" }),
      f("method", "결제 수단", "select", {
        options: ["Mock 카드", "Mock 현금"],
      }),
      f("simulateFailure", "승인 실패 재현", "checkbox", { required: false }),
    ],
    columns: [
      "memberId",
      "branchId",
      "amount",
      "method",
      "status",
      "approvedAt",
    ],
    actions: [{ key: "refund", label: "미사용 전액 환불", danger: true }],
  },
  seats: {
    title: "좌석·현장 이용",
    singular: "좌석",
    description:
      "일반 좌석은 현장에서 배정해요. 이용권 확인 후 입실을 처리해 주세요.",
    permission: "operations:write",
    create: true,
    edit: true,
    fields: [
      branch,
      f("name", "좌석 번호"),
      f("zone", "구역"),
      f("status", "상태", "select", { options: ["이용 가능", "사용 불가"] }),
    ],
    columns: ["name", "zone", "memberId", "status"],
    actions: [
      { key: "assign", label: "현장 배정" },
      { key: "move", label: "좌석 이동" },
      { key: "checkout", label: "퇴실 처리", danger: true },
    ],
  },
  usage: {
    title: "입퇴실 이력",
    singular: "이용",
    description: "실제 이용 지점과 구매 지점, 차감 결과를 구분해 확인해요.",
    fields: [],
    columns: [
      "memberId",
      "branchId",
      "seatId",
      "startedAt",
      "endedAt",
      "minutes",
      "charged",
      "excess",
      "status",
    ],
  },
  lockers: {
    title: "사물함",
    singular: "사물함",
    description: "배정·연장·반납 이력을 관리해요.",
    permission: "operations:write",
    create: true,
    edit: true,
    fields: [
      branch,
      f("name", "사물함 번호"),
      f("status", "상태", "select", { options: ["이용 가능", "사용 불가"] }),
    ],
    columns: ["name", "memberId", "startsOn", "endsOn", "status"],
    actions: [
      { key: "assign", label: "사물함 배정" },
      { key: "extend", label: "기간 연장" },
      { key: "return", label: "반납", danger: true },
    ],
  },
  rooms: {
    title: "스터디룸 설정",
    singular: "스터디룸",
    description: "예약 가능한 공간과 시간당 요금을 설정해요.",
    permission: "operations:write",
    create: true,
    edit: true,
    fields: [
      branch,
      f("name", "룸 이름"),
      f("capacity", "정원", "number", { min: 1 }),
      f("hourlyRate", "시간당 요금 (원)", "number", { min: 1 }),
      f("status", "상태", "select", { options: ["이용 가능", "사용 불가"] }),
    ],
    columns: ["name", "branchId", "capacity", "hourlyRate", "status"],
  },
  reservations: {
    title: "예약 관리",
    singular: "예약",
    description:
      "스터디룸의 일정을 확인하고 예약 등록과 함께 Mock 결제를 진행해요.",
    permission: "operations:write",
    create: true,
    fields: [
      branch,
      member,
      f("roomId", "스터디룸", "select", { ref: "rooms" }),
      f("startsAt", "시작 일시", "datetime-local"),
      f("endsAt", "종료 일시", "datetime-local"),
      f("people", "이용 인원", "number", { min: 1 }),
      f("simulateFailure", "결제 실패 재현", "checkbox", { required: false }),
    ],
    columns: ["memberId", "roomId", "startsAt", "endsAt", "amount", "status"],
    actions: [
      { key: "start", label: "룸 이용 시작" },
      { key: "finish", label: "이용 완료" },
      { key: "cancel", label: "취소·전액 환불", danger: true },
      { key: "reschedule", label: "취소 후 재예약" },
    ],
  },
  facilities: {
    title: "시설·점검",
    singular: "점검",
    description: "쾌적한 공간을 위한 점검과 청소, 소모품을 함께 관리해요.",
    permission: "facilities:write",
    create: true,
    edit: true,
    fields: [
      branch,
      f("title", "점검 제목"),
      f("category", "유형", "select", {
        options: ["정기 점검", "시설 이상", "청소", "소모품"],
      }),
      assignee,
      body,
      f("cycleDays", "점검 주기 (일)", "number", { min: 1 }),
      f("lastChecked", "마지막 점검일", "date"),
      f("condition", "시설 상태", "select", {
        options: ["정상", "점검 필요", "고장", "사용 중지"],
      }),
      f("status", "처리 상태", "select", {
        options: ["할 일", "진행 중", "완료"],
      }),
      f("result", "점검 결과", "textarea", { required: false }),
    ],
    columns: [
      "title",
      "branchId",
      "assigneeId",
      "nextCheck",
      "condition",
      "status",
    ],
    actions: [{ key: "inspect", label: "점검 완료 기록" }],
  },
  inquiries: {
    title: "고객 문의",
    singular: "문의",
    description: "현장에서 받은 고객의 이야기를 기록하고 답변을 이어가요.",
    permission: "operations:write",
    create: true,
    edit: true,
    fields: [
      branch,
      member,
      f("title", "문의 제목"),
      assignee,
      body,
      f("reply", "답변", "textarea", { required: false }),
      f("status", "상태", "select", {
        options: ["접수", "처리 중", "답변 완료"],
      }),
    ],
    columns: ["title", "memberId", "branchId", "assigneeId", "status"],
  },
  notices: {
    title: "공지사항",
    singular: "공지",
    description: "우리 팀에게 필요한 소식을 전달해요.",
    permission: "notices:write",
    create: true,
    edit: true,
    fields: [
      branch,
      f("title", "공지 제목"),
      body,
      f("pinned", "중요 공지 고정", "checkbox", { required: false }),
      f("status", "게시 상태", "select", { options: ["게시 중", "게시 종료"] }),
    ],
    columns: ["title", "branchId", "authorId", "pinned", "status", "createdAt"],
  },
  shifts: {
    title: "주간 근무표",
    singular: "근무",
    description: "예정 근무와 실제 출퇴근은 구분해서 관리해요.",
    admin: true,
    create: true,
    edit: true,
    fields: [
      branch,
      employee,
      f("startsAt", "근무 시작", "datetime-local"),
      f("endsAt", "근무 종료", "datetime-local"),
      f("breakMinutes", "예정 휴게 (분)", "number", { min: 0 }),
      f("status", "상태", "select", { options: ["예정", "변경", "취소"] }),
    ],
    columns: [
      "employeeId",
      "branchId",
      "startsAt",
      "endsAt",
      "breakMinutes",
      "status",
    ],
  },
  attendance: {
    title: "출퇴근·휴게",
    singular: "근태",
    description: "본인의 출근과 퇴근, 휴게 시간을 기록해요.",
    fields: [],
    columns: ["employeeId", "startedAt", "endedAt", "workedMinutes", "status"],
    actions: [
      { key: "break", label: "휴게 시작" },
      { key: "resume", label: "휴게 종료" },
      { key: "clockout", label: "퇴근하기" },
    ],
  },
  corrections: {
    title: "근태 정정",
    singular: "정정 요청",
    description: "승인 전 원본을 유지하고 승인 후에도 변경 이력을 보존해요.",
    create: true,
    fields: [
      branch,
      f("attendanceId", "정정할 근태", "select", { ref: "attendance" }),
      f("startedAt", "정정 출근", "datetime-local"),
      f("endedAt", "정정 퇴근", "datetime-local"),
      f("breakMinutes", "총 휴게 (분)", "number", { min: 0 }),
      reason,
    ],
    columns: ["employeeId", "startedAt", "endedAt", "reason", "status"],
    actions: [
      { key: "approve", label: "승인" },
      { key: "reject", label: "반려" },
      { key: "cancel", label: "신청 취소", danger: true },
    ],
  },
  leaveGrants: {
    title: "휴가 부여",
    singular: "휴가 부여",
    description:
      "관리자가 수동으로 부여한 양과 승인 사용·복원 내역으로 잔여량을 계산해요.",
    admin: true,
    create: true,
    fields: [
      branch,
      employee,
      f("amount", "부여 일수", "number", { min: 0.5, step: 0.5 }),
      f("startsOn", "적용 시작", "date"),
      f("endsOn", "적용 종료", "date"),
      reason,
    ],
    columns: ["employeeId", "amount", "startsOn", "endsOn", "reason"],
  },
  leaveRequests: {
    title: "휴가 신청·승인",
    singular: "휴가 신청",
    description:
      "신청만으로 잔여량을 차감하지 않아요. 승인과 취소 결과를 확인해 주세요.",
    create: true,
    fields: [
      branch,
      f("startsOn", "시작일", "date"),
      f("endsOn", "종료일", "date"),
      f("amount", "신청 일수", "number", { min: 0.5, step: 0.5 }),
      reason,
    ],
    columns: ["employeeId", "startsOn", "endsOn", "amount", "reason", "status"],
    actions: [
      { key: "approve", label: "승인" },
      { key: "reject", label: "반려" },
      { key: "cancel", label: "취소·복원", danger: true },
    ],
  },
  substitutions: {
    title: "대체근무",
    singular: "대체근무 신청",
    description: "승인 후 원래 근무표에 대체 직원과 변경 시간을 반영해요.",
    create: true,
    fields: [
      branch,
      f("shiftId", "원래 근무", "select", { ref: "shifts" }),
      f("substituteId", "대체 직원", "select", { ref: "employees" }),
      f("startsAt", "변경 시작", "datetime-local"),
      f("endsAt", "변경 종료", "datetime-local"),
      reason,
    ],
    columns: ["employeeId", "substituteId", "startsAt", "endsAt", "status"],
    actions: [
      { key: "approve", label: "승인" },
      { key: "reject", label: "반려" },
      { key: "cancel", label: "취소", danger: true },
    ],
  },
  audit: {
    title: "변경 이력",
    singular: "이력",
    description: "주요 변경의 처리자와 변경 전후 값을 확인해요.",
    admin: true,
    fields: [],
    columns: ["actorId", "resource", "action", "targetId", "createdAt"],
  },
};
export const readPermission = (resource: Resource): Permission | undefined =>
  resource === "payments" ? "payments:read" : undefined;
export const labels: Record<string, string> = {
  branchId: "지점",
  memberId: "회원",
  employeeId: "직원",
  assigneeId: "담당자",
  authorId: "작성자",
  seatId: "좌석",
  passId: "이용권",
  roomId: "스터디룸",
  productId: "상품",
  startsAt: "시작",
  endsAt: "종료",
  startedAt: "입실·출근",
  endedAt: "퇴실·퇴근",
  createdAt: "등록일",
  updatedAt: "수정일",
  approvedAt: "승인일",
  expiresAt: "만료일",
  amount: "금액·수량",
  remaining: "잔여량",
  hourlyRate: "시간당 요율",
  name: "이름",
  title: "제목",
  body: "내용",
  status: "상태",
  phone: "연락처",
  email: "이메일",
  priority: "우선순위",
  due: "기한",
  kind: "유형",
  zone: "구역",
  condition: "시설 상태",
  nextCheck: "다음 점검",
  pinned: "중요",
  method: "수단",
  memberships: "소속·권한",
  role: "역할",
  delivery: "이메일",
  reason: "사유",
  reply: "답변",
  startsOn: "시작일",
  endsOn: "종료일",
  minutes: "이용 분",
  charged: "차감량",
  excess: "초과량",
  workedMinutes: "실근무 (분)",
  breakMinutes: "휴게 (분)",
  actorId: "처리자",
  resource: "대상",
  action: "동작",
  targetId: "대상 ID",
  substituteId: "대체 직원",
  address: "주소",
  hours: "운영 시간",
  capacity: "정원",
  description: "설명",
  participantIds: "참여 직원",
};
