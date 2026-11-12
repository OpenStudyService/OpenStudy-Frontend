import { Popover } from "radix-ui";
import { Icon } from "../../shared/ui/Icon";
import { Button } from "../../shared/ui/primitives";
import type { AdvancedFilterValues } from "../payments/AdvancedFilters";

type Choice = { id: string; name: string };

export function SalesAdvancedFilters({
  values,
  branches,
  change,
}: {
  values: AdvancedFilterValues;
  branches: Choice[];
  change: (key: keyof AdvancedFilterValues, values: string[]) => void;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button type="button">
          고급 필터
          <Icon name="chevron" className="rotate-90" size={14} />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          aria-label="매출 고급 필터"
          align="start"
          sideOffset={6}
          className="z-50 grid w-[32rem] max-w-[var(--radix-popover-content-available-width)] max-h-[var(--radix-popover-content-available-height)] gap-4 overflow-auto rounded-lg border border-line bg-surface p-4 shadow-xl sm:grid-cols-2"
        >
          <label className="field">
            결제 수단
            <select
              multiple
              value={values.methods}
              onChange={(e) =>
                change(
                  "methods",
                  Array.from(
                    e.target.selectedOptions,
                    (option) => option.value,
                  ),
                )
              }
            >
              {["현금", "카드", "계좌이체", "기타"].map((method) => (
                <option key={method}>{method}</option>
              ))}
            </select>
          </label>
          <SalesProductKindFilter
            values={values.productKinds}
            change={(kinds) => change("productKinds", kinds)}
          />
          <label className="field">
            상품 분류 코드
            <input
              value={values.categoryCode ?? ""}
              onChange={(e) =>
                change("categoryCode", e.target.value ? [e.target.value] : [])
              }
            />
          </label>
          <label className="field">
            처리자 ID (쉼표로 구분)
            <input
              key={values.operatorIds.join(",")}
              defaultValue={values.operatorIds.join(",")}
              onBlur={(e) => {
                const ids = [
                  ...new Set(
                    e.target.value
                      .split(",")
                      .map((id) => id.trim())
                      .filter(Boolean),
                  ),
                ];
                if (ids.join(",") !== values.operatorIds.join(","))
                  change("operatorIds", ids);
              }}
            />
          </label>
          <FilterDropdown
            label="환불 처리 지점"
            options={branches}
            values={values.processingBranchIds}
            change={(ids) => change("processingBranchIds", ids)}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function SalesProductKindFilter({
  values,
  change,
}: {
  values: string[];
  change: (values: string[]) => void;
}) {
  return (
    <FilterDropdown
      label="상품 유형"
      options={["시간권", "기간권", "정액권"].map((id) => ({ id, name: id }))}
      values={values}
      change={change}
    />
  );
}

function FilterDropdown({
  label,
  options,
  values,
  change,
}: {
  label: string;
  options: Choice[];
  values: string[];
  change: (values: string[]) => void;
}) {
  const selection =
    values.length === 0
      ? "전체"
      : values.length === 1
        ? (options.find(({ id }) => id === values[0])?.name ?? values[0])
        : `${values.length}개 선택`;
  return (
    <div className="field content-start">
      <span>{label}</span>
      <Popover.Root>
        <Popover.Trigger asChild>
          <Button
            type="button"
            className="justify-between"
            aria-label={`${label}, ${selection}`}
          >
            <span className="min-w-0 truncate">{selection}</span>
            <Icon name="chevron" className="rotate-90" size={14} />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            aria-label={label}
            align="start"
            sideOffset={4}
            className="z-[60] grid w-max min-w-[var(--radix-popover-trigger-width)] max-w-[var(--radix-popover-content-available-width)] max-h-[var(--radix-popover-content-available-height)] gap-2 overflow-auto rounded-lg border border-line bg-surface p-3 shadow-xl"
          >
            {options.length === 0 && (
              <p className="help">선택할 항목이 없어요.</p>
            )}
            {options.map(({ id, name }) => (
              <label key={id} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={values.includes(id)}
                  onChange={(e) =>
                    change(
                      e.target.checked
                        ? [...values, id]
                        : values.filter((value) => value !== id),
                    )
                  }
                />
                {name}
              </label>
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
