import { formatDateTime } from "../domain/format";
import { Button } from "./primitives";

export function RefreshControl({
  label = "화면 새로고침",
  updatedAt,
  fetching,
  refresh,
}: {
  label?: string;
  updatedAt: number;
  fetching: boolean;
  refresh: () => void;
}) {
  const date = updatedAt ? new Date(updatedAt).toISOString() : undefined;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled={fetching} onClick={refresh}>
        {label}
      </Button>
      <span className="text-xs text-muted" aria-live="polite">
        마지막 조회{" "}
        {date ? <time dateTime={date}>{formatDateTime(date)}</time> : "—"}
      </span>
    </div>
  );
}
