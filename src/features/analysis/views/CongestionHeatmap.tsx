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

function cellBackground(pct: number, isPeak: boolean) {
  if (isPeak) {
    return "border-primary bg-primary text-white font-bold shadow-sm";
  }
  if (pct >= 65) {
    return "border-line bg-primary/25 text-ink font-semibold";
  }
  if (pct >= 45) {
    return "border-line bg-primary/15 text-ink";
  }
  if (pct >= 25) {
    return "border-line bg-soft text-ink";
  }
  return "border-line bg-surface text-muted";
}

export function CongestionHeatmap({
  rows,
  branchName = "",
}: {
  rows: Record<string, unknown>[];
  branchName?: string;
}) {
  const normalized = rows.map((r) => ({
    weekday: Number(r.weekday ?? 1),
    hour: Number(r.hour_kst ?? r.hourKst ?? 9),
    occupied: Number(r.occupied_seat_samples ?? r.occupiedSeatSamples ?? 0),
    capacity: Number(r.seat_sample_capacity ?? r.seatSampleCapacity ?? 120),
    pct: Number(r.sampled_occupancy_pct ?? r.sampledOccupancyPct ?? 0),
  }));

  const maxPct = normalized.reduce((acc, c) => Math.max(acc, c.pct), 0);
  const peaks = normalized.filter(
    (c) => maxPct > 0 && Math.abs(c.pct - maxPct) < 0.05,
  );

  const cellMap = new Map<string, (typeof normalized)[number]>();
  for (const c of normalized) {
    cellMap.set(`${c.weekday}:${c.hour}`, c);
  }

  return (
    <div
      className="flex flex-col gap-4"
      data-testid="viewspec-heatmap"
      role="region"
      aria-label={`${branchName ? `${branchName} ` : ""}요일·시간대별 좌석 혼잡도 히트맵`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-soft px-4 py-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-md bg-primary px-2 py-0.5 text-[11px] font-semibold text-white">
            피크 시간대
          </span>
          <span className="font-semibold text-ink">
            {peaks.length > 0
              ? peaks
                  .map(
                    (p) =>
                      `${WEEKDAY_LABELS[p.weekday] || p.weekday}요일 ${p.hour}시 (${p.pct.toFixed(1)}%)`,
                  )
                  .join(", ")
              : "데이터 집계 중"}
          </span>
        </div>
        <span className="text-muted">
          5개 대표 시각(09·12·15·18·21시 KST) 샘플 기준
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-center text-xs">
          <thead>
            <tr>
              <th className="p-2 text-left font-semibold text-muted">
                요일 \ 시간대
              </th>
              {SAMPLED_HOURS.map((hr) => (
                <th key={hr} className="p-2 font-semibold text-muted">
                  {String(hr).padStart(2, "0")}시
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3, 4, 5, 6, 7].map((wd) => (
              <tr key={wd}>
                <th className="p-2 text-left font-semibold text-ink">
                  {WEEKDAY_LABELS[wd]}요일
                </th>
                {SAMPLED_HOURS.map((hr) => {
                  const cell = cellMap.get(`${wd}:${hr}`);
                  const pct = cell ? cell.pct : 0;
                  const isPeak = Boolean(
                    cell && maxPct > 0 && Math.abs(pct - maxPct) < 0.05,
                  );
                  return (
                    <td key={hr} className="p-1">
                      <div
                        className={`rounded-lg border px-2 py-2.5 transition ${cellBackground(pct, isPeak)}`}
                        title={
                          cell
                            ? `${WEEKDAY_LABELS[wd]}요일 ${hr}시: ${cell.occupied}/${cell.capacity}석 (${pct.toFixed(1)}%)`
                            : undefined
                        }
                      >
                        <div className="text-xs">
                          {cell ? `${pct.toFixed(1)}%` : "해당 없음"}
                        </div>
                        {cell && (
                          <div className="text-[10px] opacity-80">
                            {cell.occupied}/{cell.capacity}석
                          </div>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
