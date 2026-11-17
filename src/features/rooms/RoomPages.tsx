import { useTableSort } from "../../shared/ui/table-sort";
import { readListPage } from "../../shared/api/read-sorted-pages";
import {
  ListCard,
  ListFilters,
  ListFooter,
  ListTable,
} from "../../shared/ui/ListLayout";
import { Icon } from "../../shared/ui/Icon";
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
import { roomApi } from "./api";
import type { Room, RoomReservation } from "./model";
import { RoomPanel } from "./RoomPanel";
import { ReservationPanel } from "./ReservationPanel";
import { displayTime, stamp } from "./shared";
import { shiftDay, startOfWeek } from "../../shared/ui/WeekTimeGrid";
import { WeekCalendar } from "./WeekCalendar";

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
  const sorting = useTableSort(
    { sort: "roomNo", direction: "asc" },
    "room",
    "page",
  );
  const data = useQuery({
    queryKey: [
      "data",
      session.user.id,
      scope,
      "rooms",
      "list",
      page,
      status,
      params.get("roomSort"),
      sorting.value.direction,
    ],
    queryFn: ({ signal }) => {
      const value = params.has("roomSort")
        ? sorting.fallback({
            roomNo: (r: Room) => r.roomNo,
            branch: (r: Room) =>
              session.branches.find((b) => b.id === r.branchId)?.name ??
              r.branchId,
            capacity: (r: Room) => r.capacity,
            rate: (r: Room) => r.ratePerHourKrw,
            status: (r: Room) => r.status,
          })
        : undefined;
      return readListPage<Awaited<ReturnType<typeof roomApi.rooms>>>(
        (page, pageSize) =>
          roomApi.rooms(
            scope,
            { page, pageSize, status: status as "사용 가능" | "운영 중단" },
            signal,
          ),
        page,
        20,
        sorting.value.direction,
        value,
      );
    },
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
      />
      <ListCard>
        <ListFilters
          actions={
            writable && (
              <Button variant="primary" onClick={() => change("detail", "new")}>
                <Icon name="plus" size={16} />
                스터디룸 등록
              </Button>
            )
          }
        >
          <select
            aria-label="룸 운영 상태 필터"
            value={status}
            onChange={(e) => change("status", e.target.value)}
          >
            <option value="">전체 운영 상태</option>
            <option>사용 가능</option>
            <option>운영 중단</option>
          </select>
        </ListFilters>
        <ListTable
          label="스터디룸 목록"
          columns={[
            sorting.column("룸", "roomNo"),
            sorting.column("지점", "branch"),
            sorting.column("정원", "capacity"),
            sorting.column("시간당 요금", "rate"),
            sorting.column("운영 상태", "status"),
          ]}
          loading={data.isPending}
          error={!data.data || hasBlockingReadError(data) ? data.error : null}
          onRetry={() => void data.refetch()}
          isEmpty={!data.data?.items.length}
          empty={{ title: "등록된 스터디룸이 없어요" }}
        >
          {data.data?.items.map((r) => (
            <tr key={r.id}>
              <td>
                <button
                  type="button"
                  className="cell-link"
                  onClick={() => change("detail", r.id)}
                >
                  {r.roomNo} · {r.name}
                </button>
              </td>
              <td>
                {session.branches.find((b) => b.id === r.branchId)?.name ??
                  r.branchId}
              </td>
              <td>{r.capacity}명</td>
              <td>{won(r.ratePerHourKrw)}</td>
              <td>
                <Badge>{r.status}</Badge>
              </td>
            </tr>
          ))}
        </ListTable>
        <ListFooter
          page={data.data?.meta.page ?? page}
          pageSize={data.data?.meta.pageSize ?? 20}
          total={data.data?.meta.total ?? 0}
          loading={data.isPending}
          error={!!data.error}
          onChange={(p) => change("page", String(p))}
        />
      </ListCard>
      {params.get("detail") && (
        <RoomPanel id={params.get("detail")!} onClose={close} />
      )}
    </section>
  );
}
export function Reservations({ embedded = false }: { embedded?: boolean }) {
  const { session, scope } = useApp(),
    { params, change, close } = useParamsState();
  const [branchFilter, setBranch] = useState("");
  const branch = scope === "all" ? branchFilter : scope;
  const calendarBranches = branch
    ? session.branches.filter((b) => b.id === branch)
    : session.branches;
  const raw = Number(params.get("page") ?? 1),
    page = Number.isInteger(raw) && raw > 0 ? raw : 1;
  const today = businessDate(session.asOf);
  const week = startOfWeek(params.get("week") ?? params.get("from") ?? today);
  const weekEnd = shiftDay(week, 7);
  const from = params.get("from") ?? week,
    to = params.get("to") ?? shiftDay(from, 7),
    roomId = params.get("roomId") ?? "",
    view = params.get("view") ?? "calendar",
    status = params.get("status") ?? "";
  const listView = view === "list";
  const validListRange =
    !!from &&
    !!to &&
    Date.parse(to) > Date.parse(from) &&
    Date.parse(to) - Date.parse(from) <= 62 * 86400000;
  const selectedScope = scope === "all" ? branch || "all" : scope;
  const sorting = useTableSort(
    { sort: "start", direction: "asc" },
    "reservation",
    "page",
  );
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
      params.get("reservationSort"),
      sorting.value.direction,
    ],
    queryFn: ({ signal }) => {
      const value = params.has("reservationSort")
        ? sorting.fallback({
            room: (r: RoomReservation) => `${r.room.name} · ${r.customer.name}`,
            start: (r: RoomReservation) => Date.parse(r.startAt),
            status: (r: RoomReservation) => r.status,
            amount: (r: RoomReservation) => r.billing?.amountKrw,
          })
        : undefined;
      return readListPage<Awaited<ReturnType<typeof roomApi.reservations>>>(
        (page, pageSize) =>
          roomApi.reservations(
            selectedScope,
            {
              page,
              pageSize,
              roomId,
              status: status as RoomReservation["status"],
              from: stamp(from),
              to: stamp(to),
            },
            signal,
          ),
        page,
        20,
        sorting.value.direction,
        value,
      );
    },
    enabled: listView && validListRange,
    retry: false,
  });
  const calendar = useQuery({
    queryKey: [
      "data",
      session.user.id,
      scope,
      "room-reservations",
      "calendar",
      calendarBranches.map((b) => b.id),
      week,
      branch ? roomId : "",
    ],
    queryFn: ({ signal }) =>
      Promise.all(
        calendarBranches.map(async (b) => ({
          branchName: b.name,
          ...(await roomApi.calendar(
            b.id,
            stamp(week),
            stamp(weekEnd),
            branch ? roomId : undefined,
            signal,
          )),
        })),
      ),
    enabled: !listView && !!week,
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
  const items = list.data?.items ?? [];
  const bookings = (calendar.data ?? []).flatMap(({ branchName, items }) =>
    items
      .filter(
        (r) =>
          (!status || r.status === status) && (!roomId || r.room.id === roomId),
      )
      .map((reservation) => ({ reservation, branchName })),
  );
  return (
    <section className={embedded ? "" : "page"}>
      <Heading
        title="스터디룸 예약"
        description="한국 시간 기준의 예약 일정과 실제 이용 상태를 확인하세요."
      />
      <ListCard>
        <ListFilters
          actions={
            writable && (
              <Button variant="primary" onClick={() => show("new")}>
                <Icon name="plus" size={16} />
                예약 등록
              </Button>
            )
          }
        >
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
              <option value="">전체 지점</option>
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
          {listView && (
            <>
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
            </>
          )}
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
          <div
            className="reservation-view-switch"
            role="group"
            aria-label="예약 보기 방식"
          >
            <Button
              aria-pressed={!listView}
              onClick={() => change("view", "calendar")}
            >
              주간 달력
            </Button>
            <Button
              aria-pressed={listView}
              onClick={() => change("view", "list")}
            >
              목록 보기
            </Button>
          </div>
        </ListFilters>
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
        {!listView && (
          <div className="week-calendar-toolbar">
            <div className="week-calendar-controls">
              <Button
                aria-label="이전 주"
                disabled={!week}
                onClick={() => change("week", shiftDay(week, -7))}
              >
                ‹
              </Button>
              <Button onClick={() => change("week", startOfWeek(today))}>
                이번 주
              </Button>
              <Button
                aria-label="다음 주"
                disabled={!week}
                onClick={() => change("week", weekEnd)}
              >
                ›
              </Button>
            </div>
            {week && (
              <h2>
                {week.replaceAll("-", ".")} –{" "}
                {shiftDay(week, 6).replaceAll("-", ".")}
              </h2>
            )}
            <span>한국 시간</span>
          </div>
        )}
        {listView ? (
          <>
            <ListTable
              label="스터디룸 예약 목록"
              columns={[
                sorting.column("룸 · 고객", "room"),
                sorting.column("예약 시간", "start"),
                sorting.column("상태", "status"),
                sorting.column("확정 결제 금액", "amount"),
              ]}
              state={
                !validListRange && (
                  <State
                    title="조회 기간을 확인하세요"
                    message="시작일보다 뒤인 종료일을 선택하세요. 최대 62일을 조회할 수 있습니다."
                  />
                )
              }
              loading={list.isPending}
              error={list.error}
              onRetry={() => void list.refetch()}
              isEmpty={!items.length}
              empty={{ title: "조회 기간의 예약이 없어요" }}
            >
              {items.map((r) => (
                <tr key={r.id}>
                  <td>
                    <button
                      type="button"
                      className="cell-link"
                      onClick={() => show(r.id)}
                    >
                      {r.room.name} · {r.customer.name}
                    </button>
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
            </ListTable>
            {validListRange && (
              <ListFooter
                page={list.data?.meta.page ?? page}
                pageSize={list.data?.meta.pageSize ?? 20}
                total={list.data?.meta.total ?? 0}
                loading={list.isPending}
                error={!!list.error}
                onChange={(p) => change("page", String(p))}
              />
            )}
          </>
        ) : !week ? (
          <State
            title="조회 기간을 확인하세요"
            message="이번 주 버튼으로 조회 기간을 다시 선택할 수 있습니다."
          />
        ) : calendar.isPending ? (
          <State loading />
        ) : calendar.error ? (
          <ErrorState
            error={calendar.error}
            retry={() => void calendar.refetch()}
          />
        ) : (
          <WeekCalendar
            week={week}
            today={today}
            bookings={bookings}
            calendars={calendar.data ?? []}
            showBranch={!branch}
            show={show}
          />
        )}
      </ListCard>
      <p className="help mt-3">
        {listView
          ? "종료일은 조회 기간에 포함되지 않습니다."
          : "결제 실패 예약은 목록 보기에서 확인할 수 있습니다."}
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
