export function SeatMapCard({
  seats,
  summary,
}: {
  seats: Record<string, unknown>[];
  summary?: Record<string, unknown> | null;
}) {
  const normalizedSeats = seats.map((s, idx) => {
    const rawState = String(
      s.occupancy_state ?? s.seat_status ?? s.status ?? "AVAILABLE",
    ).toUpperCase();
    const state: "AVAILABLE" | "OCCUPIED" | "BLOCKED" =
      rawState.includes("OCCUPIED") || rawState.includes("사용")
        ? "OCCUPIED"
        : rawState.includes("BLOCK") || rawState.includes("점검")
          ? "BLOCKED"
          : "AVAILABLE";
    return {
      seatId: String(s.seat_id ?? s.id ?? idx + 1),
      seatNo: String(
        s.seat_no ?? s.seatNo ?? `A-${String(idx + 1).padStart(2, "0")}`,
      ),
      state,
    };
  });

  const total = Number(summary?.total ?? (normalizedSeats.length || 24));
  const available = Number(
    summary?.available ??
      normalizedSeats.filter((s) => s.state === "AVAILABLE").length,
  );
  const occupied = Number(
    summary?.occupied ??
      normalizedSeats.filter((s) => s.state === "OCCUPIED").length,
  );
  const blocked = Number(
    summary?.blocked ??
      normalizedSeats.filter((s) => s.state === "BLOCKED").length,
  );
  const occupiedPct = Number(
    summary?.occupied_pct ??
      summary?.occupiedPct ??
      (total > 0 ? Math.round((occupied / total) * 1000) / 10 : 0),
  );

  return (
    <div
      className="flex flex-col gap-4"
      data-testid="viewspec-seat-map"
      role="region"
      aria-label="실시간 좌석 배치도 및 가용 현황"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="rounded-xl border border-line bg-surface p-3">
          <div className="text-[11px] text-muted">전체 좌석</div>
          <div className="mt-1 text-lg font-bold text-ink">{total}석</div>
        </div>
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
          <div className="text-[11px] font-medium text-emerald-700">
            이용 가능 (빈자리)
          </div>
          <div className="mt-1 text-lg font-bold text-emerald-700">
            {available}석
          </div>
        </div>
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
          <div className="text-[11px] font-medium text-amber-800">
            입실 사용 중
          </div>
          <div className="mt-1 text-lg font-bold text-amber-800">
            {occupied}석
          </div>
        </div>
        <div className="rounded-xl border border-line bg-soft p-3">
          <div className="text-[11px] text-muted">점검·차단</div>
          <div className="mt-1 text-lg font-bold text-muted">{blocked}석</div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-3">
          <div className="text-[11px] text-muted">실시간 점유율</div>
          <div className="mt-1 text-lg font-bold text-primary">
            {occupiedPct.toFixed(1)}%
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-ink">
          좌석 그리드 ({normalizedSeats.length}석)
        </span>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            이용 가능 ({available})
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
            사용 중 ({occupied})
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
            점검·차단 ({blocked})
          </span>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
        {normalizedSeats.map((seat) => {
          const style =
            seat.state === "AVAILABLE"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-900"
              : seat.state === "OCCUPIED"
                ? "border-amber-500/40 bg-amber-500/15 text-amber-900"
                : "border-line bg-soft text-muted line-through";
          const label =
            seat.state === "AVAILABLE"
              ? "빈자리"
              : seat.state === "OCCUPIED"
                ? "사용 중"
                : "점검";
          return (
            <div
              key={seat.seatId}
              className={`flex flex-col items-center justify-center rounded-xl border p-2.5 text-center ${style}`}
            >
              <strong className="text-xs">{seat.seatNo}</strong>
              <span className="mt-0.5 text-[10px] font-medium">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
