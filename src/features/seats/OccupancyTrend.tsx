import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { hasBlockingReadError } from "../../shared/api/read-model";
import { formatPercent, formatShortDateTime } from "../../shared/domain/format";
import { ErrorState, State } from "../../shared/ui/primitives";
import { SalesTrendChart } from "../analysis/Charts";
import { Field } from "../organization/shared";
import { seatApi } from "./api";

export function OccupancyTrend({
  branchId,
  branchName,
  userId,
}: {
  branchId: string;
  branchName: string;
  userId: string;
}) {
  const [granularity, setGranularity] = useState<"hour" | "day">("hour");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const validPeriod = (!from && !to) || (!!from && !!to && from < to);
  const filters = {
    branchId,
    granularity,
    from: from ? `${from}T00:00:00+09:00` : undefined,
    to: to ? `${to}T00:00:00+09:00` : undefined,
  };
  const trend = useQuery({
    queryKey: ["data", userId, branchId, "seats", "occupancy-trend", filters],
    queryFn: ({ signal }) => seatApi.occupancyTrend(filters, signal),
    enabled: validPeriod,
    retry: false,
  });
  const data = trend.data;

  return (
    <section className="card mt-4 p-5" aria-label="좌석 점유 추이">
      <h2>좌석 점유 추이</h2>
      <div className="filters">
        <Field label="점유 추이 단위">
          <select
            value={granularity}
            onChange={(event) =>
              setGranularity(event.target.value === "day" ? "day" : "hour")
            }
          >
            <option value="hour">시간</option>
            <option value="day">일</option>
          </select>
        </Field>
        <Field label="점유 추이 시작일">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="점유 추이 종료일 (제외)">
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
      </div>
      {!validPeriod ? (
        <p className="help">시작일보다 늦은 종료일을 선택해 주세요.</p>
      ) : trend.isPending ? (
        <State loading />
      ) : hasBlockingReadError(trend) ? (
        <ErrorState error={trend.error!} retry={() => void trend.refetch()} />
      ) : (
        data && (
          <>
            <p className="help">
              {branchName} · {formatShortDateTime(data.from)} ~{" "}
              {formatShortDateTime(data.to)} · {data.timeZone} ·{" "}
              {data.granularity === "hour" ? "시간 단위" : "일 단위"}
            </p>
            <p>전체 점유율 {formatPercent(data.totals.occupancy.percent)}</p>
            <SalesTrendChart
              rows={data.items.map((item) => ({
                label: item.label,
                value: item.occupancy.percent,
              }))}
              label="좌석 점유율"
              format={formatPercent}
            />
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>구간</th>
                    <th>좌석 수</th>
                    <th>점유 좌석·분</th>
                    <th>전체 좌석·분</th>
                    <th>점유율</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.bucketStart}>
                      <th scope="row">{item.label}</th>
                      <td>{item.seatCount}</td>
                      <td>{item.occupiedSeatMinutes}</td>
                      <td>{item.capacitySeatMinutes}</td>
                      <td>{formatPercent(item.occupancy.percent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      )}
    </section>
  );
}
