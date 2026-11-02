import { useState } from "react";
import type { DemoResult } from "./model";
import "./rich-visuals.css";

export function Heatmap({ result }: { result: DemoResult }) {
  const days = ["월", "화", "수", "목", "금", "토", "일"],
    slots = ["09–12시", "12–15시", "15–18시", "18–21시", "21–24시"];
  const [selected, setSelected] = useState("");
  const cells = days.flatMap((day) =>
    slots.map((slot) => ({
      day,
      slot,
      value: result.rows
        .filter((r) => r.label === day && r.slot === slot)
        .reduce((n, r) => n + Number(r.value), 0),
    })),
  );
  const max = Math.max(...cells.map((c) => c.value), 1),
    peak = cells.find((c) => c.value === max)!;
  const colors = [
    "#eef5f8",
    "#d8e9f0",
    "#a4ccda",
    "#5ba6bd",
    "#25839e",
    "#155870",
  ];
  return (
    <div className="dl-rich-panel">
      <div className="dl-section-title">
        <b>요일 × 시간대 이용 시작</b>
        <small>단위: 건 · 동시 점유율과 구분</small>
      </div>
      <div className="dl-heatmap-scroll">
        <div
          className="dl-heatmap"
          role="group"
          aria-label="요일과 시간대별 좌석 이용 히트맵"
        >
          <span />
          {slots.map((slot) => (
            <b key={slot}>{slot}</b>
          ))}
          {days.map((day) => (
            <div className="dl-heatmap-row" key={day}>
              <b>{day}</b>
              {cells
                .filter((c) => c.day === day)
                .map((cell) => (
                  <button
                    key={cell.slot}
                    aria-label={`${cell.day}요일 ${cell.slot} ${cell.value}건`}
                    style={{
                      background:
                        colors[Math.min(5, Math.ceil((cell.value / max) * 5))],
                      color: cell.value / max > 0.55 ? "white" : "#426176",
                    }}
                    onClick={() =>
                      setSelected(
                        `${cell.day}요일 ${cell.slot} · ${cell.value}건`,
                      )
                    }
                  >
                    {cell.value}
                  </button>
                ))}
            </div>
          ))}
        </div>
      </div>
      <div className="dl-heatmap-legend">
        <span>이용 시작이 적음</span>
        {colors.map((color) => (
          <i key={color} style={{ background: color }} />
        ))}
        <span>많음</span>
      </div>
      <div className="dl-rich-insight" role="status">
        <b>
          {selected ||
            `${peak.day}요일 ${peak.slot} · ${peak.value}건으로 가장 많아요`}
        </b>
        <span>선택한 지점의 고정 가상 입실 기록을 합산했습니다.</span>
      </div>
    </div>
  );
}

export function SeatMap({ result }: { result: DemoResult }) {
  const [selection, setSelection] = useState("");
  return (
    <div className="dl-rich-panel">
      <div className="dl-section-title">
        <b>지점별 좌석 배치</b>
        <small>고정 가상 배치 · 실제 도면 아님</small>
      </div>
      <div className="dl-seat-branches">
        {result.rows.map((branch) => {
          const occupied = Number(branch.occupied),
            available = Number(branch.available),
            blocked = Number(branch.blocked),
            total = Number(branch.total);
          return (
            <section className="dl-seat-branch" key={branch.id}>
              <header>
                <b>{branch.label}</b>
                <span>
                  {available}석 이용 가능 / {total}석
                </span>
              </header>
              <div className="dl-seat-zone">OPEN STUDY ZONE</div>
              <div className="dl-seat-grid">
                {Array.from({ length: total }, (_, i) => {
                  const status =
                      i < occupied
                        ? "이용 중"
                        : i < occupied + available
                          ? "이용 가능"
                          : "사용 불가",
                    tone =
                      i < occupied
                        ? "occupied"
                        : i < occupied + available
                          ? "available"
                          : "blocked",
                    name = `${i < 24 ? "A" : "B"}-${String((i % 24) + 1).padStart(2, "0")}`;
                  return (
                    <button
                      key={i}
                      className={tone}
                      aria-label={`${branch.label} ${name} ${status}`}
                      onClick={() =>
                        setSelection(`${branch.label} ${name} · ${status}`)
                      }
                    >
                      <span>▣</span>
                      {name}
                    </button>
                  );
                })}
              </div>
              <footer>
                <span>이용 중 {occupied}</span>
                <span>이용 가능 {available}</span>
                <span>사용 불가 {blocked}</span>
              </footer>
            </section>
          );
        })}
      </div>
      <div className="dl-seat-legend">
        <span>
          <i className="available" />
          이용 가능
        </span>
        <span>
          <i className="occupied" />
          이용 중
        </span>
        <span>
          <i className="blocked" />
          사용 불가
        </span>
      </div>
      {selection && (
        <div className="dl-rich-insight" role="status">
          <b>{selection}</b>
          <span>선택 상태를 보여주는 로컬 시뮬레이션입니다.</span>
        </div>
      )}
    </div>
  );
}

export function WeekCalendar({ result }: { result: DemoResult }) {
  const first = new Date(
    `${String(result.scenario.start ?? result.rows[0]?.date ?? "2026-10-17").slice(0, 10)}T00:00:00Z`,
  );
  first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(first);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  return (
    <div className="dl-rich-panel">
      <div className="dl-section-title">
        <b>한눈에 보는 주간 일정</b>
        <small>
          {days[0]} — {days[6]}
        </small>
      </div>
      <div className="dl-week-scroll">
        <div className="dl-week-calendar" aria-label="주간 예약 캘린더">
          {days.map((day, i) => (
            <section className={day === "2026-10-17" ? "today" : ""} key={day}>
              <header>
                <span>{["월", "화", "수", "목", "금", "토", "일"][i]}</span>
                <b>{Number(day.slice(-2))}</b>
              </header>
              <div>
                {result.rows
                  .filter((r) => r.date === day)
                  .map((row) => (
                    <article key={row.id}>
                      <time>{row.time}</time>
                      <b>{row.label}</b>
                      <span>{row.branch}</span>
                      <small>{row.status}</small>
                    </article>
                  ))}
              </div>
            </section>
          ))}
        </div>
      </div>
      <small className="dl-calendar-note">
        예약의 시간·지점·상태는 아래 원본 표에서도 확인할 수 있습니다.
      </small>
    </div>
  );
}
