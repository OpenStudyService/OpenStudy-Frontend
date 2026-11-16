import { useState } from "react";

const KST_DAY = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const KST_TIME = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const STATUS: Record<string, string> = {
  CONFIRMED: "확정",
  COMPLETED: "이용 완료",
  CANCELLED: "취소",
  CANCELED: "취소",
};

/** "2026-11-02" plus n days, as a calendar date (no time zone involved). */
function addDays(day: string, n: number) {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + n);
  return at.toISOString().slice(0, 10);
}

/**
 * The week's study-room bookings as the DomainLens result mock-up shows them: seven day tiles with their counts, and
 * the chosen day's bookings listed by time below. The week starts on the Monday of the earliest booking.
 */
export function RoomWeekCalendar({
  reservations,
}: {
  branchSummaries?: Record<string, unknown>[];
  reservations: Record<string, unknown>[];
}) {
  const items = reservations
    .map((r, idx) => {
      const start = Date.parse(String(r.start_at ?? r.startAt ?? ""));
      const end = Date.parse(String(r.end_at ?? r.endAt ?? ""));
      return {
        id: String(r.reservation_id ?? r.id ?? idx + 1),
        branchName: String(r.branch_name ?? r.branchName ?? ""),
        roomName: String(r.room_name ?? r.roomName ?? "스터디룸"),
        start,
        end,
        day: Number.isFinite(start) ? KST_DAY.format(start) : "",
        status: String(r.status ?? "CONFIRMED").toUpperCase(),
      };
    })
    .filter((item) => item.day)
    .sort((a, b) => a.start - b.start);
  // Without bookings there is no week to anchor; any Monday will do, every tile then shows 0건.
  const first = items[0]?.day ?? "2026-11-02";
  const weekday = new Date(`${first}T00:00:00Z`).getUTCDay();
  const monday = addDays(first, -((weekday + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const counts = new Map(
    days.map((day) => [day, items.filter((item) => item.day === day).length]),
  );
  const [selected, setSelected] = useState(
    days.find((day) => (counts.get(day) ?? 0) > 0) ?? days[0],
  );
  const agenda = items.filter((item) => item.day === selected);

  return (
    <div
      className="grid gap-3"
      data-testid="viewspec-week-calendar"
      role="region"
      aria-label="주간 스터디룸 예약 현황 캘린더"
    >
      <div className="week-days" role="group" aria-label="요일 선택">
        {days.map((day) => {
          const date = new Date(`${day}T00:00:00Z`);
          return (
            <button
              key={day}
              type="button"
              className={`week-day ${day === selected ? "active" : ""}`}
              aria-pressed={day === selected}
              onClick={() => setSelected(day)}
            >
              <span>{WEEKDAYS[date.getUTCDay()]}</span>
              <strong>{day.slice(8)}일</strong>
              <small>{counts.get(day) ?? 0}건</small>
            </button>
          );
        })}
      </div>
      {agenda.length ? (
        <ul className="week-agenda" aria-label={`${selected} 예약 목록`}>
          {agenda.map((item) => (
            <li
              key={item.id}
              className={item.status.startsWith("CANCEL") ? "cancelled" : ""}
            >
              <span>
                <strong>
                  {KST_TIME.format(item.start)}–
                  {Number.isFinite(item.end) ? KST_TIME.format(item.end) : ""}
                </strong>{" "}
                · {item.branchName}
              </span>
              <span>
                {item.roomName} · {STATUS[item.status] ?? item.status}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="help">이 날은 예약이 없어요.</p>
      )}
    </div>
  );
}
