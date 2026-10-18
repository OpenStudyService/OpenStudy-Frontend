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
