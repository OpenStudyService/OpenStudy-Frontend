import { useState, type FormEvent } from "react";
import { Field } from "../organization/shared";
import { Button, FieldError } from "../../shared/ui/primitives";
import { timeRange } from "./model";

const START = "조회 시작 (한국 시각, 포함)";
const END = "조회 종료 (한국 시각, 미포함)";
// 390px에서는 시작·종료를 한 줄씩 꽉 채우고, sm 이상에서는 한 줄에 둔다.
const INLINE_INPUT = "w-full min-w-0 sm:w-auto";

export function RangeFilter({
  from,
  to,
  onApply,
  inline = false,
}: {
  from: string;
  to: string;
  onApply: (from: string, to: string) => void;
  /** 목록 카드 안 한 줄 배치. 라벨은 접근성 이름(aria-label)으로만 둔다. */
  inline?: boolean;
}) {
  const [start, setStart] = useState(from),
    [end, setEnd] = useState(to),
    [error, setError] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      timeRange(start, end);
      setError("");
      onApply(start, end);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  const startInput = (
    <input
      type="datetime-local"
      step="1"
      aria-label={inline ? START : undefined}
      className={inline ? INLINE_INPUT : undefined}
      value={start}
      onChange={(e) => setStart(e.target.value)}
    />
  );
  const endInput = (
    <input
      type="datetime-local"
      step="1"
      aria-label={inline ? END : undefined}
      className={inline ? INLINE_INPUT : undefined}
      value={end}
      onChange={(e) => setEnd(e.target.value)}
    />
  );
  const buttons = (
    <>
      <Button type="submit">기간 적용</Button>
      <Button
        type="button"
        onClick={() => {
          setStart("");
          setEnd("");
          setError("");
          onApply("", "");
        }}
      >
        전체 기간
      </Button>
    </>
  );
  if (inline)
    return (
      <form
        aria-label="조회 기간"
        className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3"
        onSubmit={submit}
      >
        <span className="w-full text-xs text-muted sm:w-auto">
          조회 기간 (한국 시각)
        </span>
        {startInput}
        <span aria-hidden="true" className="hidden sm:inline">
          ~
        </span>
        {endInput}
        <span className="flex gap-2">{buttons}</span>
        {error && (
          <div className="w-full">
            <FieldError>{error}</FieldError>
          </div>
        )}
      </form>
    );
  return (
    <form className="my-4 grid gap-3 sm:grid-cols-3" onSubmit={submit}>
      <Field label={START}>{startInput}</Field>
      <Field label={END}>{endInput}</Field>
      <div className="flex items-end gap-2">{buttons}</div>
      {error && <FieldError>{error}</FieldError>}
    </form>
  );
}
