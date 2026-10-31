import type {
  components,
  operations,
} from "../../shared/api/foundation.generated";

export type Payment = components["schemas"]["Payment"];
export type Pass = components["schemas"]["Pass"];
export type PaymentCreate = components["schemas"]["PaymentCreate"];
export type RefundCreate = components["schemas"]["RefundCreate"];
export type PaymentPage = components["schemas"]["PaymentPage"];
export type PassPage = components["schemas"]["PassPage"];
export type PaymentFilters = NonNullable<
  operations["listPayments"]["parameters"]["query"]
>;
export type PassFilters = NonNullable<
  operations["listPasses"]["parameters"]["query"]
>;

export const paymentStatuses = ["승인", "실패", "환불"] as const;
export const passStatuses = ["활성", "소진", "만료", "환불"] as const;
export const passKinds = ["시간권", "기간권", "정액권"] as const;
export const paymentMethods = ["카드", "현금", "계좌이체", "기타"] as const;
export const mockPaymentNotice = "Mock 결제·실제 금전 이동 없음";
