import { ApiError } from "../api/client";
import { Button } from "./primitives";

/** Keep the page usable while distinguishing unavailable data from an empty result. */
export function DataNotice({
  label,
  error,
  loading,
  retry,
}: {
  label: string;
  error?: Error | null;
  loading?: boolean;
  retry?: () => void;
}) {
  if (!error && !loading) return null;
  const unsupported =
    error instanceof ApiError && [404, 501].includes(error.status);
  const message = loading
    ? `${label}를 불러오고 있어요.`
    : unsupported
      ? `${label}가 아직 제공되지 않습니다. 화면은 계속 둘러볼 수 있어요.`
      : `${label}를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.`;
  return (
    <div
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-soft px-4 py-3 text-xs"
      role="status"
      aria-live="polite"
    >
      <span>
        {message}
        {error instanceof ApiError && error.detail.requestId && (
          <small className="block">요청 ID: {error.detail.requestId}</small>
        )}
      </span>
      {error && retry && (
        <Button onClick={retry} aria-label={`${label} 다시 불러오기`}>
          다시 불러오기
        </Button>
      )}
    </div>
  );
}
