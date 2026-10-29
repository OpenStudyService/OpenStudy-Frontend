import { useQuery } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { api, queryString } from "../../shared/api/client";
import type { components } from "../../shared/api/foundation.generated";
import type { ProductCategory } from "./model";

/** The category API has a list and PATCH, but no GET /:id. Match immutable code and id. */
export async function loadCategory(
  category: ProductCategory,
  signal: AbortSignal,
) {
  for (let page = 1; ; page++) {
    const result = await api<components["schemas"]["ProductCategoryPage"]>(
      `/product-categories?${queryString({ page, pageSize: 100, q: category.code, sort: "code", direction: "asc" })}`,
      { signal },
    );
    const current = result.items.find((row) => row.id === category.id);
    if (current) return current;
    if (
      !result.items.length ||
      page * result.meta.pageSize >= result.meta.total
    )
      throw new Error("최신 분류를 찾지 못했어요. 목록을 다시 확인해 주세요.");
  }
}

/** Categories change rarely and are small; one page covers the whole set. */
export function useCategories() {
  const { session, scope } = useApp();
  return useQuery({
    queryKey: ["data", session.user.id, scope, "product-categories"],
    queryFn: ({ signal }) =>
      api<components["schemas"]["ProductCategoryPage"]>(
        `/product-categories?${queryString({ pageSize: 100, sort: "name", direction: "asc" })}`,
        { signal },
      ),
    retry: false,
  });
}
/** Server field names shown next to a rejected value. */
export const fieldLabels: Record<string, string> = {
  name: "상품명",
  priceKrw: "판매 금액",
  categoryId: "분류",
  branchIds: "판매 지점",
  status: "판매 상태",
  "terms.kind": "상품 유형",
  "terms.includedMinutes": "제공 시간(분)",
  "terms.periodDays": "이용 기간(일)",
  "terms.creditKrw": "충전 금액(원)",
  "terms.hourlyRateKrw": "시간당 요율(원)",
  "terms.validDays": "유효 기간(일)",
  code: "분류 코드",
};
