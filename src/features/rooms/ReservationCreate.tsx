import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { can, businessDate, won } from "../../shared/domain/schema";
import { ApiError } from "../../shared/api/client";
import { Button, ErrorState } from "../../shared/ui/primitives";
import { Field } from "../organization/shared";
import { CustomerSelector, useSalesClock } from "../payments/shared";
import { roomApi } from "./api";
import type { RoomReservation, RoomReservationCreate } from "./model";
import { useRoomLeaveGuard, useRoomWrite } from "./hooks";
import { WriteError, abortError, displayTime, stamp } from "./shared";

export function ReservationCreate({
  previous,
  onSaved,
}: {
  previous?: RoomReservation;
  onSaved: (row: RoomReservation) => void;
}) {
  const { session, scope } = useApp(),
    write = useRoomWrite("reservations", "rooms"),
    query = useQueryClient(),
    now = useSalesClock();
  const branches = session.branches.filter(
    (b) =>
      (scope === "all" || scope === b.id) &&
      b.status === "운영 중" &&
      can(session.user, b.id, "payments:write"),
  );
  const [branch, setBranch] = useState(
      previous?.branchId ?? (branches.length === 1 ? branches[0].id : ""),
    ),
    [roomId, setRoomId] = useState(previous?.room.id ?? ""),
    [customerId, setCustomerId] = useState(previous?.customer.id ?? "");
  const [date, setDate] = useState(businessDate(session.asOf)),
    [hour, setHour] = useState(12),
    [hours, setHours] = useState(1),
    [partySize, setPartySize] = useState(1),
    [roomPage, setRoomPage] = useState(1);
  const [method, setMethod] = useState<RoomReservationCreate["method"]>("카드"),
    [outcome, setOutcome] = useState<"APPROVED" | "FAILED">("APPROVED"),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState<Error | null>(null),
    [blocked, setBlocked] = useState(false),
    [showSchedule, setShowSchedule] = useState(false);
  const leave = useRoomLeaveGuard(dirty);
  const rooms = useQuery({
    queryKey: [
      "data",
      session.user.id,
      scope,
      "rooms",
      "booking",
      branch,
      roomPage,
    ],
    queryFn: ({ signal }) =>
      roomApi.rooms(
        branch,
        { page: roomPage, pageSize: 100, status: "사용 가능" },
        signal,
      ),
    enabled: !!branch,
    retry: false,
  });
  const selected = useQuery({
    queryKey: [
      "data",
      session.user.id,
      scope,
      "rooms",
      "selection",
      branch,
      roomId,
    ],
    queryFn: ({ signal }) => roomApi.room(branch, roomId, signal),
    enabled: !!branch && !!roomId,
    retry: false,
  });
  const startAt = stamp(date, hour),
    endAt = Number.isFinite(Date.parse(startAt))
      ? new Date(Date.parse(startAt) + hours * 3600000).toISOString()
      : "";
  const schedule = useQuery({
    queryKey: [
      "data",
      session.user.id,
      scope,
      "room-reservations",
      "booking-schedule",
      branch,
      roomId,
      date,
    ],
    queryFn: ({ signal }) =>
      roomApi.calendar(
        branch,
        stamp(date),
        new Date(Date.parse(stamp(date)) + 2 * 86400000).toISOString(),
        roomId || undefined,
        signal,
      ),
    enabled: !!branch && Number.isFinite(Date.parse(stamp(date))),
    retry: false,
  });
  const closed =
    schedule.data?.closedDates?.includes(date) ||
    (!schedule.data?.closedDates &&
      error instanceof ApiError &&
      error.detail.code === "BRANCH_CLOSED_DAY" &&
      error.detail.closedDate === date);
  const checkingSchedule =
    schedule.fetchStatus === "fetching" && !schedule.data;
  const touch = () => setDirty(true);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (write.busy || blocked || closed || checkingSchedule) return;
    setError(null);
    if (
      !branches.some((b) => b.id === branch) ||
      !roomId ||
      !customerId ||
      selected.error ||
      !selected.data
    ) {
      setError(new Error("운영 중인 지점·룸과 조회 가능한 고객을 선택하세요."));
      return;
    }
    if (
      selected.data.branchId !== branch ||
      selected.data.status !== "사용 가능"
    ) {
      setError(new Error("선택한 지점에서 사용 가능한 룸을 선택하세요."));
      return;
    }
    if (
      !date ||
      !Number.isFinite(Date.parse(startAt)) ||
      Date.parse(startAt) <= now
    ) {
      setError(new Error("현재 이후의 정시를 선택하세요."));
      return;
    }
    const body: RoomReservationCreate = {
      branchId: branch,
      roomId,
      customerId,
      startAt,
      endAt,
      partySize,
      method,
      mockOutcome: outcome,
    };
    try {
      const result = await write.run(
        "room-reservations:create",
        body,
        (signal, key) => roomApi.createReservation(scope, body, signal, key),
      );
      leave.saved();
      onSaved(result);
    } catch (e) {
      if (abortError(e)) return;
      setError(e as Error);
      if (e instanceof ApiError) {
        if ([401, 403, 404].includes(e.status)) setBlocked(true);
        if (
          e.detail.code === "ROOM_TIME_CONFLICT" ||
          e.detail.code === "BRANCH_CLOSED_DAY"
        ) {
          setShowSchedule(true);
          void query.invalidateQueries({
            queryKey: ["data", session.user.id, scope, "room-reservations"],
          });
        }
      }
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)}>
      {leave.guard}
      {previous && (
        <p className="tip mb-4">
          취소된 원래 예약과 결제는 유지하고, 새 예약·새 결제로 등록합니다.
        </p>
      )}
      <fieldset disabled={write.busy || blocked} className="grid gap-4">
        <Field label="예약 지점">
          <select
            aria-label="예약 지점"
            required
            value={branch}
            onChange={(e) => {
              touch();
              setError(null);
              setBranch(e.target.value);
              setRoomId("");
              setCustomerId("");
              setRoomPage(1);
              setShowSchedule(false);
            }}
          >
            <option value="">지점 선택</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="예약 룸">
          <select
            aria-label="예약 룸"
            required
            value={roomId}
            disabled={rooms.isPending || !!rooms.error}
            onChange={(e) => {
              touch();
              setRoomId(e.target.value);
              setShowSchedule(false);
            }}
          >
            <option value="">룸 선택</option>
            {roomId && !rooms.data?.items.some((r) => r.id === roomId) && (
              <option value={roomId}>{previous?.room.name ?? "선택 룸"}</option>
            )}
            {rooms.data?.items.map((r) => (
              <option key={r.id} value={r.id}>
                {r.roomNo} · {r.name} · {r.capacity}명
              </option>
            ))}
          </select>
        </Field>
        {rooms.error && (
          <ErrorState error={rooms.error} retry={() => void rooms.refetch()} />
        )}
        {rooms.data && rooms.data.meta.total > 100 && (
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={roomPage === 1}
              onClick={() => setRoomPage((p) => p - 1)}
            >
              룸 이전
            </Button>
            <Button
              type="button"
              disabled={roomPage * 100 >= rooms.data.meta.total}
              onClick={() => setRoomPage((p) => p + 1)}
            >
              룸 다음
            </Button>
          </div>
        )}
        <CustomerSelector
          value={customerId}
          onChange={(id) => {
            touch();
            setCustomerId(id);
          }}
        />
        <Field label="예약 날짜">
          <input
            aria-label="예약 날짜"
            type="date"
            required
            value={date}
            onChange={(e) => {
              touch();
              setError(null);
              setDate(e.target.value);
            }}
          />
        </Field>
        {closed && (
          <p role="status">지점 휴무일에는 새 예약을 시작할 수 없어요.</p>
        )}
        <Field label="시작 시각 (한국 시간)">
          <select
            aria-label="시작 시각 (한국 시간)"
            value={hour}
            disabled={closed || checkingSchedule}
            onChange={(e) => {
              touch();
              setHour(Number(e.target.value));
            }}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option value={h} key={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </Field>
        <Field label="이용 시간">
          <select
            aria-label="이용 시간"
            value={hours}
            disabled={closed || checkingSchedule}
            onChange={(e) => {
              touch();
              setHours(Number(e.target.value));
            }}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option value={h + 1} key={h}>
                {h + 1}시간
              </option>
            ))}
          </select>
        </Field>
        <Field label="이용 인원">
          <input
            aria-label="이용 인원"
            type="number"
            min={1}
            max={selected.data?.capacity ?? 65535}
            required
            value={partySize}
            onChange={(e) => {
              touch();
              setPartySize(Number(e.target.value));
            }}
          />
        </Field>
        {selected.error ? (
          <ErrorState
            error={selected.error}
            retry={() => void selected.refetch()}
          />
        ) : (
          selected.data && (
            <p>
              시간당 요금 {won(selected.data.ratePerHourKrw)} · 정원{" "}
              {selected.data.capacity}명<br />
              최종 결제 금액은 등록 후 서버 확정 결과에서 확인합니다.
            </p>
          )
        )}
        <p className="tip">Mock 결제 · 실제 금전 이동 없음</p>
        <Field label="결제 수단">
          <select
            aria-label="결제 수단"
            value={method}
            onChange={(e) => {
              touch();
              setMethod(e.target.value as RoomReservationCreate["method"]);
            }}
          >
            {["카드", "현금", "계좌이체", "기타"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="Mock 결제 결과">
          <select
            aria-label="Mock 결제 결과"
            value={outcome}
            onChange={(e) => {
              touch();
              setOutcome(e.target.value as typeof outcome);
            }}
          >
            <option value="APPROVED">승인</option>
            <option value="FAILED">실패</option>
          </select>
        </Field>
      </fieldset>
      <WriteError error={error} />
      {error instanceof ApiError &&
        error.detail.code === "ROOM_TIME_CONFLICT" && (
          <section className="my-4">
            <p>
              선택 시간이 다른 예약과 겹칩니다. 최신 일정을 확인하고 시간을
              변경하세요.
            </p>
            <Button
              type="button"
              disabled={write.busy}
              onClick={() => {
                setShowSchedule(true);
                void schedule.refetch();
              }}
            >
              최신 일정 확인
            </Button>
          </section>
        )}
      {showSchedule &&
        (!Number.isFinite(Date.parse(stamp(date))) ? (
          <p>조회할 예약 날짜를 선택하세요.</p>
        ) : schedule.isPending ? (
          <p role="status">일정 조회 중…</p>
        ) : schedule.error ? (
          <ErrorState
            error={schedule.error}
            retry={() => void schedule.refetch()}
          />
        ) : (
          <section aria-label="최신 예약 일정">
            {schedule.data?.items.length ? (
              schedule.data.items.map((r) => (
                <p key={r.id}>
                  {displayTime(r.startAt)} ~ {displayTime(r.endAt)} · {r.status}
                </p>
              ))
            ) : (
              <p>이 기간의 예약이 없습니다.</p>
            )}
          </section>
        ))}
      {blocked && (
        <p role="alert">
          권한 또는 조회 범위가 변경되었습니다. 화면을 새로고침하세요.
        </p>
      )}
      <Button
        type="submit"
        variant="primary"
        className="mt-5"
        disabled={
          write.busy ||
          blocked ||
          !branches.length ||
          closed ||
          checkingSchedule
        }
      >
        {write.busy ? "등록 중…" : "예약 등록"}
      </Button>
    </form>
  );
}
