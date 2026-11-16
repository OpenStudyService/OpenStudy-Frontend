import { useState, type ReactNode } from "react";
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
import { formatDateTime } from "../../shared/domain/format";
import { Button } from "../../shared/ui/primitives";
import { ChartExport } from "./ChartExport";
import {
  layoutOf,
  normalizeComponentType,
  type ParsedAiResult,
  type ViewLayoutNode,
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
                  {column.label ?? column.alias}
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

/**
 * One ViewSpec component drawn from its dataset: the bindings name the columns, the rows are the data. With
 * `withTable` a chart also lists its rows below it; an assembled result shows that table in its own panel instead.
 */
export function ComponentView({
  component,
  dataset,
  scope,
  exportConditions,
  asOf,
  withTable = true,
}: {
  component: ViewSpecComponentDto;
  dataset: TypedDatasetDto;
  scope: string;
  exportConditions?: string[];
  asOf?: string | null;
  withTable?: boolean;
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
        <dl className="result-kpis">
          {dataset.rows.flatMap((row, index) =>
            fields.map((column) => (
              <div key={`${index}:${column.alias}`} className="result-kpi">
                <dt>
                  {KPI_LABELS[column.alias] ?? column.label ?? column.alias}
                </dt>
                <dd>{cellText(row[column.alias], column.unit)}</dd>
              </div>
            )),
          )}
        </dl>
        {withTable && table}
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
          <ChartExport
            metadata={
              exportConditions && asOf
                ? {
                    title,
                    conditions: exportConditions,
                    unit:
                      metric.unit === "KRW"
                        ? "원 (KRW)"
                        : metric.unit || "단위 없음",
                    asOf: `${formatDateTime(asOf)} · Asia/Seoul`,
                  }
                : undefined
            }
          >
            <ResponsiveContainer width="100%" height={220}>
              <Chart data={displayed} accessibilityLayer>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="category" />
                <YAxis />
                <Tooltip />
                {type === "LINE_CHART" ? (
                  <Line
                    dataKey="value"
                    name={metric.label ?? metric.alias}
                    stroke="var(--primary)"
                    isAnimationActive={false}
                  />
                ) : (
                  <Bar
                    dataKey="value"
                    name={metric.label ?? metric.alias}
                    fill="var(--primary)"
                    isAnimationActive={false}
                  />
                )}
              </Chart>
            </ResponsiveContainer>
          </ChartExport>
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
          {withTable && (
            <DomainDataTable dataset={{ ...dataset, rows: ordered }} />
          )}
        </>
      );
    }
    case "HEATMAP":
      // The bindings name the weekday axis (category), the hour axis (series) and the rate (value): the registered
      // analysis binds its own column names, a generated query its aliases (d0, d1, m0).
      if (
        typeof category !== "string" ||
        typeof series !== "string" ||
        typeof value !== "string" ||
        dataset.rows.some((row) =>
          [category, series, value].some(
            (field) => typeof row[field] !== "number",
          ),
        )
      )
        return invalid;
      chart = (
        <CongestionHeatmap
          rows={dataset.rows.map((row) => ({
            ...row,
            weekday: row[category],
            hour_kst: row[series],
            sampled_occupancy_pct: row[value],
          }))}
        />
      );
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
      {withTable && table}
    </>
  );
}

const PANEL_TITLES: Record<string, string> = {
  BAR_CHART: "막대 차트",
  LINE_CHART: "추이",
  RANKED_BAR_CHART: "순위",
  HEATMAP: "히트맵",
  SEAT_MAP: "좌석 배치",
  WEEK_CALENDAR: "주간 예약",
  TASK_LIST: "업무 목록",
  DATA_TABLE: "상세 표",
};

const TYPE_BADGES: Record<string, string> = {
  BAR_CHART: "BAR",
  LINE_CHART: "LINE",
  RANKED_BAR_CHART: "RANKING",
  HEATMAP: "HEATMAP",
  SEAT_MAP: "SEAT MAP",
  WEEK_CALENDAR: "WEEK CALENDAR",
  TASK_LIST: "LIST",
  DATA_TABLE: "TABLE",
  KPI: "KPI",
};

/** The components a result can draw: catalog types of version 1.0.0 without interaction events. */
export function drawableComponents(parsed: ParsedAiResult) {
  return (
    parsed.viewSpec?.components.filter(
      (component) =>
        normalizeComponentType(component.componentRef.id) &&
        component.componentRef.version === "1.0.0" &&
        component.events.length === 0,
    ) ?? []
  );
}

/** "BAR + TABLE": the result's visual types as the mock-up's badge shows them; KPI only when it is alone. */
export function resultBadge(parsed: ParsedAiResult) {
  const types = [
    ...new Set(drawableComponents(parsed).map((c) => c.componentRef.id)),
  ];
  const shown = types.filter((type) => type !== "KPI");
  return (shown.length ? shown : types)
    .map((t) => TYPE_BADGES[t] ?? t)
    .join(" + ");
}

/** The server-paged, sortable table of one dataset, opened from the panel that lists that dataset's rows. */
export interface DetailTable {
  /** The dataset whose detail table is open, if any. */
  datasetId?: string;
  open: (datasetId: string) => void;
  close: () => void;
  render: (dataset: TypedDatasetDto) => ReactNode;
}

/**
 * The result assembled by its ViewSpec layout, as the DomainLens mock-up does: a stack of bands, a split of a chart
 * (wider) and its table, a grid of cards. Each component is drawn from its dataset by its bindings; the KPI cards
 * stand on their own, every other component sits in a titled panel. The panel that lists a dataset's rows (its table,
 * or a chart no table accompanies) can open that dataset's detail table.
 */
export function ViewSpecRenderer({
  parsed,
  scope = "all",
  exportConditions,
  detail,
}: {
  parsed: ParsedAiResult;
  scope?: string;
  exportConditions?: string[];
  detail?: DetailTable;
}) {
  const spec = parsed.viewSpec;
  const components = drawableComponents(parsed);
  if (spec?.catalogVersion !== "openstudy-ui-1.0.0" || !components.length) {
    return <p role="alert">지원하는 결과 표시 명세가 없어요.</p>;
  }
  const byId = new Map(components.map((c) => [c.id, c]));
  const layout = layoutOf(
    spec,
    components.map((c) => c.id),
  );
  // A chart whose rows no table component lists keeps its own table, so every figure stays readable as text.
  const tabled = new Set(
    components
      .filter((c) => c.componentRef.id === "DATA_TABLE")
      .map((c) => c.datasetId),
  );
  return <div className="result-layout">{node(layout, "root")}</div>;

  function node(item: ViewLayoutNode, key: string): ReactNode {
    if ("componentId" in item) {
      const component = byId.get(item.componentId);
      return component ? leaf(component) : null;
    }
    return (
      <div key={key} className={`result-${item.kind}`} data-layout={item.kind}>
        {item.children.map((child, index) => node(child, `${key}.${index}`))}
      </div>
    );
  }

  function leaf(component: ViewSpecComponentDto) {
    const type = component.componentRef.id;
    const dataset = parsed.datasetList.find(
      (d) => d.id === component.datasetId,
    );
    const view = (withTable: boolean) =>
      dataset ? (
        <ComponentView
          component={component}
          dataset={dataset}
          scope={scope}
          exportConditions={exportConditions}
          asOf={dataset.asOf ?? parsed.asOf}
          withTable={withTable}
        />
      ) : (
        <p role="alert">표시할 데이터가 없어요.</p>
      );
    if (type === "KPI") {
      return (
        <section key={component.id} aria-label="요약 지표">
          {view(false)}
        </section>
      );
    }
    const title =
      typeof component.options.title === "string"
        ? component.options.title
        : (PANEL_TITLES[type] ?? "결과");
    const isTable = type === "DATA_TABLE";
    const listsRows = !!dataset && (isTable || !tabled.has(dataset.id));
    const open = listsRows && !!detail && detail.datasetId === dataset.id;
    const body = open ? (
      <>
        {!isTable && view(false)}
        {detail.render(dataset)}
      </>
    ) : (
      view(listsRows)
    );
    return (
      <section key={component.id} className="result-panel" aria-label={title}>
        <header className="result-panel-head">
          <h4>{title}</h4>
          {dataset && isTable && (
            <span>{dataset.rows.length.toLocaleString("ko-KR")}행</span>
          )}
        </header>
        <div className="result-panel-body">
          {body}
          {listsRows && detail && (
            <Button
              type="button"
              aria-label={`${title} ${open ? "간단히 보기" : "전체 표 보기"}`}
              onClick={() => (open ? detail.close() : detail.open(dataset.id))}
            >
              {open ? "간단히 보기" : "전체 표 보기"}
            </Button>
          )}
        </div>
      </section>
    );
  }
}
