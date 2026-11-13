import { readListPage } from "../../shared/api/read-sorted-pages";
import { useTableSort } from "../../shared/ui/table-sort";
import { Tabs } from "radix-ui";
import { hasBlockingReadError } from "../../shared/api/read-model";
import { invalidateReads } from "../../shared/api/invalidateReads";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { useApp } from "../../app/context";
import { api, MOCK, queryString } from "../../shared/api/client";
import { saleAvailabilities } from "../../shared/domain/sale";
import { Badge, Button, Heading, Panel } from "../../shared/ui/primitives";
import {
  ListCard,
  ListFilters,
  ListFooter,
  ListTable,
} from "../../shared/ui/ListLayout";
import { useListSearch } from "../organization/shared";
import { CategoryManagement } from "./Categories";
import { ProductCreate } from "./ProductCreate";
import { ProductDetail } from "./ProductDetail";
import { useCategories } from "./hooks";
import { won } from "../../shared/domain/schema";
import {
  canWriteBranch,
  kinds,
  saleStatuses,
  termsLabel,
  saleLabel,
} from "./model";
import type { Product, ProductPage } from "./model";

// 초기화 대상: 상품 목록 필터와 페이지만. tab은 남긴다.
const PRODUCT_FILTER_KEYS = [
  "productSearch",
  "productStatus",
  "productKind",
  "productCategory",
  "productAvailability",
  "productPage",
  "productSort",
  "productDirection",
];
const PAGE_SIZE = 20;

export function ProductManagement() {
  const { session, scope } = useApp();
  const query = useQueryClient();
  const user = session.user;
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "categories" ? "categories" : "products";
  const { page, search, setPage, setSearch } = useListSearch("product");
  const sorting = useTableSort({ sort: "name", direction: "asc" }, "product");
  const status = params.get("productStatus") || "";
  const availability = params.get("productAvailability") ?? "";
  const kind = params.get("productKind") || "";
  const categoryId = params.get("productCategory") || "";
  const [selected, setSelected] = useState<Product | "new" | null>(null);
  const categories = useCategories();
  const setFilter = (name: string, value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(name, value);
        else next.delete(name);
        next.set("productPage", "1");
        return next;
      },
      { replace: true },
    );
  const clientSort = sorting.fallback({
    kind: (product: Product) => product.terms.kind,
    category: (product: Product) => product.category.name,
    terms: (product: Product) => termsLabel(product.terms),
    branches: (product: Product) =>
      product.branchIds
        .map((id) => session.branches.find((b) => b.id === id)?.name ?? id)
        .join(", "),
    status: (product: Product) => product.status,
  });
  const products = useQuery({
    queryKey: [
      "data",
      user.id,
      scope,
      "products",
      page,
      search,
      status,
      kind,
      categoryId,
      availability,
      sorting.value,
    ],
    queryFn: ({ signal }) =>
      readListPage<ProductPage>(
        (page, pageSize) =>
          api<ProductPage>(
            `/products?${queryString({ scope, page, pageSize, q: search, status, kind, categoryId, availability, ...(!clientSort && sorting.value) })}`,
            { signal },
          ),
        page,
        PAGE_SIZE,
        sorting.value.direction,
        clientSort,
      ),
    enabled: tab === "products",
    retry: false,
  });
  const writable = session.branches.filter(
    (b) => b.status === "운영 중" && canWriteBranch(user, b.id),
  );
  const branchName = (id: string) =>
    session.branches.find((b) => b.id === id)?.name ?? id;
  async function refresh() {
    await invalidateReads(query, user.id, "products", "lookups");
  }
  return (
    <section className="page">
      <Heading
        title="상품 관리"
        description="시간권·기간권·정액권의 판매 조건과 변경 이력을 관리해요."
      />
      <Tabs.Root
        value={tab}
        onValueChange={(value) =>
          setFilter("tab", value === "products" ? "" : value)
        }
      >
        <Tabs.List className="tabs" aria-label="상품 관리">
          <Tabs.Trigger
            value="products"
            className={`tab ${tab === "products" ? "active" : ""}`}
          >
            상품 목록
          </Tabs.Trigger>
          <Tabs.Trigger
            value="categories"
            className={`tab ${tab === "categories" ? "active" : ""}`}
          >
            분류
          </Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="products">
          {MOCK && (
            <p className="help mb-4">
              데모 화면입니다. 변경 내용은 실제 상품 정보에 반영되지 않습니다.
            </p>
          )}
          <ListCard>
            <ListFilters
              actions={
                writable.length > 0 && (
                  <Button variant="primary" onClick={() => setSelected("new")}>
                    상품 등록
                  </Button>
                )
              }
            >
              <input
                type="search"
                aria-label="상품명·코드 검색"
                placeholder="상품명·코드 검색"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                aria-label="판매 가능 여부"
                value={availability}
                onChange={(e) =>
                  setFilter("productAvailability", e.target.value)
                }
              >
                <option value="">판매 가능 여부 전체</option>
                {saleAvailabilities.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
              <select
                aria-label="판매 상태 필터"
                value={status}
                onChange={(e) => setFilter("productStatus", e.target.value)}
              >
                <option value="">전체 상태</option>
                {saleStatuses.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <select
                aria-label="상품 유형 필터"
                value={kind}
                onChange={(e) => setFilter("productKind", e.target.value)}
              >
                <option value="">전체 유형</option>
                {kinds.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
              <select
                aria-label="분류 필터"
                value={categoryId}
                onChange={(e) => setFilter("productCategory", e.target.value)}
              >
                <option value="">전체 분류</option>
                {categories.data?.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <Button
                variant="quiet"
                onClick={() =>
                  setParams(
                    (current) => {
                      const next = new URLSearchParams(current);
                      PRODUCT_FILTER_KEYS.forEach((key) => next.delete(key));
                      return next;
                    },
                    { replace: true },
                  )
                }
              >
                초기화
              </Button>
            </ListFilters>
            <p className="px-5 pb-3 text-xs text-muted">
              상품은 삭제할 수 없어요. 더 이상 팔지 않는 상품은 판매를 중지해
              주세요. 기존 구매 내역과 변경 이력은 보존돼요.
            </p>
            <ListTable
              label="상품 목록"
              columns={[
                sorting.column("상품명", "name"),
                sorting.column("유형", "kind"),
                sorting.column("분류", "category"),
                sorting.column("판매 금액", "priceKrw"),
                sorting.column("이용 조건", "terms"),
                sorting.column("판매 지점", "branches"),
                sorting.column("상태", "status"),
              ]}
              loading={products.isPending}
              error={
                !products.data || hasBlockingReadError(products)
                  ? products.error
                  : null
              }
              onRetry={() => void products.refetch()}
              isEmpty={!products.data?.items.length}
              empty={{ title: "조건에 맞는 상품이 없어요" }}
            >
              {products.data?.items.map((product) => (
                <tr key={product.id}>
                  <td>
                    <button
                      className="cell-link"
                      onClick={() => setSelected(product)}
                    >
                      {product.name}
                    </button>
                    <span className="help block">{product.code}</span>
                  </td>
                  <td>{product.terms.kind}</td>
                  <td>{product.category.name}</td>
                  <td>{won(product.priceKrw)}</td>
                  <td>
                    {termsLabel(product.terms)}
                    {saleLabel(product) && (
                      <span className="help block">{saleLabel(product)}</span>
                    )}
                  </td>
                  <td>{product.branchIds.map(branchName).join(", ")}</td>
                  <td>
                    <Badge
                      tone={product.status === "판매 중지" ? "warn" : undefined}
                    >
                      {product.status}
                    </Badge>
                    {!product.canEdit && (
                      <span
                        className="help block"
                        title="모든 판매 지점의 운영 권한이 있어야 수정할 수 있어요."
                      >
                        조회 전용
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </ListTable>
            <ListFooter
              page={page}
              pageSize={PAGE_SIZE}
              total={products.data?.meta.total ?? 0}
              loading={products.isPending}
              error={!!products.error}
              onChange={setPage}
            />
          </ListCard>
        </Tabs.Content>
        <Tabs.Content value="categories">
          <CategoryManagement />
        </Tabs.Content>
      </Tabs.Root>
      <Panel
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected === "new" ? "상품 등록" : "상품 상세"}
        wide
      >
        {selected === "new" ? (
          <ProductCreate
            categories={categories.data?.items ?? []}
            branches={writable}
            defaultBranchId={scope}
            onSaved={async () => {
              setSelected(null);
              await refresh();
            }}
          />
        ) : (
          selected && (
            <ProductDetail
              key={selected.id}
              product={selected}
              categories={categories.data?.items ?? []}
              onChanged={() => void refresh()}
            />
          )
        )}
      </Panel>
    </section>
  );
}
