import type { RoomReservation } from "./model";
import { stamp } from "./shared";
import "./week-calendar.css";

const hourMs = 3_600_000;
const dayMs = 24 * hourMs;
const weekdays = ["월", "화", "수", "목", "금", "토", "일"];

export function shiftDay(date: string, days: number) {
  const time = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(time)
    ? new Date(time + days * dayMs).toISOString().slice(0, 10)
    : "";
}

export function startOfWeek(date: string) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return shiftDay(date, -((weekday + 6) % 7));
}

type Booking = { reservation: RoomReservation; branchName: string };
type DayBooking = Booking & { start: number; end: number };
type PlacedBooking = DayBooking & { lane: number };

function groupOverlappingBookings(bookings: DayBooking[]) {
  const groups: { bookings: PlacedBooking[]; laneEnds: number[] }[] = [];
  let groupEnd = 0;
  for (const booking of bookings.sort(
    (a, b) => a.start - b.start || b.end - a.end,
  )) {
    if (!groups.length || booking.start >= groupEnd) {
      groups.push({ bookings: [], laneEnds: [] });
      groupEnd = 0;
    }
    const group = groups[groups.length - 1];
    const freeLane = group.laneEnds.findIndex((end) => end <= booking.start);
    const lane = freeLane < 0 ? group.laneEnds.length : freeLane;
    group.laneEnds[lane] = booking.end;
    group.bookings.push({ ...booking, lane });
    groupEnd = Math.max(groupEnd, booking.end);
  }
  return groups;
}

function clockLabel(hour: number) {
  const minutes = Math.round(hour * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function WeekCalendar({
  week,
  today,
  bookings,
  calendars,
  showBranch,
  show,
}: {
  week: string;
  today: string;
  bookings: Booking[];
  calendars: { branchName: string; closedDates: string[] }[];
  showBranch: boolean;
  show: (id: string) => void;
}) {
  const days = weekdays.map((weekday, offset) => {
    const date = shiftDay(week, offset);
    const midnight = Date.parse(stamp(date));
    const entries = bookings.flatMap((booking) => {
      const start =
        (Date.parse(booking.reservation.startAt) - midnight) / hourMs;
      const end = (Date.parse(booking.reservation.endAt) - midnight) / hourMs;
      return start < 24 && end > 0
        ? [{ ...booking, start: Math.max(0, start), end: Math.min(24, end) }]
        : [];
    });
    return {
      date,
      weekday,
      entries,
      closed: calendars
        .filter((calendar) => calendar.closedDates.includes(date))
        .map((calendar) => calendar.branchName),
      groups: groupOverlappingBookings(entries),
    };
  });
  const entries = days.flatMap((day) => day.entries);
  const firstHour = Math.floor(
    Math.min(9, ...entries.map((entry) => entry.start)),
  );
  const lastHour = Math.ceil(
    Math.max(23, ...entries.map((entry) => entry.end)),
  );
  const hourCount = lastHour - firstHour;
  const columns = days.map(({ groups }) => {
    const lanes = Math.max(1, ...groups.map((group) => group.laneEnds.length));
    return `minmax(${Math.max(132, lanes * 76)}px, 1fr)`;
  });

  return (
    <>
      {!entries.length && (
        <p className="reservation-week-empty">이 주에 표시할 예약이 없어요.</p>
      )}
      <div
        className="reservation-week-scroll"
        role="region"
        aria-label="주간 예약 시간표"
        tabIndex={0}
      >
        <div
          className="reservation-week-grid"
          style={{ gridTemplateColumns: `56px ${columns.join(" ")}` }}
        >
          <div className="reservation-week-time-heading">시간</div>
          {days.map(({ date, weekday, closed }) => (
            <div
              className="reservation-week-day-heading"
              key={date}
              aria-current={date === today ? "date" : undefined}
            >
              <h3>
                <span>{weekday}</span>
                <time dateTime={date}>
                  {Number(date.slice(5, 7))}/{Number(date.slice(8))}
                </time>
              </h3>
              {closed.length > 0 && (
                <p className="reservation-week-closed">
                  {showBranch ? `${closed.join(", ")} 휴무` : "지점 휴무"}
                </p>
              )}
            </div>
          ))}
          <div className="reservation-week-hours" aria-hidden="true">
            {Array.from({ length: hourCount }, (_, index) => (
              <div key={index}>{clockLabel(firstHour + index)}</div>
            ))}
          </div>
          {days.map(({ date, weekday, closed, groups }) => (
            <section
              key={date}
              aria-label={`${date} ${weekday}요일`}
              className="reservation-week-track"
              data-closed={!showBranch && closed.length > 0}
            >
              {groups.flatMap(({ bookings, laneEnds }) =>
                bookings.map(
                  ({ reservation, branchName, start, end, lane }) => {
                    const time = `${clockLabel(start)}–${clockLabel(end)}`;
                    const venue = showBranch
                      ? `${branchName} · ${reservation.room.name}`
                      : reservation.room.name;
                    const label = `${time} ${venue} · ${reservation.customer.name} · ${reservation.status}`;
                    return (
                      <button
                        type="button"
                        key={reservation.id}
                        className="reservation-week-booking"
                        data-status={reservation.status}
                        aria-label={label}
                        title={label}
                        style={{
                          top: `${((start - firstHour) / hourCount) * 100}%`,
                          height: `calc(${((end - start) / hourCount) * 100}% - 3px)`,
                          insetInlineStart: `calc(${(lane / laneEnds.length) * 100}% + 2px)`,
                          width: `calc(${100 / laneEnds.length}% - 4px)`,
                        }}
                        onClick={() => show(reservation.id)}
                      >
                        <span className="reservation-week-booking-time">
                          {time}
                        </span>
                        <strong>{reservation.room.name}</strong>
                        <span>
                          {reservation.status} ·{" "}
                          {showBranch ? branchName : reservation.customer.name}
                        </span>
                      </button>
                    );
                  },
                ),
              )}
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
