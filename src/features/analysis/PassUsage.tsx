import { Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, queryString } from "../../shared/api/client";
import type { components } from "../../shared/api/foundation.generated";
import { hasBlockingReadError } from "../../shared/api/read-model";
import {
  formatDateTime,
  formatKrw,
  formatNumber,
} from "../../shared/domain/format";
import { ErrorState, State } from "../../shared/ui/primitives";
import { AppliedAdvancedFilters } from "../payments/AdvancedFilters";
import { passUsageCondition, type SalesCondition } from "./sales-api";
import { SalesCsvExport } from "./ExportButton";

type Schemas = components["schemas"];
export function PassUsage({
  userId,
  branches,
  condition,
}: {
  userId: string;
  branches: { id: string; name: string }[];
  condition: SalesCondition;
}) {
  const filters = passUsageCondition(condition);
  const read = useQuery({
    queryKey: ["data", userId, "sales", "pass-usage", filters],
    queryFn: ({ signal }) =>
      api<Schemas["PassUsageByBranch"]>(
        `/sales/passes/usage?${queryString(filters)}`,
        { signal },
      ),
    retry: false,
  });
  if (read.isPending) return <State loading />;
  if (hasBlockingReadError(read))
    return <ErrorState error={read.error!} retry={() => void read.refetch()} />;
  if (!read.data) return null;
  const { aggregation, totals, items } = read.data;
  const branchName = (id: string) =>
    branches.find((b) => b.id === id)?.name ?? id;
  function amounts(row: Schemas["PassUsageAmounts"]) {
    return (
      <>
        <td>{formatNumber(row.sessionCount)}</td>
        <td>{formatNumber(row.usedMinutes)}</td>
        <td>{formatKrw(row.usedCreditKrw)}</td>
      </>
    );
  }
  return (
    <section className="card p-5 mb-5" aria-label="이용 지점별 이용권 사용량">
      <div className="flex flex-wrap items-center gap-2">
        <h2>이용 지점별 이용권 사용량</h2>
        <SalesCsvExport
          report="passes-usage"
          condition={condition}
          total={items.reduce(
            (total, item) => total + item.bySaleBranch.length,
            0,
          )}
        />
      </div>
      <p className="help">
        이용 지점 {aggregation.condition.branchIds.map(branchName).join(", ")} ·{" "}
        {formatDateTime(aggregation.condition.from)} ~{" "}
        {formatDateTime(aggregation.condition.to)}
      </p>
      <AppliedAdvancedFilters values={aggregation.condition} />
      {aggregation.conditionNotes.map(({ code, message }) => (
        <p className="help" key={code}>
          {message}
        </p>
      ))}
      <div className="data-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>이용 지점</th>
              <th>판매 지점</th>
              <th>입실 수</th>
              <th>차감 분</th>
              <th>차감액</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <Fragment key={item.branchId}>
                <tr>
                  <th scope="row">{branchName(item.branchId)}</th>
                  <td>소계</td>
                  {amounts(item)}
                </tr>
                {item.bySaleBranch.map((sale) => (
                  <tr key={sale.saleBranchId ?? "hidden"}>
                    <td>{branchName(item.branchId)}</td>
                    <td>
                      {sale.visible && sale.saleBranchId
                        ? branchName(sale.saleBranchId)
                        : sale.label}
                    </td>
                    {amounts(sale)}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2}>
                합계
              </th>
              {amounts(totals)}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
