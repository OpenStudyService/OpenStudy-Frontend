export interface SaleSettings {
  salesStartsAt?: string | null;
  salesEndsAt?: string | null;
  salesLimit?: number | null;
}

export const saleAvailabilities = [
  "판매 가능",
  "판매 중지",
  "판매 전",
  "판매 종료",
  "한도 소진",
] as const;
export type SaleAvailability = (typeof saleAvailabilities)[number];

export interface SaleInfo extends SaleSettings {
  soldQuantity?: number;
  remainingQuantity?: number | null;
  saleAvailability?: SaleAvailability;
}

export function saleAvailability(
  product: SaleSettings & { status: string },
  now: number,
  sold: number,
): SaleAvailability {
  if (product.status === "판매 중지") return "판매 중지";
  if (product.salesStartsAt && now < Date.parse(product.salesStartsAt))
    return "판매 전";
  if (product.salesEndsAt && now >= Date.parse(product.salesEndsAt))
    return "판매 종료";
  if (product.salesLimit != null && sold >= product.salesLimit)
    return "한도 소진";
  return "판매 가능";
}

export const saleMessages: Record<string, string> = {
  PRODUCT_NOT_ON_SALE: "판매가 중지된 상품이에요.",
  PRODUCT_NOT_IN_SALE_PERIOD: "지금은 이 상품의 판매 기간이 아니에요.",
  PRODUCT_SALE_LIMIT_REACHED: "이 상품의 판매 한도가 소진됐어요.",
};
