import type { ReactNode } from "react";
import { FieldError } from "../../shared/ui/primitives";
import { Field } from "../organization/shared";
import { kinds, saleStatuses } from "./model";
import type { Draft, Errors, Kind, ProductCategory } from "./model";

function Input({
  label,
  name,
  value,
  error,
  disabled,
  onChange,
  hint,
}: {
  label: string;
  name: keyof Draft;
  value: string;
  error?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  hint?: ReactNode;
}) {
  return (
    <div>
      <Field label={label}>
        <input
          name={name}
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          aria-invalid={!!error}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </Field>
      {hint && <p className="help">{hint}</p>}
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}
/** Categories a product of this kind may use; a retired category stays selectable only if already assigned. */
export function categoryOptions(
  categories: ProductCategory[],
  kind: Kind,
  currentId: string,
) {
  return categories.filter(
    (c) => c.kind === kind && (c.status === "활성" || c.id === currentId),
  );
}

export function ProductForm({
  mode,
  draft,
  errors,
  categories,
  branches,
  disabled = false,
  currentCategoryId = "",
  onChange,
}: {
  mode: "create" | "edit";
  draft: Draft;
  errors: Errors;
  categories: ProductCategory[];
  branches: { id: string; name: string }[];
  disabled?: boolean;
  currentCategoryId?: string;
  onChange: (draft: Draft) => void;
}) {
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    onChange({ ...draft, [key]: value });
  const options = categoryOptions(categories, draft.kind, currentCategoryId);
  return (
    <div className="grid gap-3">
      <div>
        <Field label="상품명">
          <input
            name="name"
            maxLength={120}
            disabled={disabled}
            aria-invalid={!!errors.name}
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        {errors.name && <FieldError>{errors.name}</FieldError>}
      </div>
      <Input
        label="판매 금액 (원)"
        name="price"
        value={draft.price}
        error={errors.price}
        disabled={disabled}
        onChange={(value) => set("price", value)}
      />
      <div>
        <Field label="상품 유형">
          <select
            name="kind"
            value={draft.kind}
            disabled={disabled || mode === "edit"}
            onChange={(e) => {
              const kind = e.target.value as Kind;
              const keep = categories.find((c) => c.id === draft.categoryId);
              onChange({
                ...draft,
                kind,
                categoryId: keep?.kind === kind ? draft.categoryId : "",
              });
            }}
          >
            {kinds.map((kind) => (
              <option key={kind}>{kind}</option>
            ))}
          </select>
        </Field>
        {mode === "edit" && (
          <p className="help">상품 유형은 등록한 뒤에는 바꿀 수 없어요.</p>
        )}
      </div>
      {draft.kind === "시간권" && (
        <Input
          label="제공 시간 (분)"
          name="includedMinutes"
          value={draft.includedMinutes}
          error={errors.includedMinutes}
          disabled={disabled}
          onChange={(value) => set("includedMinutes", value)}
          hint="분 단위로 입력해요. 예: 10시간권은 600"
        />
      )}
      {draft.kind === "기간권" && (
        <Input
          label="이용 기간 (일)"
          name="periodDays"
          value={draft.periodDays}
          error={errors.periodDays}
          disabled={disabled}
          onChange={(value) => set("periodDays", value)}
          hint="발급할 때 이 일수로 시작일과 종료일이 정해져요."
        />
      )}
      {draft.kind === "정액권" && (
        <>
          <Input
            label="충전 금액 (원)"
            name="creditKrw"
            value={draft.creditKrw}
            error={errors.creditKrw}
            disabled={disabled}
            onChange={(value) => set("creditKrw", value)}
          />
          <Input
            label="시간당 요율 (원)"
            name="hourlyRateKrw"
            value={draft.hourlyRateKrw}
            error={errors.hourlyRateKrw}
            disabled={disabled}
            onChange={(value) => set("hourlyRateKrw", value)}
            hint="구매 당시의 요율이 보존돼요."
          />
        </>
      )}
      {draft.kind !== "기간권" && (
        <fieldset className="grid gap-2">
          <legend>유효 기간</legend>
          <label className="block">
            <input
              type="checkbox"
              name="unlimited"
              disabled={disabled}
              checked={draft.unlimited}
              onChange={(e) =>
                onChange({
                  ...draft,
                  unlimited: e.target.checked,
                  validDays: e.target.checked ? "" : draft.validDays,
                })
              }
            />{" "}
            무기한 (유효 기간 없음)
          </label>
          <Input
            label="유효 기간 (일)"
            name="validDays"
            value={draft.validDays}
            error={errors.validDays}
            disabled={disabled || draft.unlimited}
            onChange={(value) => set("validDays", value)}
          />
        </fieldset>
      )}
      <div>
        <Field label="분류">
          <select
            name="categoryId"
            disabled={disabled}
            aria-invalid={!!errors.categoryId}
            value={draft.categoryId}
            onChange={(e) => set("categoryId", e.target.value)}
          >
            <option value="">분류 선택</option>
            {options.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
                {category.status === "비활성" ? " (사용 중지)" : ""}
              </option>
            ))}
          </select>
        </Field>
        {!options.length && (
          <p className="help">
            이 유형의 활성 분류가 없어요. 사장님이 분류를 먼저 등록해야 해요.
          </p>
        )}
        {errors.categoryId && <FieldError>{errors.categoryId}</FieldError>}
      </div>
      {mode === "create" && (
        <>
          <Field label="판매 상태">
            <select
              name="status"
              value={draft.status}
              onChange={(e) => set("status", e.target.value as Draft["status"])}
            >
              {saleStatuses.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </Field>
          <fieldset className="grid gap-1">
            <legend>판매 지점</legend>
            {!branches.length && (
              <p className="help">
                상품을 등록할 수 있는 지점이 없어요. 운영 설정 권한이 필요해요.
              </p>
            )}
            {branches.map((branch) => (
              <label className="block" key={branch.id}>
                <input
                  type="checkbox"
                  checked={draft.branchIds.includes(branch.id)}
                  onChange={(e) =>
                    set(
                      "branchIds",
                      e.target.checked
                        ? [...draft.branchIds, branch.id]
                        : draft.branchIds.filter((id) => id !== branch.id),
                    )
                  }
                />{" "}
                {branch.name}
              </label>
            ))}
            {errors.branchIds && <FieldError>{errors.branchIds}</FieldError>}
          </fieldset>
        </>
      )}
    </div>
  );
}
