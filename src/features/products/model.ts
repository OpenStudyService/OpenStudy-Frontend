import type { components } from "../../shared/api/foundation.generated";
import { won } from "../../shared/domain/schema";
import type { Employee } from "../../shared/domain/schema";

export type Product = components["schemas"]["Product"];
export type ProductTerms = components["schemas"]["ProductTerms"];
export type ProductCategory = components["schemas"]["ProductCategory"];
export type ProductRevision = components["schemas"]["ProductRevision"];
export type ProductSnapshot = components["schemas"]["ProductSnapshot"];
export type ProductCreate = components["schemas"]["ProductCreate"];
export type ProductUpdate = components["schemas"]["ProductUpdate"];
export type Kind = ProductTerms["kind"];
export type SaleStatus = Product["status"];

export const kinds: Kind[] = ["시간권", "기간권", "정액권"];
export const saleStatuses: SaleStatus[] = ["판매 중", "판매 중지"];
/** The API accepts these inclusive ranges (Backend product-api.md). */
export const UNIT_MAX = 4294967295;
export const KRW_MAX = Number.MAX_SAFE_INTEGER;

/** Text inputs stay strings so "empty" and "0" are distinguishable from a number. */
export interface Draft {
  name: string;
  price: string;
  kind: Kind;
  includedMinutes: string;
  periodDays: string;
  creditKrw: string;
  hourlyRateKrw: string;
  validDays: string;
  unlimited: boolean;
  categoryId: string;
  status: SaleStatus;
  branchIds: string[];
}
export type Errors = Partial<Record<keyof Draft, string>>;

export const emptyDraft = (kind: Kind = "시간권"): Draft => ({
  name: "",
  price: "",
  kind,
  includedMinutes: "",
  periodDays: "",
  creditKrw: "",
  hourlyRateKrw: "",
  validDays: "",
  unlimited: false,
  categoryId: "",
  status: "판매 중",
  branchIds: [],
});
export function draftFromProduct(product: Product): Draft {
  const { terms } = product;
  const base = {
    ...emptyDraft(terms.kind),
    name: product.name,
    price: String(product.priceKrw),
    categoryId: product.category.id,
    status: product.status,
    branchIds: [...product.branchIds],
  };
  if (terms.kind === "기간권")
    return { ...base, periodDays: String(terms.periodDays) };
  const validity =
    terms.validDays === null
      ? { unlimited: true, validDays: "" }
      : { unlimited: false, validDays: String(terms.validDays) };
  return terms.kind === "시간권"
    ? { ...base, ...validity, includedMinutes: String(terms.includedMinutes) }
    : {
        ...base,
        ...validity,
        creditKrw: String(terms.creditKrw),
        hourlyRateKrw: String(terms.hourlyRateKrw),
      };
}

/** Whole positive numbers only: no sign, decimal, exponent or leading zero. */
export function positiveInteger(text: string, max: number): number | null {
  const value = text.trim();
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= max ? parsed : null;
}
const unitError = (label: string, max: number) =>
  `${label}을(를) 1 이상 ${max.toLocaleString("ko-KR")} 이하의 정수로 입력해 주세요.`;

/** Builds only the selected kind's fields, so another kind's input is never sent. */
export function termsFromDraft(draft: Draft): {
  terms?: ProductTerms;
  errors: Errors;
} {
  const errors: Errors = {};
  const validity = (): number | null | undefined => {
    if (draft.unlimited) return null;
    const days = positiveInteger(draft.validDays, UNIT_MAX);
    if (days === null)
      errors.validDays = `${unitError("유효 기간(일)", UNIT_MAX)} 기간 제한이 없으면 ‘무기한’을 선택해 주세요.`;
    return days ?? undefined;
  };
  if (draft.kind === "시간권") {
    const includedMinutes = positiveInteger(draft.includedMinutes, UNIT_MAX);
    if (includedMinutes === null)
      errors.includedMinutes = unitError("제공 시간(분)", UNIT_MAX);
    const validDays = validity();
    return errors.includedMinutes || errors.validDays
      ? { errors }
      : {
          errors,
          terms: {
            kind: "시간권",
            includedMinutes: includedMinutes!,
            validDays: validDays!,
          },
        };
  }
  if (draft.kind === "기간권") {
    const periodDays = positiveInteger(draft.periodDays, UNIT_MAX);
    if (periodDays === null)
      errors.periodDays = unitError("이용 기간(일)", UNIT_MAX);
    return errors.periodDays
      ? { errors }
      : { errors, terms: { kind: "기간권", periodDays: periodDays! } };
  }
  const creditKrw = positiveInteger(draft.creditKrw, KRW_MAX);
  if (creditKrw === null)
    errors.creditKrw = unitError("충전 금액(원)", KRW_MAX);
  const hourlyRateKrw = positiveInteger(draft.hourlyRateKrw, KRW_MAX);
  if (hourlyRateKrw === null)
    errors.hourlyRateKrw = unitError("시간당 요율(원)", KRW_MAX);
  const validDays = validity();
  return errors.creditKrw || errors.hourlyRateKrw || errors.validDays
    ? { errors }
    : {
        errors,
        terms: {
          kind: "정액권",
          creditKrw: creditKrw!,
          hourlyRateKrw: hourlyRateKrw!,
          validDays: validDays!,
        },
      };
}
export function validateDraft(
  draft: Draft,
  mode: "create" | "edit",
): { errors: Errors; terms?: ProductTerms; priceKrw?: number } {
  const { terms, errors } = termsFromDraft(draft);
  const priceKrw = positiveInteger(draft.price, KRW_MAX);
  if (!draft.name.trim()) errors.name = "상품명을 입력해 주세요.";
  else if (draft.name.trim().length > 120)
    errors.name = "상품명은 120자 이하로 입력해 주세요.";
  if (priceKrw === null)
    errors.price =
      "판매 금액은 1원 이상의 정수여야 합니다. 0원은 등록할 수 없어요.";
  if (!draft.categoryId) errors.categoryId = "분류를 선택해 주세요.";
  if (mode === "create" && !draft.branchIds.length)
    errors.branchIds = "판매 지점을 하나 이상 선택해 주세요.";
  return { errors, terms, priceKrw: priceKrw ?? undefined };
}
export const hasErrors = (errors: Errors) => Object.keys(errors).length > 0;

export function createBody(
  draft: Draft,
  terms: ProductTerms,
  priceKrw: number,
): ProductCreate {
  return {
    name: draft.name.trim(),
    priceKrw,
    terms,
    status: draft.status,
    categoryId: draft.categoryId,
    branchIds: [...draft.branchIds].sort(),
  };
}
const sameTerms = (a: ProductTerms, b: ProductTerms) =>
  JSON.stringify(Object.entries(a).sort()) ===
  JSON.stringify(Object.entries(b).sort());
/**
 * Only what the user changed from `base` (the product the draft started from),
 * sent with the latest known `version`. Comparing against `base` keeps a newer
 * server value from being overwritten by an untouched field after a 409 reload.
 * `terms` is always the complete object of the unchanged kind.
 */
export function updateBody(
  base: Product,
  draft: Draft,
  terms: ProductTerms,
  priceKrw: number,
  version: number,
): ProductUpdate | null {
  const body: ProductUpdate = { version };
  if (draft.name.trim() !== base.name) body.name = draft.name.trim();
  if (priceKrw !== base.priceKrw) body.priceKrw = priceKrw;
  if (!sameTerms(terms, base.terms)) body.terms = terms;
  if (draft.categoryId !== base.category.id) body.categoryId = draft.categoryId;
  return Object.keys(body).length > 1 ? body : null;
}

export function minutesLabel(minutes: number) {
  const hours = Math.floor(minutes / 60),
    rest = minutes % 60;
  return hours
    ? rest
      ? `${hours}시간 ${rest}분`
      : `${hours}시간`
    : `${rest}분`;
}
export const validityLabel = (days: number | null) =>
  days === null ? "무기한" : `${days.toLocaleString("ko-KR")}일`;
export function termsLabel(terms: ProductTerms) {
  if (terms.kind === "시간권")
    return `${minutesLabel(terms.includedMinutes)}(${terms.includedMinutes.toLocaleString("ko-KR")}분) · 유효기간 ${validityLabel(terms.validDays)}`;
  if (terms.kind === "기간권")
    return `${terms.periodDays.toLocaleString("ko-KR")}일 이용`;
  return `충전 ${won(terms.creditKrw)} · 시간당 ${won(terms.hourlyRateKrw)} · 유효기간 ${validityLabel(terms.validDays)}`;
}

/** Client hints only. The server re-checks every grant on every request. */
const membershipsOf = (user: Employee, branchId: string) =>
  user.memberships.filter(
    (m) => m.branchId === branchId && (!m.status || m.status === "활성"),
  );
export const canWriteBranch = (user: Employee, branchId: string) =>
  user.status === "활성" &&
  (user.owner ||
    membershipsOf(user, branchId).some((m) =>
      m.permissions.includes("operations:write"),
    ));
export const canManageSale = (user: Employee, branchId: string) =>
  user.status === "활성" &&
  (user.owner ||
    membershipsOf(user, branchId).some(
      (m) => m.role === "admin" && m.permissions.includes("operations:write"),
    ));
/** Sale status, sale branches and history need every selling branch to be managed. */
export const canManageProduct = (user: Employee, product: Product) =>
  product.canEdit &&
  product.branchIds.every((branchId) => canManageSale(user, branchId));

export const changeTypeLabel: Record<ProductRevision["changeType"], string> = {
  CREATED: "최초 등록",
  UPDATED: "변경",
  BASELINE: "기준 이력",
  DELETED: "과거 삭제 이력",
};
export interface Change {
  label: string;
  before: string;
  after: string;
}
/** Human-readable differences; `before` is null for the first revision. */
export function snapshotChanges(
  before: ProductSnapshot | null,
  after: ProductSnapshot | null,
  branchName: (id: string) => string,
): Change[] {
  if (!after) return [];
  const names = (ids: string[]) =>
    [...ids].map(branchName).sort().join(", ") || "—";
  const fields: [string, (s: ProductSnapshot) => string][] = [
    ["상품명", (s) => s.name],
    ["판매 금액", (s) => won(s.priceKrw)],
    ["유형", (s) => s.terms.kind],
    ["조건", (s) => termsLabel(s.terms)],
    ["판매 상태", (s) => s.status],
    ["분류", (s) => `${s.categoryName} (${s.categoryCode})`],
    ["판매 지점", (s) => names(s.branchIds)],
  ];
  return fields
    .map(([label, read]) => ({
      label,
      before: before ? read(before) : "—",
      after: read(after),
    }))
    .filter((change) => !before || change.before !== change.after);
}
