import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { api, queryString } from "../../shared/api/client";
import type { components } from "../../shared/api/foundation.generated";
import { displayDate, won } from "../../shared/domain/schema";
import { Badge, Button, ErrorState, State } from "../../shared/ui/primitives";
import { Pager, SaveError } from "../organization/shared";
import { ProductForm } from "./ProductForm";
import { fieldLabels } from "./hooks";
import {
  canManageProduct,
  changeTypeLabel,
  draftFromProduct,
  hasErrors,
  snapshotChanges,
  termsLabel,
  updateBody,
  validateDraft,
} from "./model";
import type {
  Draft,
  Errors,
  Product,
  ProductCategory,
  SaleStatus,
} from "./model";

type RevisionPage = components["schemas"]["ProductRevisionPage"];
const latestText = (p: Product) =>
  `${p.name} / ${won(p.priceKrw)} / ${p.status} (v${p.version})`;

export function ProductDetail({
  product: initial,
  categories,
  onChanged,
}: {
  product: Product;
  categories: ProductCategory[];
  onChanged: (product: Product) => void;
}) {
  const { session, scope, lookups } = useApp();
  const user = session.user;
  // `product` is the latest server copy; `base` is the copy the draft started
  // from. They only differ after a version conflict was reloaded.
  const [product, setProduct] = useState(initial);
  const [base, setBase] = useState(initial);
  const [draft, setDraft] = useState<Draft>(() => draftFromProduct(initial));
  const [errors, setErrors] = useState<Errors>({});
  const [selection, setSelection] = useState(initial.branchIds);
  const [pending, setPending] = useState<SaleStatus | null>(null);
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState<{
    area: "edit" | "sale" | "branches";
    error: Error;
  } | null>(null);
  const [latest, setLatest] = useState("");
  const [busy, setBusy] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const manage = canManageProduct(user, product);
  const branchName = (id: string) =>
    session.branches.find((b) => b.id === id)?.name ?? id;
  const history = useQuery({
    queryKey: [
      "data",
      user.id,
      scope,
      "products",
      product.id,
      "history",
      product.version,
      historyPage,
    ],
    queryFn: ({ signal }) =>
      api<RevisionPage>(
        `/products/${product.id}/history?${queryString({ page: historyPage, pageSize: 20 })}`,
        { signal },
      ),
    enabled: manage,
    retry: false,
  });
  function applySaved(updated: Product) {
    setProduct(updated);
    setBase(updated);
    setDraft(draftFromProduct(updated));
    setSelection(updated.branchIds);
    setLatest("");
    setFailure(null);
    onChanged(updated);
  }
  async function run(
    area: "edit" | "sale" | "branches",
    request: () => Promise<Product>,
    done: string,
  ) {
    setBusy(true);
    setFailure(null);
    setNotice("");
    try {
      applySaved(await request());
      setNotice(done);
    } catch (e) {
      setFailure({ area, error: e as Error });
      // A rejected branch change returns to the saved set; a version
      // conflict keeps the input so it can be compared with the latest copy.
      const conflict = (e as { status?: number }).status === 409;
      if (area === "branches" && !conflict) setSelection(product.branchIds);
    } finally {
      setBusy(false);
      setPending(null);
    }
  }
  async function reload() {
    const current = await api<Product>(`/products/${product.id}`);
    setProduct(current);
    setLatest(latestText(current));
    onChanged(current);
  }
  function save() {
    setNotice("");
    const checked = validateDraft(draft, "edit");
    setErrors(checked.errors);
    if (hasErrors(checked.errors) || !checked.terms || !checked.priceKrw)
      return;
    const body = updateBody(
      base,
      draft,
      checked.terms,
      checked.priceKrw,
      product.version,
    );
    if (!body) {
      setNotice("변경한 내용이 없어요.");
      return;
    }
    void run(
      "edit",
      () => api<Product>(`/products/${product.id}`, { method: "PATCH", body }),
      "상품 정보를 저장했어요.",
    );
  }
  const refresh = async () => {
    try {
      await reload();
    } catch (e) {
      setFailure((f) => (f ? { ...f, error: e as Error } : f));
    }
  };
  const failed = (area: "edit" | "sale" | "branches") =>
    failure?.area === area ? failure.error : null;
  // The reloaded copy is shown beside the section that hit the conflict only.
  const latestFor = (area: "edit" | "sale" | "branches") =>
    failure?.area === area ? latest : "";
  const selectable = session.branches.filter(
    (b) =>
      product.branchIds.includes(b.id) ||
      (b.status === "운영 중" && user.status === "활성" && canManage(b.id)),
  );
  function canManage(id: string) {
    return (
      user.owner ||
      user.memberships.some(
        (m) =>
          m.branchId === id &&
          m.role === "admin" &&
          m.permissions.includes("operations:write") &&
          (!m.status || m.status === "활성"),
      )
    );
  }
  const nextStatus: SaleStatus =
    product.status === "판매 중" ? "판매 중지" : "판매 중";
  return (
    <div className="grid gap-6">
      <section className="grid gap-1">
        <h3>{product.name}</h3>
        <p className="help">
          {product.code} · {product.category.name} · {won(product.priceKrw)}
        </p>
        <p>{termsLabel(product.terms)}</p>
        <p>
          <Badge>{product.status}</Badge> 판매 지점:{" "}
          {product.branchIds.map(branchName).join(", ")} · 버전{" "}
          {product.version}
        </p>
        {notice && (
          <p className="help" role="status">
            {notice}
          </p>
        )}
      </section>

      <form
        className="grid gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <h3>상품 정보</h3>
        {!product.canEdit && (
          <p className="help" role="note">
            이 상품은 여러 지점이 함께 판매해요. 판매 중인 모든 지점에 대한 운영
            설정 권한이 있어야 수정할 수 있고, 지금은 조회만 가능해요.
          </p>
        )}
        <ProductForm
          mode="edit"
          draft={draft}
          errors={errors}
          categories={categories}
          branches={[]}
          disabled={!product.canEdit}
          currentCategoryId={base.category.id}
          onChange={setDraft}
        />
        <SaveError
          error={failed("edit")}
          latest={latestFor("edit")}
          refresh={refresh}
          fieldLabels={fieldLabels}
        />
        {product.canEdit && (
          <Button type="submit" variant="primary" disabled={busy}>
            상품 정보 저장
          </Button>
        )}
      </form>

      {product.canEdit && !manage && (
        <p className="help">
          판매 상태·판매 지점·변경 이력은 해당 상품의 모든 판매 지점에서 지점
          관리자 권한이 있어야 다룰 수 있어요.
        </p>
      )}
      {manage && (
        <>
          <section className="grid gap-2">
            <h3>판매 상태</h3>
            <p className="help">
              판매를 중지하면 새 판매만 막혀요. 기존 구매 내역과 변경 이력은
              그대로 보존돼요. 상품은 삭제할 수 없어요.
            </p>
            {pending ? (
              <div className="flex flex-wrap items-center gap-2">
                <span>
                  {pending === "판매 중지"
                    ? "이 상품의 판매를 중지할까요?"
                    : "이 상품의 판매를 다시 시작할까요?"}
                </span>
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      "sale",
                      () =>
                        api<Product>(`/products/${product.id}/status`, {
                          method: "POST",
                          body: { version: product.version, status: pending },
                        }),
                      pending === "판매 중지"
                        ? "판매를 중지했어요."
                        : "판매를 재개했어요.",
                    )
                  }
                >
                  {pending === "판매 중지" ? "중지 확인" : "재개 확인"}
                </Button>
                <Button disabled={busy} onClick={() => setPending(null)}>
                  취소
                </Button>
              </div>
            ) : (
              <div>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setNotice("");
                    setFailure(null);
                    setPending(nextStatus);
                  }}
                >
                  {nextStatus === "판매 중지" ? "판매 중지" : "판매 재개"}
                </Button>
              </div>
            )}
            <SaveError
              error={failed("sale")}
              latest={latestFor("sale")}
              refresh={refresh}
              fieldLabels={fieldLabels}
            />
          </section>

          <section className="grid gap-2">
            <h3>판매 지점</h3>
            <fieldset className="grid gap-1">
              <legend>판매 지점 선택</legend>
              {selectable.map((b) => (
                <label className="block" key={b.id}>
                  <input
                    type="checkbox"
                    checked={selection.includes(b.id)}
                    onChange={(e) =>
                      setSelection(
                        e.target.checked
                          ? [...selection, b.id]
                          : selection.filter((id) => id !== b.id),
                      )
                    }
                  />{" "}
                  {b.name}
                </label>
              ))}
            </fieldset>
            <div>
              <Button
                disabled={busy || !selection.length}
                onClick={() =>
                  void run(
                    "branches",
                    () =>
                      api<Product>(`/products/${product.id}/branches`, {
                        method: "PUT",
                        body: {
                          version: product.version,
                          branchIds: [...selection].sort(),
                        },
                      }),
                    "판매 지점을 저장했어요.",
                  )
                }
              >
                판매 지점 저장
              </Button>
            </div>
            {!selection.length && (
              <p className="help">판매 지점은 하나 이상이어야 해요.</p>
            )}
            <SaveError
              error={failed("branches")}
              latest={latestFor("branches")}
              refresh={refresh}
              fieldLabels={fieldLabels}
            />
          </section>

          <section className="grid gap-2">
            <h3>변경 이력</h3>
            {history.isPending ? (
              <State loading />
            ) : history.error ? (
              <ErrorState
                error={history.error}
                retry={() => void history.refetch()}
              />
            ) : (
              <>
                <ol className="grid gap-3">
                  {history.data.items.map((revision) => (
                    <li
                      key={revision.id}
                      className="rounded-xl border border-line p-3"
                    >
                      <p>
                        <strong>v{revision.version}</strong> ·{" "}
                        {changeTypeLabel[revision.changeType]} ·{" "}
                        {displayDate(revision.changedAt)} ·{" "}
                        {lookups.employees.find(
                          (e) => e.id === revision.actorId,
                        )?.name ??
                          revision.actorId ??
                          "시스템"}
                      </p>
                      <ul>
                        {snapshotChanges(
                          revision.before,
                          revision.after,
                          branchName,
                        ).map((change) => (
                          <li key={change.label}>
                            {change.label}:{" "}
                            {revision.before
                              ? `${change.before} → ${change.after}`
                              : change.after}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ol>
                <Pager
                  page={historyPage}
                  total={history.data.meta.total}
                  onChange={setHistoryPage}
                />
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
