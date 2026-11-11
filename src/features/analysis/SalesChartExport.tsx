import type { ReactNode } from "react";
import { formatDateTime } from "../../shared/domain/format";
import { appliedAdvancedFilterEntries } from "../payments/AdvancedFilters";
import { ChartExport } from "./ChartExport";
import type { AggregationMeta } from "./sales-api";

export function SalesChartExport({
  title,
  unit,
  meta,
  branches,
  order,
  children,
}: {
  title: string;
  unit: string;
  meta: AggregationMeta;
  branches: { id: string; name: string }[];
  order?: string;
  children: ReactNode;
}) {
  const c = meta.condition;
  const names = c.branchIds.map(
    (id) => branches.find((branch) => branch.id === id)?.name ?? id,
  );
  const granularity =
    c.granularity &&
    { day: "일별", week: "주별", month: "월별" }[c.granularity];
  return (
    <ChartExport
      metadata={{
        title,
        unit,
        asOf: `${formatDateTime(meta.asOf)} · ${meta.timeZone}`,
        conditions: [
          `기간 ${formatDateTime(c.from)} 이상 ~ ${formatDateTime(c.to)} 미만 (${meta.timeZone})`,
          [
            `지점 ${names.join(", ")}`,
            c.purpose ?? "전체 용도",
            c.refundBasis === "processedDate"
              ? "환불 처리일 기준"
              : "원결제일 기준",
            granularity,
            order,
          ]
            .filter(Boolean)
            .join(" · "),
          ...appliedAdvancedFilterEntries(c).map(
            ([label, value]) => `${label} ${value}`,
          ),
          ...meta.conditionNotes.map(({ message }) => message),
        ],
      }}
    >
      {children}
    </ChartExport>
  );
}
