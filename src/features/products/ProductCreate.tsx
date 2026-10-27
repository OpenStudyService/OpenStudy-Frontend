import { useState } from "react";
import { api } from "../../shared/api/client";
import { useIdempotency } from "../../shared/api/useIdempotency";
import { Button } from "../../shared/ui/primitives";
import { SaveError } from "../organization/shared";
import { ProductForm } from "./ProductForm";
import { fieldLabels } from "./hooks";
import { createBody, emptyDraft, hasErrors, validateDraft } from "./model";
import type { Draft, Errors, Product, ProductCategory } from "./model";

export function ProductCreate({
  categories,
  branches,
  defaultBranchId,
  onSaved,
}: {
  categories: ProductCategory[];
  branches: { id: string; name: string }[];
  defaultBranchId: string;
  onSaved: (product: Product) => void;
}) {
  const key = useIdempotency();
  const [draft, setDraft] = useState<Draft>(() => ({
    ...emptyDraft(),
    branchIds: branches.some((b) => b.id === defaultBranchId)
      ? [defaultBranchId]
      : [],
  }));
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setError(null);
    const checked = validateDraft(draft, "create");
    setErrors(checked.errors);
    if (hasErrors(checked.errors) || !checked.terms || !checked.priceKrw)
      return;
    setBusy(true);
    try {
      const body = createBody(draft, checked.terms, checked.priceKrw);
      const created = await api<Product>("/products", {
        method: "POST",
        body,
        key: key.key("create", body),
      });
      key.committed();
      onSaved(created);
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="help">
        상품은 삭제할 수 없어요. 더 이상 팔지 않으려면 등록 후 판매를 중지해
        주세요.
      </p>
      <ProductForm
        mode="create"
        draft={draft}
        errors={errors}
        categories={categories}
        branches={branches}
        onChange={setDraft}
      />
      <SaveError
        error={error}
        refresh={async () => undefined}
        fieldLabels={fieldLabels}
      />
      <Button type="submit" variant="primary" disabled={busy}>
        상품 등록
      </Button>
    </form>
  );
}
