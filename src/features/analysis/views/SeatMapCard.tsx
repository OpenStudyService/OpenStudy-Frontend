/**
 * The seats as the DomainLens result mock-up draws them: numbered tiles, in use (filled), free (light) and blocked
 * (grey), with the legend below. The counts are the result's KPI cards; `summary` stays for older callers.
 */
export function SeatMapCard({
  seats,
}: {
  seats: Record<string, unknown>[];
  summary?: Record<string, unknown> | null;
}) {
  const tiles = seats.map((s, idx) => {
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
      seatNo: String(s.seat_no ?? s.seatNo ?? idx + 1),
      state,
    };
  });
  const label = {
    OCCUPIED: "이용 중",
    AVAILABLE: "비어 있음",
    BLOCKED: "차단",
  };

  return (
    <div
      className="grid gap-3"
      data-testid="viewspec-seat-map"
      role="region"
      aria-label="실시간 좌석 배치도 및 가용 현황"
    >
      <ul className="seat-grid" aria-label="좌석 목록">
        {tiles.map((tile) => (
          <li
            key={tile.seatId}
            className={`seat-tile seat-${tile.state.toLowerCase()}`}
            title={`${tile.seatNo}번 · ${label[tile.state]}`}
          >
            <span>{tile.seatNo}</span>
            <span className="sr-only"> {label[tile.state]}</span>
          </li>
        ))}
      </ul>
      <p className="heat-legend">
        <span>
          <i className="heat-swatch seat-occupied" aria-hidden />
          이용 중
        </span>
        <span>
          <i className="heat-swatch seat-available" aria-hidden />
          비어 있음
        </span>
        {tiles.some((tile) => tile.state === "BLOCKED") && (
          <span>
            <i className="heat-swatch seat-blocked" aria-hidden />
            차단
          </span>
        )}
      </p>
    </div>
  );
}
