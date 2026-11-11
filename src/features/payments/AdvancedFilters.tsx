import type { components } from "../../shared/api/foundation.generated";
import { Field } from "../organization/shared";

type Filter = components["schemas"]["PaymentFilter"];
type MultiKey =
  "methods" | "productKinds" | "operatorIds" | "processingBranchIds";
export type AdvancedFilterValues = Pick<Filter, MultiKey | "categoryCode">;
const methods: Filter["methods"] = ["현금", "카드", "계좌이체", "기타"];
const productKinds: Filter["productKinds"] = ["시간권", "기간권", "정액권"];

export function readAdvancedFilters(
  params: URLSearchParams,
): AdvancedFilterValues {
  return {
    methods: params
      .getAll("methods")
      .filter((v): v is Filter["methods"][number] =>
        methods.some((method) => method === v),
      ),
    productKinds: params
      .getAll("productKinds")
      .filter((v): v is Filter["productKinds"][number] =>
        productKinds.some((kind) => kind === v),
      ),
    categoryCode: params.get("categoryCode") || null,
    operatorIds: params.getAll("operatorIds"),
    processingBranchIds: params.getAll("processingBranchIds"),
  };
}

export function AdvancedFilters({
  values,
  branches,
  change,
}: {
  values: AdvancedFilterValues;
  branches: { id: string; name: string }[];
  change: (key: keyof AdvancedFilterValues, values: string[]) => void;
}) {
  function choices(
    key: MultiKey,
    label: string,
    options: { id: string; name: string }[],
  ) {
    return (
      <Field label={label}>
        <select
          multiple
          value={values[key]}
          onChange={(e) =>
            change(
              key,
              Array.from(e.target.selectedOptions, (option) => option.value),
            )
          }
        >
          {options.map(({ id, name }) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </Field>
    );
  }

  return (
    <details className="my-4">
      <summary>고급 필터</summary>
      <div className="filters">
        {choices(
          "methods",
          "결제 수단",
          methods.map((id) => ({ id, name: id })),
        )}
        {choices(
          "productKinds",
          "상품 유형",
          productKinds.map((id) => ({ id, name: id })),
        )}
        <Field label="상품 분류 코드">
          <input
            value={values.categoryCode ?? ""}
            onChange={(e) =>
              change("categoryCode", e.target.value ? [e.target.value] : [])
            }
          />
        </Field>
        <Field label="처리자 ID (쉼표로 구분)">
          <input
            key={values.operatorIds.join(",")}
            defaultValue={values.operatorIds.join(",")}
            onBlur={(e) =>
              change("operatorIds", [
                ...new Set(
                  e.target.value
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean),
                ),
              ])
            }
          />
        </Field>
        {choices("processingBranchIds", "환불 처리 지점", branches)}
      </div>
    </details>
  );
}

export function appliedAdvancedFilterEntries(values: AdvancedFilterValues) {
  return [
    ["결제 수단", values.methods.join(", ")],
    ["상품 유형", values.productKinds.join(", ")],
    ["상품 분류", values.categoryCode],
    ["처리자 ID", values.operatorIds.join(", ")],
    ["환불 처리 지점 ID", values.processingBranchIds.join(", ")],
  ].filter(([, value]) => value);
}

export function AppliedAdvancedFilters({
  values,
}: {
  values: AdvancedFilterValues;
}) {
  return (
    <dl className="help">
      {appliedAdvancedFilterEntries(values).map(([label, value]) => (
        <div key={label}>
          <dt className="inline mr-2">{label}</dt>
          <dd className="inline">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
