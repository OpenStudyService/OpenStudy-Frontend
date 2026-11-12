import { Collapsible, Popover } from "radix-ui";
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
  const activeCount = Object.values(values).filter(
    (value) => value?.length,
  ).length;
  return (
    <Collapsible.Root className="border-t border-line">
      <Collapsible.Trigger asChild>
        <button
          type="button"
          className="group flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left text-sm font-semibold text-ink transition-colors hover:bg-soft focus-visible:-outline-offset-4 data-[state=open]:bg-soft sm:px-5"
        >
          고급 필터
          <span className="flex items-center gap-2.5">
            {activeCount > 0 && (
              <span className="text-xs font-medium text-primary">
                {activeCount}개 적용
              </span>
            )}
            <Icon
              name="chevron"
              className="rotate-90 text-muted transition-transform group-data-[state=open]:-rotate-90"
              size={16}
            />
          </span>
        </button>
      </Collapsible.Trigger>
      <Collapsible.Content
        role="region"
        aria-label="매출 고급 필터"
        className="grid gap-4 border-t border-line bg-canvas/50 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3 [&_.field>input]:h-10"
      >
        <FilterDropdown
          label="결제 수단"
          options={["현금", "카드", "계좌이체", "기타"].map((id) => ({
            id,
            name: id,
          }))}
          values={values.methods}
          change={(methods) => change("methods", methods)}
        />
        <SalesProductKindFilter
          values={values.productKinds}
          change={(kinds) => change("productKinds", kinds)}
        />
        <FilterDropdown
          label="환불 처리 지점"
          options={branches}
          values={values.processingBranchIds}
          change={(ids) => change("processingBranchIds", ids)}
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
      </Collapsible.Content>
    </Collapsible.Root>
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
            className="h-10 min-w-0 justify-between text-[13px] font-medium"
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
