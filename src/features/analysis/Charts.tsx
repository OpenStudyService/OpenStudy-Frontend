import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { won } from "../../shared/domain/schema";
import type { ParsedAiResult, TypedDatasetDto } from "./domainlens";
import { CongestionHeatmap } from "./views/CongestionHeatmap";
import { RankedBarChart } from "./views/RankedBarChart";
import { SeatMapCard } from "./views/SeatMapCard";
import { RoomWeekCalendar } from "./views/RoomWeekCalendar";
import { UrgentTaskList } from "./views/UrgentTaskList";

export {
  CongestionHeatmap,
  RankedBarChart,
  SeatMapCard,
  RoomWeekCalendar,
  UrgentTaskList,
};

export interface SalesRow {
  branchId: string;
  branch: string;
  approved: number;
  refunds: number;
  net: number;
}
export function SalesChart({
  rows,
  kind = "bar",
}: {
  rows: SalesRow[];
  kind?: "bar" | "line";
}) {
  return (
    <div
      className="h-[280px] min-w-0 w-full"
      role="img"
      aria-label={`지점별 순매출 ${kind === "bar" ? "막대" : "선"} 차트. 자세한 수치는 아래 표에서 확인할 수 있습니다.`}
    >
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        {kind === "bar" ? (
          <BarChart
            data={rows}
            margin={{ left: 10, right: 20, top: 15, bottom: 10 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="var(--line)"
            />
            <XAxis
              dataKey="branch"
              tick={{ fill: "var(--muted)", fontSize: 12 }}
            />
            <YAxis
              tick={{ fill: "var(--muted)", fontSize: 10 }}
              tickFormatter={(v) => `${Number(v) / 10000}만`}
            />
            <Tooltip
              formatter={(v) => won(Number(v))}
              contentStyle={{
                borderColor: "var(--line)",
                borderRadius: 10,
                fontSize: 12,
              }}
            />
            <Bar
              dataKey="net"
              name="순매출"
              fill="var(--primary)"
              radius={[6, 6, 0, 0]}
              maxBarSize={80}
              isAnimationActive={false}
            />
          </BarChart>
        ) : (
          <LineChart
            data={rows}
            margin={{ left: 10, right: 20, top: 15, bottom: 10 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
            <XAxis dataKey="branch" />
            <YAxis tickFormatter={(v) => `${Number(v) / 10000}만`} />
            <Tooltip formatter={(v) => won(Number(v))} />
            <Line
              dataKey="net"
              name="순매출"
              stroke="var(--primary)"
              strokeWidth={3}
              isAnimationActive={false}
            />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
export function SalesTrendChart({
  rows,
  label,
  format,
}: {
  rows: { label: string; value: number }[];
  label: string;
  format: (value: number) => string;
}) {
  return (
    <div
      className="h-[280px] min-w-0 w-full"
      role="img"
      aria-label={`${label} 추세 차트`}
    >
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <LineChart
          data={rows}
          margin={{ left: 10, right: 20, top: 15, bottom: 10 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
          <XAxis dataKey="label" minTickGap={30} />
          <YAxis tickFormatter={format} width={100} />
          <Tooltip formatter={(value) => format(Number(value))} />
          <Line
            dataKey="value"
            name={label}
            stroke="var(--primary)"
            strokeWidth={3}
            dot={rows.length === 1}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SalesTable({ rows }: { rows: SalesRow[] }) {
  return (
    <div className="data-scroll">
      <table className="data-table">
        <caption className="sr-only">지점별 매출 상세 금액, 원 단위</caption>
        <thead>
          <tr>
            <th>지점</th>
            <th>승인 결제액</th>
            <th>환불액</th>
            <th>순매출</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.branchId}>
              <th className="px-5 py-4 text-left font-medium">{r.branch}</th>
              <td>{won(r.approved)}</td>
              <td>{won(r.refunds)}</td>
              <td className="font-semibold text-primary">{won(r.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DomainDataTable({ dataset }: { dataset: TypedDatasetDto }) {
  const columns =
    dataset.columns.length > 0
      ? dataset.columns
      : Object.keys(dataset.rows[0] || {}).map((alias) => ({
          alias,
          type: "STRING",
          unit: null,
          precision: null,
        }));

  return (
    <div className="data-scroll" data-testid="viewspec-data-table">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.alias}>
                {c.alias}
                {c.unit ? ` (${c.unit})` : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataset.rows.map((row, idx) => (
            <tr key={idx}>
              {columns.map((c) => {
                const val = row[c.alias];
                const formatted =
                  c.unit === "KRW" && typeof val === "number"
                    ? won(val)
                    : val === null || val === undefined
                      ? "-"
                      : String(val);
                return <td key={c.alias}>{formatted}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ViewSpecRenderer({
  parsed,
  activeView,
  scope = "all",
}: {
  parsed: ParsedAiResult;
  activeView?: string;
  scope?: string;
}) {
  const comp = (activeView || parsed.primaryComponent).toUpperCase();

  if (comp === "HEATMAP" || activeView === "heatmap") {
    const rows =
      parsed.datasets.heatmapRows ?? parsed.datasetList[0]?.rows ?? [];
    return <CongestionHeatmap rows={rows} />;
  }

  if (comp === "RANKED_BAR_CHART" || activeView === "ranked_bar") {
    const rows =
      parsed.datasets.topProducts ?? parsed.datasetList[0]?.rows ?? [];
    return <RankedBarChart rows={rows} />;
  }

  if (comp === "SEAT_MAP" || activeView === "seat_map") {
    const seats =
      parsed.datasets.seatMap ??
      parsed.datasetList[1]?.rows ??
      parsed.datasetList[0]?.rows ??
      [];
    const summary =
      parsed.datasets.seatSummary?.[0] ??
      (parsed.summary as Record<string, unknown>) ??
      null;
    return <SeatMapCard seats={seats} summary={summary} />;
  }

  if (comp === "WEEK_CALENDAR" || activeView === "week_calendar") {
    const branchSummaries = parsed.datasets.branchSummaries ?? [];
    const reservations =
      parsed.datasets.reservationRows ?? parsed.datasetList[0]?.rows ?? [];
    return (
      <RoomWeekCalendar
        branchSummaries={branchSummaries}
        reservations={reservations}
      />
    );
  }

  if (comp === "TASK_LIST" || activeView === "task_list") {
    const rows =
      parsed.datasets.urgentTasks ?? parsed.datasetList[0]?.rows ?? [];
    return <UrgentTaskList rows={rows} scope={scope} />;
  }

  if (comp === "DATA_TABLE" || comp === "TABLE" || activeView === "table") {
    if (parsed.datasetList.length > 0) {
      return <DomainDataTable dataset={parsed.datasetList[0]} />;
    }
    return <SalesTable rows={parsed.salesRows} />;
  }

  // Default BAR_CHART / LINE_CHART / KPI
  const kind = comp === "LINE_CHART" || activeView === "line" ? "line" : "bar";
  if (parsed.salesRows.length > 0) {
    return (
      <div className="flex flex-col gap-4">
        <SalesChart rows={parsed.salesRows} kind={kind} />
        <SalesTable rows={parsed.salesRows} />
      </div>
    );
  }
  if (parsed.datasets.dailySales) {
    const dailyRows: SalesRow[] = parsed.datasets.dailySales.map((r, i) => ({
      branchId: String(r.date_kst ?? i),
      branch: String(r.date_kst ?? "").slice(5),
      approved: Number(r.approved_krw ?? 0),
      refunds: Number(r.refund_krw ?? 0),
      net: Number(r.net_krw ?? 0),
    }));
    return (
      <div className="flex flex-col gap-4">
        <SalesChart rows={dailyRows} kind="line" />
        <DomainDataTable dataset={parsed.datasetList[0]} />
      </div>
    );
  }
  if (parsed.datasets.purposeSales) {
    const purposeRows: SalesRow[] = parsed.datasets.purposeSales.map(
      (r, i) => ({
        branchId: String(r.purpose ?? i),
        branch:
          r.purpose === "PASS"
            ? "이용권 (PASS)"
            : r.purpose === "ROOM"
              ? "스터디룸 (ROOM)"
              : r.purpose === "LOCKER"
                ? "사물함 (LOCKER)"
                : String(r.purpose ?? ""),
        approved: Number(r.approved_krw ?? 0),
        refunds: Number(r.refund_krw ?? 0),
        net: Number(r.net_krw ?? 0),
      }),
    );
    return (
      <div className="flex flex-col gap-4">
        <SalesChart rows={purposeRows} kind="bar" />
        <DomainDataTable dataset={parsed.datasetList[0]} />
      </div>
    );
  }
  if (parsed.datasetList.length > 0) {
    return <DomainDataTable dataset={parsed.datasetList[0]} />;
  }
  return <SalesTable rows={parsed.salesRows} />;
}
