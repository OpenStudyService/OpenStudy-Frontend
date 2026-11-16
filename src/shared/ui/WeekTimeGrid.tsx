import "./week-time-grid.css";

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

export type WeekEvent = {
  id: string;
  startAt: string;
  endAt: string;
  title: string;
  detail: string;
  summary?: string;
  label: string;
  status: string;
  ongoing?: boolean;
  onSelect?: () => void;
};

type DayEvent = WeekEvent & {
  start: number;
  end: number;
  placementEnd: number;
};
type PlacedEvent = DayEvent & { lane: number };

function groupOverlappingEvents(events: DayEvent[]) {
  const groups: { events: PlacedEvent[]; laneEnds: number[] }[] = [];
  let groupEnd = 0;
  for (const event of events.sort(
    (a, b) => a.start - b.start || b.end - a.end,
  )) {
    if (!groups.length || event.start >= groupEnd) {
      groups.push({ events: [], laneEnds: [] });
      groupEnd = 0;
    }
    const group = groups[groups.length - 1];
    const freeLane = group.laneEnds.findIndex((end) => end <= event.start);
    const lane = freeLane < 0 ? group.laneEnds.length : freeLane;
    group.laneEnds[lane] = event.placementEnd;
    group.events.push({ ...event, lane });
    groupEnd = Math.max(groupEnd, event.placementEnd);
  }
  return groups;
}

function clockLabel(hour: number) {
  const minutes = Math.round(hour * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function WeekTimeGrid({
  week,
  today,
  events,
  label,
  emptyMessage,
  getDayNotes,
  isDayClosed,
}: {
  week: string;
  today: string;
  events: WeekEvent[];
  label: string;
  emptyMessage: string;
  getDayNotes?: (date: string) => string[];
  isDayClosed?: (date: string) => boolean;
}) {
  const days = weekdays.map((weekday, offset) => {
    const date = shiftDay(week, offset);
    const midnight = Date.parse(`${date}T00:00:00+09:00`);
    const entries = events.flatMap((event) => {
      const start = (Date.parse(event.startAt) - midnight) / hourMs;
      const end = (Date.parse(event.endAt) - midnight) / hourMs;
      if (!(start < 24 && (end > 0 || start === 0) && end >= start)) return [];
      const dayStart = Math.max(0, start);
      return [
        {
          ...event,
          start: dayStart,
          end: Math.min(24, end),
          placementEnd: Math.min(24, Math.max(end, dayStart + 0.5)),
        },
      ];
    });
    return { date, weekday, entries, groups: groupOverlappingEvents(entries) };
  });
  const entries = days.flatMap((day) => day.entries);
  const firstHour = Math.floor(
    Math.min(9, ...entries.map((entry) => entry.start)),
  );
  const lastHour = Math.ceil(
    Math.max(23, ...entries.map((entry) => entry.placementEnd)),
  );
  const hourCount = lastHour - firstHour;
  const columns = days.map(({ groups }) => {
    const lanes = Math.max(1, ...groups.map((group) => group.laneEnds.length));
    return `minmax(${Math.max(132, lanes * 76)}px, 1fr)`;
  });

  return (
    <>
      {!entries.length &&
        !days.some(({ date }) => getDayNotes?.(date).length) && (
          <p className="week-calendar-empty">{emptyMessage}</p>
        )}
      <div
        className="week-calendar-scroll"
        role="region"
        aria-label={label}
        tabIndex={0}
      >
        <div
          className="week-calendar-grid"
          style={{ gridTemplateColumns: `56px ${columns.join(" ")}` }}
        >
          <div className="week-calendar-time-heading">시간</div>
          {days.map(({ date, weekday }) => (
            <div
              className="week-calendar-day-heading"
              key={date}
              aria-current={date === today ? "date" : undefined}
            >
              <h3>
                <span>{weekday}</span>
                <time dateTime={date}>
                  {Number(date.slice(5, 7))}/{Number(date.slice(8))}
                </time>
              </h3>
              {getDayNotes?.(date).map((note, index) => (
                <p className="week-calendar-day-note" key={index}>
                  {note}
                </p>
              ))}
            </div>
          ))}
          <div className="week-calendar-hours" aria-hidden="true">
            {Array.from({ length: hourCount }, (_, index) => (
              <div key={index}>{clockLabel(firstHour + index)}</div>
            ))}
          </div>
          {days.map(({ date, weekday, groups }) => (
            <section
              key={date}
              aria-label={`${date} ${weekday}요일`}
              className="week-calendar-track"
              data-closed={isDayClosed?.(date)}
            >
              {groups.flatMap(({ events, laneEnds }) =>
                events.map(
                  ({
                    id,
                    start,
                    end,
                    placementEnd,
                    lane,
                    title,
                    label,
                    detail,
                    summary,
                    status,
                    ongoing,
                    onSelect,
                  }) => {
                    const time = ongoing
                      ? `${clockLabel(start)} 이후`
                      : `${clockLabel(start)}–${clockLabel(end)}`;
                    const description = `${time} ${label}`;
                    const props = {
                      className: "week-calendar-event",
                      "data-status": status,
                      title: description,
                      style: {
                        top: `${((start - firstHour) / hourCount) * 100}%`,
                        height: `calc(${((placementEnd - start) / hourCount) * 100}% - 3px)`,
                        insetInlineStart: `calc(${(lane / laneEnds.length) * 100}% + 2px)`,
                        width: `calc(${100 / laneEnds.length}% - 4px)`,
                      },
                    };
                    const content = (
                      <>
                        <span className="week-calendar-event-time">{time}</span>
                        <strong>{title}</strong>
                        <span>{detail}</span>
                        {summary && <span>{summary}</span>}
                      </>
                    );
                    return onSelect ? (
                      <button
                        type="button"
                        key={id}
                        {...props}
                        aria-label={description}
                        onClick={onSelect}
                      >
                        {content}
                      </button>
                    ) : (
                      <div
                        key={id}
                        {...props}
                        role="group"
                        aria-label={description}
                      >
                        {content}
                      </div>
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
