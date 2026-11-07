import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { can, won } from "../../shared/domain/schema";
import { ApiError } from "../../shared/api/client";
import { Button, ErrorState, Panel, State } from "../../shared/ui/primitives";
import { Field } from "../organization/shared";
import { roomApi } from "./api";
import type { Room, RoomCreate, RoomUpdate, SpaceStatusChange } from "./model";
import { useRoomWrite, useRoomLeaveGuard } from "./hooks";
import { WriteError, abortError, keyFor } from "./shared";

export function RoomPanel(props: { id: string; onClose: () => void }) {
  const { session, scope } = useApp();
  return (
    <RoomSession
      key={JSON.stringify([props.id, scope, session.user])}
      {...props}
    />
  );
}
function RoomSession({ id, onClose }: { id: string; onClose: () => void }) {
  const { session, scope } = useApp(),
    [mode, setMode] = useState("");
  const row = useQuery({
    queryKey: keyFor(session.user.id, scope, "rooms", id),
    queryFn: ({ signal }) => roomApi.room(scope, id, signal),
    enabled: id !== "new",
    retry: false,
  });
  const editable =
    row.data && can(session.user, row.data.branchId, "operations:write");
  const creatable = session.branches.some(
    (b) =>
      (scope === "all" || b.id === scope) &&
      can(session.user, b.id, "operations:write"),
  );
  return (
    <Panel
      open
      title={
        id === "new"
          ? "스터디룸 등록"
          : ((row.error ? undefined : row.data?.name) ?? "스터디룸 상세")
      }
      onClose={onClose}
    >
      {id === "new" ? (
        creatable ? (
          <RoomForm onSaved={onClose} />
        ) : (
          <State title="등록 권한이 없어요" />
        )
      ) : row.isPending ? (
        <State loading />
      ) : row.error ? (
        <ErrorState error={row.error} retry={() => void row.refetch()} />
      ) : (
        row.data && (
          <>
            {mode && editable ? (
              <RoomForm
                key={mode}
                room={row.data}
                mode={mode}
                onSaved={() => setMode("")}
              />
            ) : (
              <>
                <RoomInfo room={row.data} />
                {editable && (
                  <div className="mt-6 flex gap-2">
                    <Button onClick={() => setMode("edit")}>수정하기</Button>
                    <Button onClick={() => setMode("status")}>
                      {row.data.status === "운영 중단"
                        ? "운영 재개"
                        : "운영 중단"}
                    </Button>
                  </div>
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
export function RoomInfo({ room }: { room: Room }) {
  const { session } = useApp();
  return (
    <dl className="grid gap-3">
      {[
        [
          "지점",
          session.branches.find((b) => b.id === room.branchId)?.name ??
            room.branchId,
        ],
        ["룸 번호", room.roomNo],
        ["룸 이름", room.name],
        ["정원", `${room.capacity}명`],
        ["시간당 요금", won(room.ratePerHourKrw)],
        ["운영 상태", room.status],
      ].map(([label, v]) => (
        <div key={label}>
          <dt className="text-muted">{label}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
function RoomForm({
  room,
  mode = "edit",
  onSaved,
}: {
  room?: Room;
  mode?: string;
  onSaved: () => void;
}) {
  const { session, scope } = useApp(),
    write = useRoomWrite("rooms", "reservations", "lookups");
  const branches = session.branches.filter(
    (b) =>
      (scope === "all" || b.id === scope) &&
      can(session.user, b.id, "operations:write"),
  );
  const [original] = useState(room),
    [branch, setBranch] = useState(
      room?.branchId ?? (branches.length === 1 ? branches[0].id : ""),
    );
  const [draft, setDraft] = useState({
    roomNo: room?.roomNo ?? "",
    name: room?.name ?? "",
    capacity: String(room?.capacity ?? 1),
    ratePerHourKrw: String(room?.ratePerHourKrw ?? 8000),
    reason: "",
  });
  const [latest, setLatest] = useState<Room>(),
    [error, setError] = useState<Error | null>(null),
    [blocked, setBlocked] = useState(false),
    [dirty, setDirty] = useState(false);
  const leave = useRoomLeaveGuard(dirty);
  const change = (key: keyof typeof draft, v: string) => {
    setDirty(true);
    setDraft((d) => ({ ...d, [key]: v }));
  };
  async function compare() {
    if (!room) return;
    try {
      const value = await write.run(
        "room:compare",
        {},
        (signal) => roomApi.room(scope, room.id, signal),
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
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (write.busy || blocked || !can(session.user, branch, "operations:write"))
      return;
    setError(null);
    const body: Record<string, unknown> = room
      ? { version: (latest ?? original)!.version }
      : { branchId: branch };
    if (mode === "status" && room) {
      body.status =
        original!.status === "운영 중단" ? "사용 가능" : "운영 중단";
      body.reason = draft.reason;
    } else
      for (const key of [
        "roomNo",
        "name",
        "capacity",
        "ratePerHourKrw",
      ] as const) {
        const value =
          key === "capacity" || key === "ratePerHourKrw"
            ? Number(draft[key])
            : draft[key];
        if (!room || value !== original?.[key]) body[key] = value;
      }
    if (room && Object.keys(body).length === 1) {
      setError(new Error("변경할 내용을 입력하세요."));
      return;
    }
    try {
      await write.run(
        `room:${room?.id ?? "new"}:${mode}`,
        body,
        (signal, key) =>
          room
            ? mode === "status"
              ? roomApi.roomStatus(
                  scope,
                  room.id,
                  body as SpaceStatusChange,
                  signal,
                )
              : roomApi.updateRoom(scope, room.id, body as RoomUpdate, signal)
            : roomApi.createRoom(scope, body as RoomCreate, signal, key),
        true,
        room ? keyFor(session.user.id, scope, "rooms", room.id) : undefined,
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
        {!room && (
          <Field label="지점">
            <select
              aria-label="지점"
              required
              value={branch}
              onChange={(e) => {
                setDirty(true);
                setBranch(e.target.value);
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
        )}
        {mode === "status" && room ? (
          <>
            <p>
              {original!.status === "운영 중단"
                ? "운영을 재개합니다."
                : "운영을 중단해도 기존 예약은 유지됩니다. 필요한 예약은 별도로 취소해 주세요."}
            </p>
            <Field label="운영 변경 사유">
              <textarea
                aria-label="운영 변경 사유"
                required
                maxLength={500}
                value={draft.reason}
                onChange={(e) => change("reason", e.target.value)}
              />
            </Field>
          </>
        ) : (
          <>
            {(
              [
                ["룸 번호", "roomNo"],
                ["룸 이름", "name"],
                ["정원", "capacity"],
                ["시간당 요금 (원)", "ratePerHourKrw"],
              ] as const
            ).map(([label, key]) => (
              <Field key={key} label={label}>
                <input
                  aria-label={label}
                  required
                  type={
                    key === "capacity" || key === "ratePerHourKrw"
                      ? "number"
                      : "text"
                  }
                  min={1}
                  max={key === "capacity" ? 65535 : undefined}
                  maxLength={key === "roomNo" ? 40 : 120}
                  value={draft[key]}
                  onChange={(e) => change(key, e.target.value)}
                />
              </Field>
            ))}
          </>
        )}
      </fieldset>
      <WriteError
        error={error}
        refresh={() => void compare()}
        latest={latest && <RoomInfo room={latest} />}
      />
      {blocked && (
        <p role="alert">권한이 변경되었습니다. 화면을 새로고침하세요.</p>
      )}
      <Button
        type="submit"
        variant="primary"
        className="mt-5"
        disabled={
          write.busy ||
          blocked ||
          (error instanceof ApiError &&
            error.detail.code === "VERSION_CONFLICT" &&
            !latest)
        }
      >
        {write.busy
          ? "저장 중…"
          : latest
            ? "최신 기준으로 다시 저장"
            : "저장하기"}
      </Button>
    </form>
  );
}
