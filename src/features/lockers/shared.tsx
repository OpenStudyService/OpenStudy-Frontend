import { ApiError } from "../../shared/api/client";
import { Button } from "../../shared/ui/primitives";
import { WriteError } from "../rooms/shared";
import type { ReactNode } from "react";

export { abortError, keyFor } from "../rooms/shared";
export const accessError = (e: unknown) =>
  e instanceof ApiError && [401, 403, 404].includes(e.status);
export const versionError = (e: unknown) =>
  e instanceof ApiError && e.detail.code === "VERSION_CONFLICT";
export function addDays(date: string, days: number) {
  const time = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(time) && Number.isFinite(days)
    ? new Date(time + days * 86400000).toISOString().slice(0, 10)
    : "";
}
export function LockerWriteError({
  error,
  compare,
  latest,
  reload,
}: {
  error: Error | null;
  compare?: () => void;
  latest?: ReactNode;
  reload?: () => void;
}) {
  return (
    <>
      <WriteError error={error} refresh={compare} latest={latest} />
      {error instanceof ApiError &&
        error.status === 409 &&
        !versionError(error) &&
        reload && (
          <div className="my-3">
            <p>
              입력을 유지했습니다. 현재 서버의 배정 현황을 다시 확인해 주세요.
            </p>
            <Button type="button" onClick={reload}>
              배정 현황 다시 조회
            </Button>
          </div>
        )}
    </>
  );
}
