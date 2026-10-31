import type { Field } from "./catalog";
import type { Entity, Resource } from "./schema";
import { text } from "./schema";
export const commandFields = (
  resource: Resource,
  action: string,
  row: Entity,
): Field[] => {
  const field = (
    key: string,
    label: string,
    type: Field["type"] = "text",
    extra: Partial<Field> = {},
  ): Field => ({ key, label, type, required: true, ...extra });
  if (action === "refund") return [field("reason", "환불 사유", "textarea")];
  if (action === "adjust")
    return [
      field("remaining", "잔여량 (분 / 일 / 원)", "number", { min: 0 }),
      field("expiresAt", "유효기간", "datetime-local"),
      field("reason", "조정 사유", "textarea"),
    ];
  if (action === "assign" && resource === "seats")
    return [
      field("memberId", "회원", "select", { ref: "members" }),
      field("passId", "보유 이용권", "select", { ref: "passes" }),
    ];
  if (action === "move")
    return [field("targetSeatId", "옮길 좌석", "select", { ref: "seats" })];
  if (action === "assign" && resource === "lockers")
    return [
      field("memberId", "회원", "select", { ref: "members" }),
      field("startsOn", "배정 시작", "date"),
      field("endsOn", "배정 종료", "date"),
    ];
  if (action === "extend") return [field("endsOn", "연장 종료일", "date")];
  if (action === "inspect")
    return [
      field("result", "점검 결과", "textarea"),
      field("condition", "시설 상태", "select", {
        options: ["정상", "점검 필요", "고장", "사용 중지"],
      }),
    ];
  if (action === "cancel" || action === "return")
    return [field("reason", "처리 사유", "textarea")];
  if (action === "reschedule")
    return [field("reason", "취소·재예약 사유", "textarea")];
  if (action === "checkout") return [];
  return text(row, "status") === "신청" && action === "reject"
    ? [field("reason", "반려 사유", "textarea")]
    : [];
};
