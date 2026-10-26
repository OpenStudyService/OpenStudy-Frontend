import { z } from "zod";

export const permissions = [
  "members:write",
  "operations:write",
  "payments:read",
  "payments:write",
  "sales:read",
  "facilities:write",
  "notices:write",
  "people:manage",
  "ai:read",
] as const;
export type Permission = (typeof permissions)[number];
export const membershipSchema = z.object({
  branchId: z.string(),
  role: z.enum(["admin", "staff"]),
  permissions: z.array(z.enum(permissions)),
  // Older demo/read-only servers omit these fields. Canonical organization responses require both.
  status: z.enum(["승인 대기", "활성", "회수"]).optional(),
  version: z.number().int().positive().optional(),
});
export type Membership = z.infer<typeof membershipSchema>;
const str = z.string().trim().min(1, "필수 항목입니다.");
const money = z.number().int().nonnegative("0 이상을 입력해 주세요.");
const base = z.object({
  id: str,
  branchId: str,
  version: z.number().int().positive(),
  createdAt: str,
  updatedAt: str,
});
const person = base.extend({
  name: str,
  email: z.email("이메일 형식을 확인해 주세요."),
  status: z.enum(["활성", "승인 대기", "이용 제한", "비활성"]),
  nickname: z.string(),
  avatar: z.string(),
  memberships: z.array(membershipSchema),
  owner: z.boolean(),
});
export const schemas = {
  branches: base.extend({
    name: str,
    address: str,
    phone: str,
    hours: str,
    status: z.enum(["운영 중", "운영 중지"]),
  }),
  employees: person,
  tasks: base.extend({
    title: str.max(120),
    body: str,
    assigneeId: str,
    due: str,
    priority: z.enum(["높음", "보통", "낮음"]),
    category: str,
    status: z.enum(["할 일", "진행 중", "완료"]),
    checks: z.array(z.object({ text: str, done: z.boolean() })),
    history: z.array(z.object({ at: str, actorId: str, text: str })),
  }),
  members: base.extend({
    name: str,
    email: z.email().or(z.literal("")),
    phone: str,
    status: z.enum(["정상", "이용 제한", "비활성"]),
    note: z.string(),
    branchIds: z.array(str),
  }),
  products: base.extend({
    name: str,
    kind: z.enum(["시간권", "기간권", "정액권"]),
    price: money.positive(),
    amount: money.positive(),
    hourlyRate: money,
    days: money.positive(),
    status: z.enum(["판매 중", "판매 중지"]),
  }),
  passes: base.extend({
    memberId: str,
    productId: str,
    name: str,
    kind: z.enum(["시간권", "기간권", "정액권"]),
    remaining: money,
    hourlyRate: money,
    expiresAt: str,
    used: z.boolean(),
    paymentId: str,
    status: z.enum(["활성", "소진", "만료", "환불"]),
  }),
  payments: base.extend({
    memberId: str,
    productId: z.string(),
    reservationId: z.string(),
    amount: money,
    method: z.enum(["Mock 카드", "Mock 현금"]),
    status: z.enum(["승인", "실패", "환불"]),
    refundAt: z.string(),
    refundBranchId: z.string(),
    reason: z.string(),
    approvedAt: str,
  }),
  seats: base.extend({
    name: str,
    zone: str,
    status: z.enum(["이용 가능", "이용 중", "사용 불가"]),
    memberId: z.string(),
  }),
  usage: base.extend({
    memberId: str,
    passId: str,
    seatId: str,
    startedAt: str,
    endedAt: z.string(),
    minutes: money,
    charged: money,
    excess: money,
    status: z.enum(["이용 중", "완료"]),
  }),
  lockers: base.extend({
    name: str,
    memberId: z.string(),
    startsOn: z.string(),
    endsOn: z.string(),
    status: z.enum(["이용 가능", "사용 중", "기간 만료", "사용 불가"]),
    history: z.array(str),
  }),
  rooms: base.extend({
    name: str,
    capacity: money.positive(),
    hourlyRate: money.positive(),
    status: z.enum(["이용 가능", "사용 불가"]),
  }),
  reservations: base.extend({
    memberId: str,
    roomId: str,
    startsAt: str,
    endsAt: str,
    people: money.positive(),
    amount: money,
    hourlyRate: money,
    paymentId: z.string(),
    status: z.enum(["예약 확정", "결제 실패", "이용 중", "완료", "취소"]),
  }),
  facilities: base.extend({
    title: str,
    category: str,
    assigneeId: str,
    body: str,
    cycleDays: money.positive(),
    lastChecked: str,
    nextCheck: str,
    condition: z.enum(["정상", "점검 필요", "고장", "사용 중지"]),
    status: z.enum(["할 일", "진행 중", "완료"]),
    result: z.string(),
  }),
  inquiries: base.extend({
    title: str,
    memberId: str,
    assigneeId: str,
    body: str,
    reply: z.string(),
    status: z.enum(["접수", "처리 중", "답변 완료"]),
  }),
  notices: base.extend({
    title: str,
    body: str,
    pinned: z.boolean(),
    authorId: str,
    status: z.enum(["게시 중", "게시 종료"]),
  }),
  shifts: base.extend({
    employeeId: str,
    startsAt: str,
    endsAt: str,
    breakMinutes: money,
    status: z.enum(["예정", "변경", "취소"]),
  }),
  attendance: base.extend({
    employeeId: str,
    startedAt: str,
    endedAt: z.string(),
    breaks: z.array(z.object({ start: str, end: z.string() })),
    workedMinutes: money,
    status: z.enum(["근무 중", "휴게 중", "퇴근"]),
  }),
  corrections: base.extend({
    employeeId: str,
    attendanceId: str,
    startedAt: str,
    endedAt: str,
    breakMinutes: money,
    reason: str,
    status: z.enum(["신청", "승인", "반려", "취소"]),
    decidedBy: z.string(),
    original: z.string(),
  }),
  leaveGrants: base.extend({
    employeeId: str,
    amount: z.number().positive(),
    startsOn: str,
    endsOn: str,
    reason: str,
  }),
  leaveRequests: base.extend({
    employeeId: str,
    startsOn: str,
    endsOn: str,
    amount: z.number().positive().multipleOf(0.5),
    reason: str,
    status: z.enum(["신청", "승인", "반려", "취소"]),
    decidedBy: z.string(),
  }),
  substitutions: base.extend({
    employeeId: str,
    shiftId: str,
    substituteId: str,
    startsAt: str,
    endsAt: str,
    reason: str,
    status: z.enum(["신청", "승인", "반려", "취소"]),
    decidedBy: z.string(),
    original: z.string(),
  }),
  invitations: base.extend({
    email: z.email(),
    name: str,
    role: z.enum(["admin", "staff"]),
    status: z.enum(["초대 대기", "승인 대기", "활성", "취소", "거절"]),
    delivery: z.enum(["발송 시뮬레이션", "발송 실패"]),
    expiresAt: str,
    token: str,
    employeeId: z.string(),
  }),
  channels: base.extend({
    name: str,
    description: z.string(),
    kind: z.enum(["channel", "dm"]),
    participantIds: z.array(str),
    reads: z.record(z.string(), z.number()),
    status: z.literal("활성"),
  }),
  messages: base.extend({
    channelId: str,
    authorId: str,
    text: z.string().trim().max(4000),
    parentId: z.string(),
    taskId: z.string(),
    clientMessageId: str,
    sequence: z.number().int().positive(),
  }),
  audit: base.extend({
    actorId: str,
    resource: str,
    targetId: str,
    action: str,
    before: z.string(),
    after: z.string(),
  }),
};
export type Resource = keyof typeof schemas;
export type ResourceMap = { [K in Resource]: z.infer<(typeof schemas)[K]> };
export type Entity = ResourceMap[Resource];
export type Employee = ResourceMap["employees"];
export type Task = ResourceMap["tasks"];
export type Message = ResourceMap["messages"];
export type Database = { [K in Resource]: ResourceMap[K][] };
export interface CurrentUser {
  user: Employee;
  branches: ResourceMap["branches"][];
  asOf: string;
  snapshotVersion: string;
  sessionMode?: "WORKSPACE" | "APPROVAL_ONLY";
}
export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  nextCursor?: string;
}
export interface WorkspaceEvent {
  id: string;
  type: "changed" | "message" | "read" | "permissions";
  resource: Resource;
  entityId: string;
  branchId: string;
}
export interface LookupData {
  preview?: boolean;
  branches: ResourceMap["branches"][];
  employees: LookupEmployee[];
  members: ResourceMap["members"][];
  products: ResourceMap["products"][];
  passes: ResourceMap["passes"][];
  rooms: ResourceMap["rooms"][];
  seats: ResourceMap["seats"][];
  shifts: ResourceMap["shifts"][];
  attendance: ResourceMap["attendance"][];
  channels: ResourceMap["channels"][];
}
// Canonical lookups contain only id/name. Older demo responses may also supply
// membership metadata, but a selection row is never an authorization record.
export type LookupEmployee = Pick<Employee, "id" | "name"> &
  Partial<Pick<Employee, "owner" | "memberships">>;
export const resources = Object.keys(schemas) as Resource[];
export const AS_OF = "2026-10-17T02:00:00.000Z";
export const businessDate = (iso: string) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(
    new Date(iso),
  );
export function displayDate(iso: string) {
  return iso
    ? new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(iso))
    : "—";
}
export const won = (value: number) =>
  `${new Intl.NumberFormat("ko-KR").format(value)}원`;
export function value(row: Entity, key: string): unknown {
  return (row as unknown as Record<string, unknown>)[key];
}
export function text(row: Entity, key: string): string {
  const v = value(row, key);
  return v == null ? "" : String(v);
}
export function can(
  user: Employee,
  branchId: string,
  permission?: Permission,
): boolean {
  if (user.status !== "활성") return false;
  if (user.owner) return true;
  const memberships =
    branchId === "all"
      ? user.memberships.filter((m) => !m.status || m.status === "활성")
      : user.memberships.filter(
          (m) => m.branchId === branchId && (!m.status || m.status === "활성"),
        );
  return memberships.some(
    (m) => !permission || m.permissions.includes(permission),
  );
}
export function admin(user: Employee, branchId: string) {
  return (
    user.status === "활성" &&
    (user.owner ||
      user.memberships.some(
        (m) =>
          (branchId === "all" || m.branchId === branchId) &&
          m.role === "admin" &&
          (!m.status || m.status === "활성"),
      ))
  );
}
export const overlap = (a: string, b: string, c: string, d: string) =>
  new Date(a).getTime() < new Date(d).getTime() &&
  new Date(c).getTime() < new Date(b).getTime();
export function charge(
  start: string,
  end: string,
  kind: "시간권" | "기간권" | "정액권",
  rate: number,
) {
  const minutes = Math.max(
    0,
    Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / 60000),
  );
  return {
    minutes,
    charged:
      kind === "기간권"
        ? 0
        : kind === "시간권"
          ? minutes
          : Math.ceil((rate * minutes) / 60),
  };
}
