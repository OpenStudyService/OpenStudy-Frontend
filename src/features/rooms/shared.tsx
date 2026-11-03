import { ApiError } from "../../shared/api/client";
import { Button, FieldError } from "../../shared/ui/primitives";
import type { ReactNode } from "react";

export const keyFor = (
  user: string,
  scope: string,
  resource: string,
  id: string,
) => ["data", user, scope, resource, "detail", id];
export const stamp = (date: string, hour = 0) =>
  `${date}T${String(hour).padStart(2, "0")}:00:00+09:00`;
export const displayTime = (iso: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
export const abortError = (e: unknown) =>
  e instanceof DOMException && e.name === "AbortError";
export function WriteError({
  error,
  refresh,
  latest,
}: {
  error: Error | null;
  refresh?: () => void;
  latest?: ReactNode;
}) {
  return (
    <>
      {error && (
        <FieldError>
          {error.message}
          {error instanceof ApiError &&
            Object.entries(error.detail.fieldErrors ?? {}).map(([key, v]) => (
              <span className="block" key={key}>
                {key}: {v}
              </span>
            ))}
        </FieldError>
      )}
      {error instanceof ApiError &&
        error.detail.code === "VERSION_CONFLICT" &&
        refresh && (
          <div className="my-4">
            <p>입력을 유지했습니다. 최신 내용을 비교한 뒤 다시 저장하세요.</p>
            <Button type="button" onClick={refresh}>
              최신 내용 확인
            </Button>
          </div>
        )}
      {latest && (
        <section className="card my-4 p-4">
          <h3>최신 서버 내용</h3>
          {latest}
        </section>
      )}
    </>
  );
}
