import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { api, queryString } from "../../shared/api/client";
import { invalidateReads } from "../../shared/api/invalidateReads";
import { useIdempotency } from "../../shared/api/useIdempotency";
import {
  shiftClosureDate,
  type BranchClosure,
  type ClosureCreated,
  type ClosureList,
} from "../../shared/domain/closures";
import { admin, businessDate, can } from "../../shared/domain/schema";
import { formatDateTime } from "../../shared/domain/format";
import { Button, ErrorState, State } from "../../shared/ui/primitives";
import { useSalesClock } from "../payments/shared";
import { Field } from "./shared";
import type { Branch } from "./model";

export function BranchClosures({ branch }: { branch: Branch }) {
  const { session, scope } = useApp();
  const query = useQueryClient();
  const idempotency = useIdempotency();
  const now = useSalesClock();
  const today = businessDate(new Date(now).toISOString());
  const [range, setRange] = useState(() => ({
    from: today,
    to: shiftClosureDate(today, 90),
  }));
  const [draftRange, setDraftRange] = useState(range);
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<BranchClosure | null>(null);
  const [editNote, setEditNote] = useState("");
  const [created, setCreated] = useState<ClosureCreated | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const writable = admin(session.user, branch.id);
  const path = `/branches/${branch.id}/closures`;
  const list = useQuery({
    queryKey: [
      "data",
      session.user.id,
      scope,
      "branch-closures",
      branch.id,
      range,
    ],
    queryFn: ({ signal }) =>
      api<ClosureList>(`${path}?${queryString(range)}`, { signal }),
    retry: false,
  });

  async function save(action: () => Promise<unknown>) {
    if (busy || !writable) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      await invalidateReads(
        query,
        session.user.id,
        "branch-closures",
        "home",
        "room-reservations",
      );
    } catch (e) {
      setError(e as Error);
      void list.refetch();
    } finally {
      setBusy(false);
    }
  }

  function register(event: FormEvent) {
    event.preventDefault();
    void save(async () => {
      const body = { date, ...(note.trim() ? { note: note.trim() } : {}) };
      const result = await api<ClosureCreated>(path, {
        method: "POST",
        body,
        key: idempotency.key(path, body),
      });
      idempotency.committed();
      setCreated(result);
      setNote("");
      if (date < range.from || date > range.to) {
        const next = { from: date, to: shiftClosureDate(date, 90) };
        setRange(next);
        setDraftRange(next);
      }
    });
  }

  return (
    <div className="grid gap-4">
      {writable && (
        <form onSubmit={register}>
          <fieldset className="grid gap-2" disabled={busy}>
            <legend>휴무일 등록</legend>
            <Field label="휴무 날짜 (한국 시간)">
              <input
                type="date"
                required
                min={today}
                max={shiftClosureDate(today, 366)}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field label="휴무 안내 문구">
              <textarea
                maxLength={200}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            <Button type="submit">휴무일 등록</Button>
          </fieldset>
        </form>
      )}
      {created && (
        <section className="tip" role="status">
          <p>{created.closure.date} 휴무일을 등록했어요.</p>
          {created.affectedReservationCount > 0 && (
            <>
              <p>
                기존 예약 {created.affectedReservationCount}건이 있어요. 예약을
                확인해 주세요.
              </p>
              <ul>
                {created.affectedReservations.map((row) => (
                  <li key={row.id}>
                    {row.roomName} · {formatDateTime(row.startAt)} ~{" "}
                    {formatDateTime(row.endAt)} · {row.status}
                  </li>
                ))}
              </ul>
              {can(session.user, branch.id, "payments:read") && (
                <Link
                  to={`/app/${encodeURIComponent(branch.id)}/reservations?view=list&from=${created.closure.date}&to=${shiftClosureDate(created.closure.date, 1)}`}
                >
                  룸 예약 목록으로 이동
                </Link>
              )}
            </>
          )}
        </section>
      )}
      {error && <p role="alert">{error.message}</p>}
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            draftRange.to < draftRange.from ||
            draftRange.to > shiftClosureDate(draftRange.from, 366)
          ) {
            setError(
              new Error("조회 종료일은 시작일부터 366일 이내여야 해요."),
            );
            return;
          }
          setError(null);
          setRange(draftRange);
        }}
      >
        <Field label="조회 시작일">
          <input
            type="date"
            required
            value={draftRange.from}
            onChange={(e) =>
              setDraftRange({ ...draftRange, from: e.target.value })
            }
          />
        </Field>
        <Field label="조회 종료일">
          <input
            type="date"
            required
            value={draftRange.to}
            onChange={(e) =>
              setDraftRange({ ...draftRange, to: e.target.value })
            }
          />
        </Field>
        <Button type="submit">휴무일 조회</Button>
      </form>
      {list.isPending && <State loading />}
      {list.error && (
        <ErrorState error={list.error} retry={() => void list.refetch()} />
      )}
      {list.data?.items.length === 0 && (
        <State title="조회 기간에 휴무일이 없어요" />
      )}
      {list.data?.items.map((row) => (
        <article className="rounded-xl border border-line p-3" key={row.id}>
          <h3>{row.date}</h3>
          {row.note && <p>{row.note}</p>}
          {writable &&
            row.canEdit &&
            (editing?.id === row.id ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void save(async () => {
                    await api(`/branch-closures/${row.id}`, {
                      method: "PATCH",
                      body: {
                        version: editing.version,
                        note: editNote.trim() || null,
                      },
                    });
                    setEditing(null);
                  });
                }}
              >
                <Field label="휴무 안내 문구 수정">
                  <textarea
                    maxLength={200}
                    value={editNote}
                    onChange={(e) => setEditNote(e.target.value)}
                    disabled={busy}
                  />
                </Field>
                <Button type="submit" disabled={busy}>
                  안내 저장
                </Button>
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => setEditing(null)}
                >
                  취소
                </Button>
              </form>
            ) : (
              <Button
                disabled={busy}
                onClick={() => {
                  setEditing(row);
                  setEditNote(row.note ?? "");
                }}
              >
                안내 수정
              </Button>
            ))}
          {writable && row.canDelete && row.date > today && (
            <Button
              disabled={busy}
              onClick={() => {
                if (!window.confirm(`${row.date} 휴무일을 삭제할까요?`)) return;
                void save(async () => {
                  await api<void>(
                    `/branch-closures/${row.id}?version=${row.version}`,
                    { method: "DELETE" },
                  );
                  if (editing?.id === row.id) setEditing(null);
                  if (created?.closure.id === row.id) setCreated(null);
                });
              }}
            >
              휴무일 삭제
            </Button>
          )}
        </article>
      ))}
    </div>
  );
}
