import { useState } from "react";
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
import {
  normalizeComponentType,
  toViewMode,
  type ParsedAiResult,
  type TypedDatasetDto,
  type ViewSpecComponentDto,
} from "./domainlens";
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
  rows: { label: string; value: number | null }[];
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
            dot={rows.filter((row) => row.value !== null).length === 1}
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

function cellText(value: unknown, unit?: string | null) {
  if (value == null) return "해당 없음";
  return unit === "KRW" && typeof value === "number"
    ? won(value)
    : String(value);
}

type TableSort = { alias: string; desc: boolean };

export function DomainDataTable({
  dataset,
  serverSort,
}: {
  dataset: TypedDatasetDto;
  serverSort?: { value?: TableSort; onChange: (sort: TableSort) => void };
}) {
  const [page, setPage] = useState(0);
  const [localSort, setLocalSort] = useState<TableSort>();
  const sort = serverSort ? serverSort.value : localSort;
  const rows =
    sort && !serverSort
      ? [...dataset.rows].sort((a, b) => {
          const left = a[sort.alias];
          const right = b[sort.alias];
          if (left == null || right == null)
            return Number(left == null) - Number(right == null);
          const cmp =
            typeof left === "number" && typeof right === "number"
              ? left - right
              : String(left).localeCompare(String(right), "ko", {
                  numeric: true,
                });
          return sort.desc ? -cmp : cmp;
        })
      : dataset.rows;
  const pageSize = 50;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pages - 1);

  return (
    <div className="data-scroll" data-testid="viewspec-data-table">
      <table className="data-table">
        <caption className="sr-only">결과 데이터 표</caption>
        <thead>
          <tr>
            {dataset.columns.map((column) => (
              <th
                key={column.alias}
                scope="col"
                aria-sort={
                  sort?.alias === column.alias
                    ? sort.desc
                      ? "descending"
                      : "ascending"
                    : undefined
                }
              >
                <button
                  type="button"
                  onClick={() => {
                    const next = {
                      alias: column.alias,
                      desc:
                        sort?.alias === column.alias
                          ? !sort.desc
                          : Boolean(serverSort),
                    };
                    if (serverSort) serverSort.onChange(next);
                    else {
                      setLocalSort(next);
                      setPage(0);
                    }
                  }}
                >
                  {column.alias}
                  {column.unit ? ` (${column.unit})` : ""}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows
            .slice(
              serverSort ? 0 : current * pageSize,
              serverSort ? undefined : (current + 1) * pageSize,
            )
            .map((row, idx) => (
              <tr key={idx}>
                {dataset.columns.map((c) => (
                  <td key={c.alias}>{cellText(row[c.alias], c.unit)}</td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
      {!serverSort && pages > 1 && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!current}
            onClick={() => setPage(current - 1)}
          >
            이전 페이지
          </button>
          <span>
            {current + 1} / {pages}
          </span>
          <button
            type="button"
            disabled={current + 1 >= pages}
            onClick={() => setPage(current + 1)}
          >
            다음 페이지
          </button>
        </div>
      )}
    </div>
  );
}

function matchesType(value: unknown, type: string): boolean {
  if (value === null) return true;
  switch (type) {
    case "INTEGER":
      return Number.isInteger(value);
    case "DECIMAL":
      return typeof value === "number" && Number.isFinite(value);
    case "BOOLEAN":
      return typeof value === "boolean";
    case "DATE":
    case "TIMESTAMP":
      return typeof value === "string" && Number.isFinite(Date.parse(value));
    case "STRING":
      return typeof value === "string";
    default:
      return false;
  }
}

function boundFields(
  component: ViewSpecComponentDto,
  dataset: TypedDatasetDto,
) {
  const values = Object.values(component.bindings).flat();
  if (!values.length) return null;
  const fields = values.flatMap((value) => {
    const column = dataset.columns.find((c) => c.alias === value);
    return column &&
      dataset.rows.every((row) => matchesType(row[column.alias], column.type))
      ? [column]
      : [];
  });
  return fields.length === values.length ? fields : null;
}

const KPI_LABELS: Record<string, string> = {
  net_krw: "순매출",
  approved_krw: "승인 결제액",
  refund_krw: "환불액",
};

function ComponentView({
  component,
  dataset,
  scope,
}: {
  component: ViewSpecComponentDto;
  dataset: TypedDatasetDto;
  scope: string;
}) {
  const type = component.componentRef.id;
  const fields = boundFields(component, dataset);
  const { category, value, series, columns, values } = component.bindings;
  const hasFields = (...aliases: string[]) =>
    aliases.every((alias) => fields?.some((f) => f.alias === alias));
  const table = <DomainDataTable dataset={dataset} />;
  const invalid = (
    <>
      <p role="status">표시 명세와 데이터가 일치하지 않아 표로 표시해요.</p>
      {table}
    </>
  );
  if (!dataset.rows.length) return <p>결과 없음</p>;
  if (!fields) return invalid;
  if (type === "DATA_TABLE") {
    return Array.isArray(columns) ? (
      <DomainDataTable dataset={{ ...dataset, columns: fields }} />
    ) : (
      invalid
    );
  }
  if (type === "KPI") {
    if (!Array.isArray(values)) return invalid;
    return (
      <>
        <dl className="mb-4 flex flex-wrap gap-2 text-xs">
          {dataset.rows.flatMap((row, index) =>
            fields.map((column) => (
              <div
                key={`${index}:${column.alias}`}
                className="rounded-lg bg-soft p-3"
              >
                <dt>{KPI_LABELS[column.alias] ?? column.alias}</dt>
                <dd className="m-0 mt-1 text-base font-semibold">
                  {cellText(row[column.alias], column.unit)}
                </dd>
              </div>
            )),
          )}
        </dl>
        {table}
      </>
    );
  }

  let chart;
  switch (type) {
    case "BAR_CHART":
    case "LINE_CHART": {
      if (typeof category !== "string" || typeof value !== "string")
        return invalid;
      const metric = fields.find((column) => column.alias === value);
      if (
        !metric ||
        !["INTEGER", "DECIMAL"].includes(metric.type) ||
        (type === "LINE_CHART" &&
          dataset.rows.some(
            (row) =>
              typeof row[category] !== "string" ||
              !Number.isFinite(Date.parse(row[category])),
          ))
      )
        return invalid;
      const ordered =
        type === "LINE_CHART"
          ? [...dataset.rows].sort(
              (a, b) =>
                Date.parse(String(a[category])) -
                Date.parse(String(b[category])),
            )
          : dataset.rows;
      const displayed = ordered.slice(0, 20).map((row) => ({
        category: row[category],
        value: row[value],
      }));
      const title =
        typeof component.options.title === "string"
          ? component.options.title
          : "결과 차트";
      const Chart = type === "LINE_CHART" ? LineChart : BarChart;
      chart = (
        <>
          <p className="sr-only">
            {title}.{" "}
            {displayed
              .map(
                (row) =>
                  `${cellText(row.category)} ${cellText(row.value, metric.unit)}`,
              )
              .join(", ")}
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <Chart data={displayed} accessibilityLayer>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="category" />
              <YAxis />
              <Tooltip />
              {type === "LINE_CHART" ? (
                <Line
                  dataKey="value"
                  name={metric.alias}
                  stroke="var(--primary)"
                />
              ) : (
                <Bar
                  dataKey="value"
                  name={metric.alias}
                  fill="var(--primary)"
                />
              )}
            </Chart>
          </ResponsiveContainer>
          {ordered.length > 20 && (
            <p className="help">
              차트에 20개 항목을 표시해요. 전체 조회 행은 표에서 볼 수 있어요.
            </p>
          )}
        </>
      );
      return (
        <>
          {chart}
          <DomainDataTable dataset={{ ...dataset, rows: ordered }} />
        </>
      );
    }
    case "HEATMAP":
      if (
        category !== "weekday" ||
        series !== "hour_kst" ||
        value !== "sampled_occupancy_pct" ||
        dataset.rows.some((row) =>
          [
            category,
            series,
            value,
            "occupied_seat_samples",
            "seat_sample_capacity",
          ].some((field) => typeof row[field] !== "number"),
        )
      )
        return invalid;
      chart = <CongestionHeatmap rows={dataset.rows} />;
      break;
    case "RANKED_BAR_CHART":
      if (
        category !== "product" ||
        value !== "net_units" ||
        dataset.rows.some((row) => typeof row.net_units !== "number")
      )
        return invalid;
      chart = <RankedBarChart rows={dataset.rows.slice(0, 20)} />;
      break;
    case "SEAT_MAP":
      if (!hasFields("seat_id", "seat_no", "occupancy_state")) return invalid;
      chart = <SeatMapCard seats={dataset.rows} summary={null} />;
      break;
    case "WEEK_CALENDAR":
      if (
        !hasFields(
          "reservation_id",
          "room_name",
          "start_at",
          "end_at",
          "status",
        )
      )
        return invalid;
      chart = (
        <RoomWeekCalendar branchSummaries={[]} reservations={dataset.rows} />
      );
      break;
    case "TASK_LIST":
      if (
        !hasFields("id", "title", "branch_name", "priority", "status", "due_at")
      )
        return invalid;
      chart = <UrgentTaskList rows={dataset.rows} scope={scope} />;
      break;
  }
  return (
    <>
      {chart}
      {type === "RANKED_BAR_CHART" && dataset.rows.length > 20 && (
        <p>차트에 상위 20개 항목을 표시해요.</p>
      )}
      {table}
    </>
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
  const spec = parsed.viewSpec;
  const components =
    spec?.components.filter(
      (component) =>
        normalizeComponentType(component.componentRef.id) &&
        component.componentRef.version === "1.0.0" &&
        component.events.length === 0,
    ) ?? [];
  const mode = activeView ?? toViewMode(parsed.primaryComponent);
  const selected = components.filter((component) => {
    const type = normalizeComponentType(component.componentRef.id);
    return type && toViewMode(type) === mode;
  });
  if (spec?.catalogVersion !== "openstudy-ui-1.0.0" || !components.length) {
    return <p role="alert">지원하는 결과 표시 명세가 없어요.</p>;
  }
  if (mode === "table") {
    const displayed = new Set(selected.map((component) => component.datasetId));
    const primary = components.find(
      (component) => component.componentRef.id === parsed.primaryComponent,
    );
    return (
      <>
        {selected.map((component) => renderComponent(component))}
        {primary &&
          !displayed.has(primary.datasetId) &&
          renderComponent(primary, true)}
      </>
    );
  }
  return (
    <>
      {components
        .filter(
          (component) => component.componentRef.id === "KPI" && mode !== "kpi",
        )
        .map((component) => renderComponent(component))}
      {selected.length ? (
        selected.map((component) => renderComponent(component))
      ) : (
        <p role="alert">이 결과 화면은 표시할 수 없어요.</p>
      )}
    </>
  );

  function renderComponent(component: ViewSpecComponentDto, tableOnly = false) {
    const dataset = parsed.datasetList.find(
      (d) => d.id === component.datasetId,
    );
    return (
      <section className="mb-4 grid gap-2" key={component.id}>
        {typeof component.options.title === "string" && (
          <h4>{component.options.title}</h4>
        )}
        {!dataset ? (
          <p role="alert">표시할 데이터가 없어요.</p>
        ) : tableOnly ? (
          <DomainDataTable dataset={dataset} />
        ) : (
          <ComponentView
            component={component}
            dataset={dataset}
            scope={scope}
          />
        )}
      </section>
    );
  }
}
