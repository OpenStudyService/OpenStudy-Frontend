import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { ApiError } from "../../shared/api/client";
import { can, won } from "../../shared/domain/schema";
import { Button, ErrorState, Panel, State } from "../../shared/ui/primitives";
import { Field } from "../organization/shared";
import { useSalesClock } from "../payments/shared";
import { roomApi } from "./api";
import type { RoomReservation } from "./model";
import { useRoomLeaveGuard, useRoomWrite } from "./hooks";
import { ReservationCreate } from "./ReservationCreate";
import { WriteError, abortError, displayTime, keyFor } from "./shared";

export function ReservationPanel(props: {
  id: string;
  onClose: () => void;
  onSelected: (id: string) => void;
}) {
  const { session, scope } = useApp();
  return (
    <ReservationSession
      key={JSON.stringify([props.id, scope, session.user])}
      {...props}
    />
  );
}
function ReservationSession({
  id,
  onClose,
  onSelected,
}: {
  id: string;
  onClose: () => void;
  onSelected: (id: string) => void;
}) {
  const { session, scope } = useApp(),
    [mode, setMode] = useState(""),
    clock = useSalesClock();
  const row = useQuery({
    queryKey: keyFor(session.user.id, scope, "room-reservations", id),
    queryFn: ({ signal }) => roomApi.reservation(scope, id, signal),
    enabled: id !== "new",
    retry: false,
  });
  const room = useQuery({
    queryKey: [
      "data",
      session.user.id,
      scope,
      "rooms",
      "reservation-source",
      row.data?.room.id,
    ],
    queryFn: ({ signal }) => roomApi.room(scope, row.data!.room.id, signal),
    enabled: !!row.data,
    retry: false,
  });
  const data = row.error ? undefined : row.data,
    active =
      data &&
      session.branches.some(
        (b) => b.id === data.branchId && b.status === "운영 중",
      );
  const writable = data && can(session.user, data.branchId, "payments:write");
  const canCreate = session.branches.some(
    (b) =>
      (scope === "all" || b.id === scope) &&
      b.status === "운영 중" &&
      can(session.user, b.id, "payments:write"),
  );
  return (
    <Panel
      open
      title={
        id === "new"
          ? "예약 등록"
          : data
            ? `${data.room.name} 예약`
            : "예약 상세"
      }
      onClose={onClose}
    >
      {id === "new" ? (
        canCreate ? (
          <ReservationCreate onSaved={(r) => onSelected(r.id)} />
        ) : (
          <State title="예약 등록 권한이 없어요" />
        )
      ) : row.isPending ? (
        <State loading />
      ) : row.error ? (
        <ErrorState error={row.error} retry={() => void row.refetch()} />
      ) : (
        data && (
          <>
            {mode === "rebook" && writable ? (
              <ReservationCreate
                previous={data}
                onSaved={(r) => onSelected(r.id)}
              />
            ) : mode ? (
              <ReservationAction
                key={mode}
                row={data}
                action={mode as "cancel" | "start" | "complete"}
                onSaved={() => setMode("")}
              />
            ) : (
              <>
                <ReservationInfo row={data} />
                {data.status === "결제 실패" && (
                  <p className="tip mt-4">
                    결제가 실패하여 예약 시간을 점유하지 않았습니다. 다시
                    예약하려면 새 예약으로 진행하세요.
                  </p>
                )}
                <div className="mt-6 flex flex-wrap gap-2">
                  {writable &&
                    data.canCancel &&
                    data.status === "확정" &&
                    clock < Date.parse(data.startAt) && (
                      <Button onClick={() => setMode("cancel")}>
                        예약 취소
                      </Button>
                    )}
                  {can(session.user, data.branchId) &&
                    data.status === "확정" &&
                    active &&
                    room.data?.status === "사용 가능" &&
                    !room.error && (
                      <Button onClick={() => setMode("start")}>
                        이용 시작
                      </Button>
                    )}
                  {can(session.user, data.branchId) &&
                    data.status === "이용 중" && (
                      <Button onClick={() => setMode("complete")}>
                        이용 완료
                      </Button>
                    )}
                  {writable &&
                    active &&
                    ["취소", "결제 실패"].includes(data.status) && (
                      <Button onClick={() => setMode("rebook")}>
                        새 예약으로 재예약
                      </Button>
                    )}
                </div>
                {room.error && (
                  <ErrorState
                    error={room.error}
                    retry={() => void room.refetch()}
                  />
                )}
              </>
            )}
            {mode && (
              <Button className="mt-3" onClick={() => setMode("")}>
                취소
              </Button>
            )}
          </>
        )
      )}
    </Panel>
  );
}
export function ReservationInfo({ row }: { row: RoomReservation }) {
  const { session } = useApp();
  return (
    <dl className="grid gap-3">
      {[
        [
          "지점",
          session.branches.find((b) => b.id === row.branchId)?.name ??
            row.branchId,
        ],
        ["룸", `${row.room.roomNo} · ${row.room.name}`],
        ["고객", `${row.customer.name} · ${row.customer.memberNo}`],
        ["예약 시작", displayTime(row.startAt)],
        ["예약 종료", displayTime(row.endAt)],
        ["예약 상태", row.status],
        [
          "확정 결제 금액",
          row.billing ? won(row.billing.amountKrw) : "결제 조회 권한 없음",
        ],
        ["결제 상태", row.billing?.paymentStatus ?? "—"],
        [
          "예약 당시 시간당 요금",
          row.billing ? won(row.billing.ratePerHourKrw) : "—",
        ],
        ["취소 사유", row.cancelReason ?? "—"],
        ["실제 이용 시작", row.usage ? displayTime(row.usage.startedAt) : "—"],
        [
          "실제 이용 완료",
          row.usage?.endedAt ? displayTime(row.usage.endedAt) : "—",
        ],
      ].map(([label, v]) => (
        <div key={label}>
          <dt className="text-muted">{label}</dt>
          <dd className="whitespace-pre-wrap break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
function ReservationAction({
  row,
  action,
  onSaved,
}: {
  row: RoomReservation;
  action: "cancel" | "start" | "complete";
  onSaved: () => void;
}) {
  const { session, scope } = useApp(),
    write = useRoomWrite("reservations", "rooms"),
    clock = useSalesClock(),
    [original] = useState(row),
    [reason, setReason] = useState(""),
    [latest, setLatest] = useState<RoomReservation>(),
    [error, setError] = useState<Error | null>(null),
    [blocked, setBlocked] = useState(false),
    leave = useRoomLeaveGuard(!!reason);
  const current = latest ?? original;
  const allowed =
    action === "cancel"
      ? can(session.user, current.branchId, "payments:write") &&
        current.canCancel &&
        current.status === "확정" &&
        clock < Date.parse(current.startAt)
      : can(session.user, current.branchId) &&
        (action === "start"
          ? current.status === "확정" &&
            session.branches.some(
              (b) => b.id === current.branchId && b.status === "운영 중",
            )
          : current.status === "이용 중");
  const labels = {
    cancel: "예약 취소·전액 환불",
    start: "이용 시작",
    complete: "이용 완료",
  };
  async function compare() {
    try {
      const value = await write.run(
        "reservation:compare",
        {},
        (signal) => roomApi.reservation(scope, row.id, signal),
        false,
      );
      setLatest(value);
    } catch (e) {
      if (!abortError(e)) {
        setError(e as Error);
        if (e instanceof ApiError && [401, 403, 404].includes(e.status))
          setBlocked(true);
      }
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (
      write.busy ||
      blocked ||
      !allowed ||
      (action === "cancel" && clock >= Date.parse(original.startAt))
    )
      return;
    setError(null);
    const body = {
      version: (latest ?? original).version,
      ...(action === "cancel" ? { reason } : {}),
    };
    try {
      await write.run(
        `reservation:${row.id}:${action}`,
        body,
        (signal, key) =>
          action === "cancel"
            ? roomApi.cancel(
                scope,
                row.id,
                { version: body.version, reason },
                signal,
                key,
              )
            : roomApi[action](scope, row.id, body, signal),
        true,
        keyFor(session.user.id, scope, "room-reservations", row.id),
      );
      leave.saved();
      onSaved();
    } catch (e) {
      if (abortError(e)) return;
      setError(e as Error);
      if (e instanceof ApiError) {
        if (e.detail.code === "VERSION_CONFLICT") setLatest(undefined);
        if ([401, 403, 404].includes(e.status)) setBlocked(true);
      }
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)}>
      {leave.guard}
      <fieldset disabled={write.busy || blocked} className="grid gap-4">
        <p>
          {action === "cancel"
            ? "시작 전 확정 예약을 취소하고 원결제를 전액 환불합니다. 원래 예약과 결제 기록은 유지됩니다."
            : `${labels[action]} 처리 시각을 서버에 기록합니다.`}
        </p>
        {action === "cancel" && (
          <Field label="취소 사유">
            <textarea
              aria-label="취소 사유"
              required
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        )}
      </fieldset>
      <WriteError
        error={error}
        refresh={() => void compare()}
        latest={latest && <ReservationInfo row={latest} />}
      />
      {!allowed && (
        <p role="alert">
          현재 예약 상태 또는 권한으로 이 작업을 처리할 수 없습니다. 최신 내용을
          확인해 주세요.
        </p>
      )}
      {blocked && (
        <p role="alert">권한이 변경되었습니다. 화면을 새로고침하세요.</p>
      )}
      {action === "cancel" && clock >= Date.parse(original.startAt) ? (
        <p role="alert">예약 시작 시각이 지나 취소할 수 없습니다.</p>
      ) : (
        <Button
          className="mt-5"
          type="submit"
          variant="primary"
          disabled={
            write.busy ||
            blocked ||
            !allowed ||
            (error instanceof ApiError &&
              error.detail.code === "VERSION_CONFLICT" &&
              !latest)
          }
        >
          {write.busy
            ? "처리 중…"
            : latest
              ? "최신 기준으로 다시 저장"
              : labels[action]}
        </Button>
      )}
    </form>
  );
}
