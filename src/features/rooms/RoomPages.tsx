import { hasBlockingReadError } from "../../shared/api/read-model";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { useApp } from "../../app/context";
import { can, businessDate, won } from "../../shared/domain/schema";
import {
  Badge,
  Button,
  ErrorState,
  Heading,
  State,
} from "../../shared/ui/primitives";
import { Pager } from "../organization/shared";
import { roomApi } from "./api";
import type { RoomReservation } from "./model";
import { RoomPanel } from "./RoomPanel";
import { ReservationPanel } from "./ReservationPanel";
import { displayTime, stamp } from "./shared";

function useParamsState() {
  const [params, setParams] = useSearchParams();
  const change = (key: string, v: string) =>
    setParams((p) => {
      if (v) p.set(key, v);
      else p.delete(key);
      if (key !== "page" && key !== "detail") p.delete("page");
      return p;
    });
  const close = () =>
    setParams((p) => {
      p.delete("detail");
      p.delete("edit");
      p.delete("action");
      return p;
    });
  return { params, change, close };
}
export function Rooms({ embedded = false }: { embedded?: boolean }) {
  const { session, scope } = useApp(),
    { params, change, close } = useParamsState();
  const raw = Number(params.get("page") ?? 1),
    page = Number.isInteger(raw) && raw > 0 ? raw : 1,
    status = params.get("status") ?? "";
  const data = useQuery({
    queryKey: ["data", session.user.id, scope, "rooms", "list", page, status],
    queryFn: ({ signal }) =>
      roomApi.rooms(
        scope,
        { page, status: status as "사용 가능" | "운영 중단" },
        signal,
      ),
    retry: false,
  });
  const writable = session.branches.some(
    (b) =>
      (scope === "all" || b.id === scope) &&
      can(session.user, b.id, "operations:write"),
  );
  return (
    <section className={embedded ? "" : "page"}>
      <Heading
        title="스터디룸 관리"
        description="룸의 정원·시간당 요금과 운영 상태를 관리하세요."
      >
        <Button onClick={() => void data.refetch()}>새로고침</Button>
      </Heading>
      <div className="card overflow-hidden">
        <div className="filters">
          <select
            aria-label="룸 운영 상태 필터"
            value={status}
            onChange={(e) => change("status", e.target.value)}
          >
            <option value="">전체 운영 상태</option>
            <option>사용 가능</option>
            <option>운영 중단</option>
          </select>
          {writable && (
            <Button
              variant="primary"
              className="ml-auto"
              onClick={() => change("detail", "new")}
            >
              스터디룸 등록
            </Button>
          )}
        </div>
        {data.isPending ? (
          <State loading />
        ) : !data.data || hasBlockingReadError(data) ? (
          <ErrorState error={data.error!} retry={() => void data.refetch()} />
        ) : data.data.items.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-[600px]">
              <thead>
                <tr>
                  <th>룸</th>
                  <th>지점</th>
                  <th>정원</th>
                  <th>시간당 요금</th>
                  <th>운영 상태</th>
                </tr>
              </thead>
              <tbody>
                {data.data.items.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Button onClick={() => change("detail", r.id)}>
                        {r.roomNo} · {r.name}
                      </Button>
                    </td>
                    <td>
                      {session.branches.find((b) => b.id === r.branchId)
                        ?.name ?? r.branchId}
                    </td>
                    <td>{r.capacity}명</td>
                    <td>{won(r.ratePerHourKrw)}</td>
                    <td>
                      <Badge>{r.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <State title="등록된 스터디룸이 없어요" />
        )}
        {data.data && !hasBlockingReadError(data) && (
          <Pager
            page={data.data.meta.page}
            total={data.data.meta.total}
            onChange={(p) => change("page", String(p))}
          />
        )}
      </div>
      {params.get("detail") && (
        <RoomPanel id={params.get("detail")!} onClose={close} />
      )}
    </section>
  );
}
function shiftDay(date: string, days: number) {
  const time = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(time)
    ? new Date(time + days * 86400000).toISOString().slice(0, 10)
    : "";
}
export function Reservations({ embedded = false }: { embedded?: boolean }) {
  const { session, scope } = useApp(),
    { params, change, close } = useParamsState();
  const [branch, setBranch] = useState(
    scope !== "all"
      ? scope
      : session.branches.length === 1
        ? session.branches[0].id
        : "",
  );
  const raw = Number(params.get("page") ?? 1),
    page = Number.isInteger(raw) && raw > 0 ? raw : 1;
  const from = params.get("from") ?? businessDate(session.asOf),
    to = params.get("to") ?? shiftDay(from, 7),
    roomId = params.get("roomId") ?? "",
    view = params.get("view") ?? "calendar",
    status = params.get("status") ?? "";
  const validRange =
    !!from &&
    !!to &&
    Date.parse(to) > Date.parse(from) &&
    Date.parse(to) - Date.parse(from) <= 62 * 86400000;
  const selectedScope = scope === "all" ? branch || "all" : scope;
  const list = useQuery({
    queryKey: [
      "data",
      session.user.id,
      scope,
      "room-reservations",
      "list",
      selectedScope,
      page,
      from,
      to,
      roomId,
      status,
    ],
    queryFn: ({ signal }) =>
      roomApi.reservations(
        selectedScope,
        {
          page,
          roomId,
          status: status as RoomReservation["status"],
          from: stamp(from),
          to: stamp(to),
        },
        signal,
      ),
    enabled: view === "list" && validRange,
    retry: false,
  });
  const calendar = useQuery({
    queryKey: [
      "data",
      session.user.id,
      scope,
      "room-reservations",
      "calendar",
      branch,
      from,
      to,
      roomId,
    ],
    queryFn: ({ signal }) =>
      roomApi.calendar(branch, stamp(from), stamp(to), roomId, signal),
    enabled: view === "calendar" && !!branch && validRange,
    retry: false,
  });
  const [roomPage, setRoomPage] = useState(1);
  const rooms = useQuery({
    queryKey: [
      "data",
      session.user.id,
      scope,
      "rooms",
      "filter",
      selectedScope,
      roomPage,
    ],
    queryFn: ({ signal }) =>
      roomApi.rooms(selectedScope, { page: roomPage, pageSize: 100 }, signal),
    retry: false,
  });
  const writable = session.branches.some(
    (b) =>
      (scope === "all" || b.id === scope) &&
      b.status === "운영 중" &&
      can(session.user, b.id, "payments:write"),
  );
  const show = (id: string) => change("detail", id);
  const current = view === "calendar" ? calendar : list;
  const items =
    view === "calendar"
      ? (calendar.data?.items ?? []).filter(
          (r) => !status || r.status === status,
        )
      : (list.data?.items ?? []);
  return (
    <section className={embedded ? "" : "page"}>
      <Heading
        title="스터디룸 예약"
        description="한국 시간 기준의 예약 일정과 실제 이용 상태를 확인하세요."
      >
        <Button
          onClick={() => {
            void list.refetch();
            if (branch) void calendar.refetch();
          }}
        >
          새로고침
        </Button>
      </Heading>
      <div className="card overflow-hidden">
        <div className="filters">
          {scope === "all" && (
            <select
              aria-label="예약 지점 필터"
              value={branch}
              onChange={(e) => {
                setBranch(e.target.value);
                setRoomPage(1);
                change("roomId", "");
              }}
            >
              <option value="">전체 지점 (목록)</option>
              {session.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
          <select
            aria-label="예약 룸 필터"
            value={roomId}
            disabled={!!rooms.error}
            onChange={(e) => change("roomId", e.target.value)}
          >
            <option value="">전체 룸</option>
            {roomId && !rooms.data?.items.some((r) => r.id === roomId) && (
              <option value={roomId}>선택 룸</option>
            )}
            {rooms.data?.items.map((r) => (
              <option key={r.id} value={r.id}>
                {r.roomNo} · {r.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            aria-label="조회 시작일"
            required
            value={from}
            onChange={(e) => change("from", e.target.value)}
          />
          <input
            type="date"
            aria-label="조회 종료일 (미포함)"
            required
            value={to}
            onChange={(e) => change("to", e.target.value)}
          />
          <select
            aria-label="예약 상태 필터"
            value={status}
            onChange={(e) => change("status", e.target.value)}
          >
            <option value="">전체 상태</option>
            {["확정", "이용 중", "완료", "취소", "결제 실패"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <Button
            aria-pressed={view === "calendar"}
            onClick={() => change("view", "calendar")}
          >
            달력 보기
          </Button>
          <Button
            aria-pressed={view === "list"}
            onClick={() => change("view", "list")}
          >
            목록 보기
          </Button>
          {writable && (
            <Button
              variant="primary"
              className="ml-auto"
              onClick={() => show("new")}
            >
              예약 등록
            </Button>
          )}
        </div>
        {rooms.data && rooms.data.meta.total > 100 && (
          <div className="flex gap-2 px-4">
            <Button
              disabled={roomPage === 1}
              onClick={() => setRoomPage((p) => p - 1)}
            >
              룸 필터 이전
            </Button>
            <Button
              disabled={roomPage * 100 >= rooms.data.meta.total}
              onClick={() => setRoomPage((p) => p + 1)}
            >
              룸 필터 다음
            </Button>
          </div>
        )}
        {rooms.error && (
          <ErrorState error={rooms.error} retry={() => void rooms.refetch()} />
        )}
        {!validRange ? (
          <State
            title="조회 기간을 확인하세요"
            message="시작일보다 뒤인 종료일을 선택하세요. 최대 62일을 조회할 수 있습니다."
          />
        ) : view === "calendar" && !branch ? (
          <State
            title="달력을 볼 지점을 선택하세요"
            message="전체 지점은 목록 보기로 확인할 수 있습니다."
          />
        ) : current.isPending ? (
          <State loading />
        ) : current.error ? (
          <ErrorState
            error={current.error}
            retry={() => void current.refetch()}
          />
        ) : view === "calendar" ? (
          <Calendar
            from={from}
            to={to}
            rows={items}
            closedDates={calendar.data?.closedDates}
            show={show}
          />
        ) : items.length ? (
          <ReservationTable rows={items} show={show} />
        ) : (
          <State title="조회 기간의 예약이 없어요" />
        )}
        {view === "list" && list.data && !list.error && (
          <Pager
            page={list.data.meta.page}
            total={list.data.meta.total}
            onChange={(p) => change("page", String(p))}
          />
        )}
      </div>
      <p className="help mt-3">
        종료일은 조회 기간에 포함되지 않습니다. 달력은 결제 실패 예약을
        제외하며, 목록에서 확인할 수 있습니다.
      </p>
      {params.get("detail") && (
        <ReservationPanel
          id={params.get("detail")!}
          onClose={close}
          onSelected={show}
        />
      )}
    </section>
  );
}
function ReservationTable({
  rows,
  show,
}: {
  rows: RoomReservation[];
  show: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[660px]">
        <thead>
          <tr>
            <th>룸 · 고객</th>
            <th>예약 시간</th>
            <th>상태</th>
            <th>확정 결제 금액</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <Button onClick={() => show(r.id)}>
                  {r.room.name} · {r.customer.name}
                </Button>
              </td>
              <td>
                {displayTime(r.startAt)} ~ {displayTime(r.endAt)}
              </td>
              <td>
                <Badge>{r.status}</Badge>
              </td>
              <td>{r.billing ? won(r.billing.amountKrw) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Calendar({
  from,
  to,
  rows,
  closedDates,
  show,
}: {
  from: string;
  to: string;
  closedDates?: string[];
  rows: RoomReservation[];
  show: (id: string) => void;
}) {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
  return (
    <div
      className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3"
      aria-label="예약 달력"
    >
      {Array.from({ length: days }, (_, offset) => {
        const date = shiftDay(from, offset),
          begin = Date.parse(stamp(date)),
          end = begin + 86400000,
          events = rows.filter(
            (r) => Date.parse(r.startAt) < end && Date.parse(r.endAt) > begin,
          );
        return (
          <section
            className="rounded-lg border border-line p-3 min-w-0"
            key={date}
          >
            <h3>{date}</h3>
            {closedDates?.includes(date) && (
              <p className="help">지점 휴무 · 새 예약 시작 불가</p>
            )}
            {events.length ? (
              events.map((r) => (
                <Button
                  key={r.id}
                  className="my-1 w-full whitespace-normal text-left"
                  onClick={() => show(r.id)}
                >
                  {r.room.name} · {r.customer.name}
                  <br />
                  {displayTime(r.startAt)} ~ {displayTime(r.endAt)} · {r.status}
                </Button>
              ))
            ) : (
              <p className="help">예약 없음</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
