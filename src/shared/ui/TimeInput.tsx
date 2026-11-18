import { useId, useState } from "react";

/** Edits minutes since midnight using the browser's hour/minute picker. */
export function TimeInput({
  label,
  accessibleLabel = label,
  hideLabel = false,
  value,
  onChange,
  allowNextDay = false,
}: {
  label: string;
  accessibleLabel?: string;
  hideLabel?: boolean;
  value: number | null;
  onChange: (value: number | null) => void;
  allowNextDay?: boolean;
}) {
  const id = useId();
  // Retain the selected day while the user clears and re-enters a time.
  const [emptyDay, setEmptyDay] = useState(0);
  const needsNewTime = allowNextDay && value === 2880;
  const day = value === null ? emptyDay : Math.min(Math.floor(value / 1440), 1);
  const minute = value === null || needsNewTime ? null : value % 1440;
  const time =
    minute === null
      ? ""
      : `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

  return (
    <div className="relative grid min-w-0 gap-1">
      <label className={hideLabel ? "sr-only" : "help"} htmlFor={id}>
        {label}
      </label>
      <div
        className={
          allowNextDay
            ? "flex w-fit shrink-0 items-center rounded-lg border border-line bg-surface focus-within:ring-2 focus-within:ring-primary"
            : "min-w-0"
        }
      >
        {allowNextDay && (
          <select
            className="w-28 min-w-28 shrink-0 rounded-none rounded-l-lg border-0 border-r border-line bg-transparent px-2 focus-visible:outline-none"
            aria-label={`${accessibleLabel} 기준일`}
            value={day}
            onChange={(event) => {
              const nextDay = Number(event.target.value);
              setEmptyDay(nextDay);
              onChange(minute === null ? null : nextDay * 1440 + minute);
            }}
          >
            <option value={0}>당일</option>
            <option value={1}>다음 날</option>
          </select>
        )}
        <input
          id={id}
          aria-label={accessibleLabel}
          className={
            allowNextDay
              ? "w-36 min-w-36 shrink-0 rounded-none rounded-r-lg border-0 bg-transparent px-2 focus-visible:outline-none"
              : "w-36 min-w-36 shrink-0 px-2"
          }
          type="time"
          required
          step={60}
          value={time}
          aria-describedby={needsNewTime ? `${id}-hint` : undefined}
          onChange={(event) => {
            setEmptyDay(day);
            const [hour, minute] = event.target.value.split(":").map(Number);
            onChange(
              event.target.value === ""
                ? null
                : day * 1440 + hour * 60 + minute,
            );
          }}
        />
      </div>
      {needsNewTime && (
        <p id={`${id}-hint`} className="help">
          기존 종료 시간이 선택 범위를 벗어나요. 시간을 다시 선택해 주세요.
        </p>
      )}
    </div>
  );
}
