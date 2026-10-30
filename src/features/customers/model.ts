import type { components } from "../../shared/api/foundation.generated";
import { can } from "../../shared/domain/schema";
import type { Employee } from "../../shared/domain/schema";

export type Customer = components["schemas"]["Customer"];
export type CustomerListItem = components["schemas"]["CustomerListItem"];
export type CustomerPage = components["schemas"]["CustomerPage"];
export type CustomerCreate = components["schemas"]["CustomerCreate"];
export type CustomerUpdate = components["schemas"]["CustomerUpdate"];
export type CustomerStatusChange =
  components["schemas"]["CustomerStatusChange"];
export const customerStatuses = ["정상", "이용 제한", "비활성"] as const;
export interface CustomerDraft {
  registeredBranchId: string;
  name: string;
  phone: string;
  email: string;
  memo: string;
}
export interface CustomerFilters {
  q: string;
  status: string;
  sort: "registeredAt" | "name";
  direction: "asc" | "desc";
  page: number;
  pageSize: number;
}
export const customerKeys = {
  root: (userId: string, scope: string) => ["data", userId, scope, "customers"],
  detail: (userId: string, scope: string, id: string) => [
    "data",
    userId,
    scope,
    "customers",
    "detail",
    id,
  ],
};
export const canCreateCustomer = (user: Employee, branch: string) =>
  !!branch && branch !== "all" && can(user, branch, "members:write");
export function parseCustomerFilters(params: URLSearchParams): CustomerFilters {
  const positive = (
    value: string | null,
    fallback: number,
    max = Number.MAX_SAFE_INTEGER,
  ) => {
    const parsed = Number(value);
    return value && Number.isSafeInteger(parsed) && parsed > 0
      ? Math.min(parsed, max)
      : fallback;
  };
  return {
    q: params.get("q") ?? "",
    status: customerStatuses.includes(
      params.get("status") as Customer["status"],
    )
      ? params.get("status")!
      : "",
    sort: params.get("sort") === "name" ? "name" : "registeredAt",
    direction: params.get("direction") === "asc" ? "asc" : "desc",
    page: positive(params.get("page"), 1),
    pageSize: positive(params.get("pageSize"), 20, 100),
  };
}
export function draftFromCustomer(
  customer?: Customer,
  scope = "all",
): CustomerDraft {
  return {
    registeredBranchId: customer
      ? (customer.registeredBranchId ?? "")
      : scope === "all"
        ? ""
        : scope,
    name: customer?.name ?? "",
    phone: customer?.phone ?? "",
    email: customer?.email ?? "",
    memo: customer?.memo ?? "",
  };
}
export const normalizeCustomerPhone = (phone: string) =>
  phone.replace(/[\s-]/g, "");
export function validateDraft(
  draft: CustomerDraft,
  creating: boolean,
): Record<string, string> {
  const fields: Record<string, string> = {};
  if (creating && !draft.registeredBranchId)
    fields.registeredBranchId = "등록 지점을 선택해 주세요.";
  if (!draft.name.trim() || draft.name.trim().length > 100)
    fields.name = "이름은 1~100자로 입력해 주세요.";
  if (!/^[0-9]{9,11}$/.test(normalizeCustomerPhone(draft.phone)))
    fields.phone = "연락처는 숫자 9~11자리로 입력해 주세요.";
  if (
    draft.email.trim() &&
    (draft.email.trim().length > 254 ||
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(draft.email.trim()))
  )
    fields.email = "올바른 이메일을 입력해 주세요.";
  if (draft.memo.trim().length > 1000)
    fields.memo = "응대 메모는 1000자 이내로 입력해 주세요.";
  return fields;
}
export function createBody(draft: CustomerDraft): CustomerCreate {
  return {
    registeredBranchId: draft.registeredBranchId,
    name: draft.name.trim(),
    phone: normalizeCustomerPhone(draft.phone),
    email: draft.email.trim() || null,
    memo: draft.memo.trim() || null,
  };
}
export function updateBody(
  base: Customer,
  draft: CustomerDraft,
  version: number,
): CustomerUpdate | null {
  const values = createBody(draft);
  const body: CustomerUpdate = { version };
  for (const key of ["name", "phone", "email", "memo"] as const) {
    if (values[key] !== base[key]) Object.assign(body, { [key]: values[key] });
  }
  return Object.keys(body).length > 1 ? body : null;
}
