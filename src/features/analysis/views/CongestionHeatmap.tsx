export interface HeatmapCellRow {
  weekday: number;
  hour_kst?: number;
  hourKst?: number;
  occupied_seat_samples?: number;
  occupiedSeatSamples?: number;
  seat_sample_capacity?: number;
  seatSampleCapacity?: number;
  sampled_occupancy_pct?: number;
  sampledOccupancyPct?: number;
}

const WEEKDAY_LABELS: Record<number, string> = {
  1: "월",
  2: "화",
  3: "수",
  4: "목",
  5: "금",
  6: "토",
  7: "일",
};

const SAMPLED_HOURS = [9, 12, 15, 18, 21];

/** The mock-up's five steps, from spare to very crowded. */
const LEVELS = [
  { label: "여유", min: 0, className: "heat-0" },
  { label: "보통", min: 40, className: "heat-1" },
  { label: "주의", min: 55, className: "heat-2" },
  { label: "혼잡", min: 70, className: "heat-3" },
  { label: "매우 혼잡", min: 80, className: "heat-4" },
];

function level(pct: number) {
  return [...LEVELS].reverse().find((step) => pct >= step.min) ?? LEVELS[0];
}

/**
 * Seat occupancy by weekday (columns) and sampled hour (rows), as the DomainLens result mock-up draws it: five colour
 * steps, the peak cell outlined, the legend below. Seat counts show in the cell's title when the result carries them.
 */
export function CongestionHeatmap({
  rows,
  branchName = "",
}: {
  rows: Record<string, unknown>[];
  branchName?: string;
}) {
  const count = (value: unknown) =>
    typeof value === "number" ? value : undefined;
  const cells = rows.map((r) => ({
    weekday: Number(r.weekday ?? 1),
    hour: Number(r.hour_kst ?? r.hourKst ?? 9),
    occupied: count(r.occupied_seat_samples ?? r.occupiedSeatSamples),
    capacity: count(r.seat_sample_capacity ?? r.seatSampleCapacity),
    pct: Number(r.sampled_occupancy_pct ?? r.sampledOccupancyPct ?? 0),
  }));
  const maxPct = cells.reduce((acc, c) => Math.max(acc, c.pct), 0);
  const byCell = new Map(cells.map((c) => [`${c.weekday}:${c.hour}`, c]));
  const hours = [
    ...new Set([...SAMPLED_HOURS, ...cells.map((c) => c.hour)]),
  ].sort((a, b) => a - b);

  return (
    <div
      className="grid gap-3"
      data-testid="viewspec-heatmap"
      role="region"
      aria-label={`${branchName ? `${branchName} ` : ""}요일·시간대별 좌석 혼잡도 히트맵`}
    >
      <div className="overflow-x-auto">
        <table className="heatmap-table">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">시간 \ 요일</span>
              </th>
              {[1, 2, 3, 4, 5, 6, 7].map((wd) => (
                <th key={wd} scope="col">
                  {WEEKDAY_LABELS[wd]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hours.map((hr) => (
              <tr key={hr}>
                <th scope="row">{hr}시</th>
                {[1, 2, 3, 4, 5, 6, 7].map((wd) => {
                  const cell = byCell.get(`${wd}:${hr}`);
                  if (!cell)
                    return (
                      <td key={wd}>
                        <span className="heat-cell heat-none">-</span>
                      </td>
                    );
                  const peak = maxPct > 0 && Math.abs(cell.pct - maxPct) < 0.05;
                  const seats =
                    cell.occupied !== undefined && cell.capacity !== undefined
                      ? `${cell.occupied}/${cell.capacity}석 `
                      : "";
                  return (
                    <td key={wd}>
                      <span
                        className={`heat-cell ${level(cell.pct).className} ${peak ? "heat-peak" : ""}`}
                        title={`${WEEKDAY_LABELS[wd]}요일 ${hr}시: ${seats}(${cell.pct.toFixed(1)}%)`}
                      >
                        {cell.pct.toFixed(0)}%
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="heat-legend" aria-label="혼잡도 단계">
        {LEVELS.map((step) => (
          <span key={step.label}>
            <i className={`heat-swatch ${step.className}`} aria-hidden />
            {step.label}
          </span>
        ))}
        {maxPct > 0 && (
          <span className="sr-only">
            가장 혼잡한 시간대{" "}
            {cells
              .filter((c) => Math.abs(c.pct - maxPct) < 0.05)
              .map(
                (c) =>
                  `${WEEKDAY_LABELS[c.weekday] || c.weekday}요일 ${c.hour}시 (${c.pct.toFixed(1)}%)`,
              )
              .join(", ")}
          </span>
        )}
      </p>
    </div>
  );
}
