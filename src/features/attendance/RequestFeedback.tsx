import { ApiError } from "../../shared/api/client";
import { ErrorState } from "../../shared/ui/primitives";
import { shiftTime } from "./api";
import type { RequestConflict } from "./request-api";

export function RequestFeedback({
  error,
  reload,
}: {
  error: Error;
  reload?: () => void;
}) {
  const conflict =
    error instanceof ApiError && error.status === 409
      ? (error.detail as RequestConflict)
      : undefined;
  return (
    <div>
      <ErrorState
        error={error}
        retry={conflict?.reloadUrl ? reload : undefined}
      />
      {conflict && (
        <ul className="grid gap-1">
          {conflict.attendanceConflicts?.map((item) => (
            <li
              key={`${item.attendanceRecordId}:${item.overlapStartsAt}:${item.overlapEndsAt}`}
            >
              {item.label}
              {item.visible && item.attendanceRecordId
                ? ` #${item.attendanceRecordId}`
                : ""}{" "}
              · {shiftTime(item.overlapStartsAt)} ~{" "}
              {shiftTime(item.overlapEndsAt)}
            </li>
          ))}
          {conflict.conflicts?.map((item, index) => (
            <li key={index}>
              {item.label}
              {item.visible && item.shift
                ? ` #${item.shift.id} · 지점 ${item.shift.branchId}`
                : ""}{" "}
              · {shiftTime(item.overlapStartsAt)} ~{" "}
              {shiftTime(item.overlapEndsAt)}
            </li>
          ))}
          {!!conflict.breakIds?.length && (
            <li>겹치는 휴게 구간: {conflict.breakIds.join(", ")}</li>
          )}
          {conflict.pendingCorrectionId && (
            <li>처리 대기 중인 정정: {conflict.pendingCorrectionId}</li>
          )}
          {conflict.pendingSwapId && (
            <li>처리 대기 중인 대체근무: {conflict.pendingSwapId}</li>
          )}
          {conflict.code === "LEAVE_OVERLAP" && (
            <li>
              {conflict.overlappingRequestIds?.length
                ? `겹치는 휴가 신청: ${conflict.overlappingRequestIds.join(", ")}`
                : "다른 휴가와 기간이 겹칩니다."}
            </li>
          )}
          {conflict.requiredDays !== undefined &&
            conflict.availableDays !== undefined && (
              <li>
                필요 {conflict.requiredDays}일 · 사용 가능{" "}
                {conflict.availableDays}일
              </li>
            )}
          {conflict.shiftId && <li>대상 근무: {conflict.shiftId}</li>}
          {conflict.latestVersion !== undefined && (
            <li>최신 버전: {conflict.latestVersion}</li>
          )}
          {conflict.reloadUrl && (
            <li>다시 조회할 대상: {conflict.reloadUrl}</li>
          )}
        </ul>
      )}
    </div>
  );
}
