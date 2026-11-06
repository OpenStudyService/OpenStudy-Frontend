import { won } from "../../../shared/domain/schema";

export function RoomWeekCalendar({
  branchSummaries,
  reservations,
}: {
  branchSummaries: Record<string, unknown>[];
  reservations: Record<string, unknown>[];
}) {
  const summaries = branchSummaries.map((b) => ({
    branchId: String(b.branch_id ?? b.branchId ?? ""),
    branchName: String(b.branch_name ?? b.branchName ?? "지점"),
    total: Number(b.total ?? 0),
    confirmed: Number(b.confirmed_count ?? b.confirmedCount ?? 0),
    completed: Number(b.completed_count ?? b.completedCount ?? 0),
    cancelled: Number(b.cancelled_count ?? b.cancelledCount ?? 0),
    billableKrw: Number(
      b.billable_booking_amount_krw ?? b.billableBookingAmountKrw ?? 0,
    ),
  }));

  const items = reservations.map((r, idx) => ({
    id: String(r.reservation_id ?? r.id ?? idx + 1),
    branchName: String(r.branch_name ?? r.branchName ?? ""),
    roomName: String(r.room_name ?? r.roomName ?? "Room"),
    startAt: String(r.start_at ?? r.startAt ?? ""),
    endAt: String(r.end_at ?? r.endAt ?? ""),
    status: String(r.status ?? "CONFIRMED"),
    amountKrw: Number(r.billable_amount_krw ?? r.billableAmountKrw ?? 0),
  }));

  return (
    <div
      className="flex flex-col gap-4"
      data-testid="viewspec-week-calendar"
      role="region"
      aria-label="주간 스터디룸 예약 현황 캘린더"
    >
      {summaries.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {summaries.map((s) => (
            <div
              key={s.branchId || s.branchName}
              className="rounded-xl border border-line bg-surface p-4"
            >
              <div className="flex items-center justify-between">
                <strong className="text-sm text-ink">{s.branchName}</strong>
                <span className="rounded-md bg-soft px-2 py-0.5 text-xs font-semibold text-primary">
                  총 {s.total}건
                </span>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
                <div className="rounded-lg bg-soft p-2">
                  <div className="text-[10px] text-muted">확정</div>
                  <div className="font-bold text-ink">{s.confirmed}건</div>
                </div>
                <div className="rounded-lg bg-soft p-2">
                  <div className="text-[10px] text-muted">완료</div>
                  <div className="font-bold text-ink">{s.completed}건</div>
                </div>
                <div className="rounded-lg bg-soft p-2">
                  <div className="text-[10px] text-muted">취소</div>
                  <div className="font-bold text-muted">{s.cancelled}건</div>
                </div>
                <div className="rounded-lg bg-soft p-2">
                  <div className="text-[10px] text-muted">유효 예약 금액</div>
                  <div className="font-bold text-primary">
                    {won(s.billableKrw)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="data-table">
          <thead>
            <tr>
              <th>예약번호</th>
              <th>지점</th>
              <th>스터디룸</th>
              <th>시작 시각</th>
              <th>종료 시각</th>
              <th>상태</th>
              <th>유효 금액</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const badgeClass =
                item.status === "CONFIRMED"
                  ? "bg-emerald-500/15 text-emerald-800"
                  : item.status === "COMPLETED"
                    ? "bg-primary/15 text-primary"
                    : "bg-line text-muted line-through";
              return (
                <tr key={item.id}>
                  <td className="font-mono text-xs">#{item.id}</td>
                  <td>{item.branchName}</td>
                  <td className="font-semibold">{item.roomName}</td>
                  <td className="text-xs">
                    {item.startAt.replace("T", " ").slice(0, 16)}
                  </td>
                  <td className="text-xs">
                    {item.endAt.replace("T", " ").slice(0, 16)}
                  </td>
                  <td>
                    <span
                      className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold ${badgeClass}`}
                    >
                      {item.status}
                    </span>
                  </td>
                  <td className="font-semibold">{won(item.amountKrw)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
