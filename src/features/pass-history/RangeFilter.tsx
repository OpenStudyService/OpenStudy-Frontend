import { useState } from "react";
import { Field } from "../organization/shared";
import { Button, FieldError } from "../../shared/ui/primitives";
import { timeRange } from "./model";

export function RangeFilter({
  from,
  to,
  onApply,
}: {
  from: string;
  to: string;
  onApply: (from: string, to: string) => void;
}) {
  const [start, setStart] = useState(from),
    [end, setEnd] = useState(to),
    [error, setError] = useState("");
  return (
    <form
      className="my-4 grid gap-3 sm:grid-cols-3"
      onSubmit={(event) => {
        event.preventDefault();
        try {
          timeRange(start, end);
          setError("");
          onApply(start, end);
        } catch (cause) {
          setError((cause as Error).message);
        }
      }}
    >
      <Field label="조회 시작 (한국 시각, 포함)">
        <input
          type="datetime-local"
          step="1"
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
      </Field>
      <Field label="조회 종료 (한국 시각, 미포함)">
        <input
          type="datetime-local"
          step="1"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
        />
      </Field>
      <div className="flex items-end gap-2">
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
      </div>
      {error && <FieldError>{error}</FieldError>}
    </form>
  );
}
