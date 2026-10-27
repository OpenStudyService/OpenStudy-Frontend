import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { useApp } from "../../app/context";
import { api, MOCK, queryString } from "../../shared/api/client";
import type { components } from "../../shared/api/foundation.generated";
import {
  Badge,
  Button,
  ErrorState,
  Heading,
  Panel,
  State,
} from "../../shared/ui/primitives";
import { Field, Pager, useListSearch } from "../organization/shared";
import { CategoryManagement } from "./Categories";
import { ProductCreate } from "./ProductCreate";
import { ProductDetail } from "./ProductDetail";
import { useCategories } from "./hooks";
import { won } from "../../shared/domain/schema";
import { canWriteBranch, kinds, saleStatuses, termsLabel } from "./model";
import type { Product } from "./model";

type ProductPage = components["schemas"]["ProductPage"];

export function ProductManagement() {
  const { session, scope } = useApp();
  const query = useQueryClient();
  const user = session.user;
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "categories" ? "categories" : "products";
  const { page, search, setPage, setSearch } = useListSearch("product");
  const status = params.get("productStatus") || "";
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
    ],
    queryFn: ({ signal }) =>
      api<ProductPage>(
        `/products?${queryString({ scope, page, pageSize: 20, q: search, status, kind, categoryId, sort: "name", direction: "asc" })}`,
        { signal },
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
    await query.invalidateQueries({ queryKey: ["data", user.id] });
  }
  return (
    <section className="page">
      <Heading
        title="상품·요율"
        description="시간권·기간권·정액권의 판매 조건과 변경 이력을 관리해요."
      >
        {tab === "products" && writable.length > 0 && (
          <Button variant="primary" onClick={() => setSelected("new")}>
            상품 등록
          </Button>
        )}
      </Heading>
      {MOCK && (
        <p className="help mb-4">
          데모 화면입니다. 변경 내용은 실제 상품 정보에 반영되지 않습니다.
        </p>
      )}
      <div className="mb-5 flex gap-2">
        <Button
          aria-pressed={tab === "products"}
          onClick={() => setFilter("tab", "")}
        >
          상품 목록
        </Button>
        <Button
          aria-pressed={tab === "categories"}
          onClick={() => setFilter("tab", "categories")}
        >
          분류
        </Button>
      </div>
      {tab === "categories" ? (
        <CategoryManagement />
      ) : (
        <>
          <p className="help mb-3">
            상품은 삭제할 수 없어요. 더 이상 팔지 않는 상품은 판매를 중지해
            주세요. 기존 구매 내역과 변경 이력은 보존돼요.
          </p>
          <div className="grid gap-2 sm:grid-cols-4">
            <Field label="상품명·코드 검색">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </Field>
            <Field label="판매 상태 필터">
              <select
                value={status}
                onChange={(e) => setFilter("productStatus", e.target.value)}
              >
                <option value="">전체 상태</option>
                {saleStatuses.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="상품 유형 필터">
              <select
                value={kind}
                onChange={(e) => setFilter("productKind", e.target.value)}
              >
                <option value="">전체 유형</option>
                {kinds.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </Field>
            <Field label="분류 필터">
              <select
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
            </Field>
          </div>
          {products.isPending ? (
            <State loading />
          ) : products.error ? (
            <ErrorState
              error={products.error}
              retry={() => void products.refetch()}
            />
          ) : (
            <>
              {!products.data.items.length && (
                <State title="조건에 맞는 상품이 없어요" />
              )}
              {products.data.items.map((product) => (
                <article
                  className="my-3 rounded-xl border border-line p-4"
                  key={product.id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3>{product.name}</h3>
                      <p className="help">
                        {product.code} · {product.terms.kind} ·{" "}
                        {product.category.name} · {won(product.priceKrw)}
                      </p>
                      <p>{termsLabel(product.terms)}</p>
                      <p className="help">
                        판매 지점:{" "}
                        {product.branchIds.map(branchName).join(", ")}
                      </p>
                      <Badge>{product.status}</Badge>
                      {!product.canEdit && (
                        <p className="help">
                          조회 전용 · 모든 판매 지점의 운영 권한이 있어야 수정할
                          수 있어요.
                        </p>
                      )}
                    </div>
                    <Button onClick={() => setSelected(product)}>
                      상품 상세: {product.name}
                    </Button>
                  </div>
                </article>
              ))}
              <Pager
                page={page}
                total={products.data.meta.total}
                onChange={setPage}
              />
            </>
          )}
        </>
      )}
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
