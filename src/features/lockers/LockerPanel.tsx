import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { can, won } from "../../shared/domain/schema";
import { Button, ErrorState, Panel, State } from "../../shared/ui/primitives";
import { Field, Pager } from "../organization/shared";
import { lockerApi } from "./api";
import type {
  Locker,
  LockerCreate,
  LockerUpdate,
  LockerStatusChange,
} from "./model";
import { useLockerWrite, useLockerLeaveGuard } from "./hooks";
import {
  abortError,
  accessError,
  keyFor,
  LockerWriteError,
  versionError,
} from "./shared";

export function LockerPanel({
  id,
  onClose,
  onAssignment,
}: {
  id: string;
  onClose: () => void;
  onAssignment: (id: string) => void;
}) {
  const { session, scope } = useApp(),
    [mode, setMode] = useState("");
  const row = useQuery({
    queryKey: keyFor(session.user.id, scope, "lockers", id),
    queryFn: ({ signal }) => lockerApi.locker(scope, id, signal),
    enabled: !["new", "rate"].includes(id),
    retry: false,
  });
  const writable =
    row.data && can(session.user, row.data.branchId, "operations:write");
  return (
    <Panel
      open
      title={
        id === "new"
          ? "사물함 등록"
          : id === "rate"
            ? "지점 요금 일괄 적용"
            : row.error
              ? "사물함 상세"
              : (row.data?.lockerNo ?? "사물함 상세")
      }
      onClose={onClose}
    >
      {id === "new" || id === "rate" ? (
        <LockerForm bulk={id === "rate"} onSaved={onClose} />
      ) : row.isPending ? (
        <State loading />
      ) : row.error ? (
        <ErrorState error={row.error} retry={() => void row.refetch()} />
      ) : (
        row.data && (
          <>
            {mode && writable ? (
              <LockerForm
                key={mode}
                locker={row.data}
                mode={mode}
                onSaved={() => setMode("")}
              />
            ) : (
              <>
                <LockerInfo locker={row.data} />
                <div className="flex flex-wrap gap-2 my-4">
                  {writable && (
                    <>
                      <Button onClick={() => setMode("edit")}>수정하기</Button>
                      <Button onClick={() => setMode("status")}>
                        {row.data.status === "운영 중단"
                          ? "운영 재개"
                          : "운영 중단"}
                      </Button>
                    </>
                  )}
                  {row.data.status === "사용 가능" &&
                    session.branches.some(
                      (b) =>
                        b.id === row.data.branchId && b.status === "운영 중",
                    ) &&
                    can(session.user, row.data.branchId, "payments:write") && (
                      <Button
                        variant="primary"
                        onClick={() => onAssignment("new")}
                      >
                        유료 배정
                      </Button>
                    )}
                </div>
                <LockerAssignments
                  locker={row.data}
                  onAssignment={onAssignment}
                />
              </>
            )}
            {mode && (
              <Button className="my-3" onClick={() => setMode("")}>
                취소
              </Button>
            )}
          </>
        )
      )}
    </Panel>
  );
}
export function LockerInfo({ locker }: { locker: Locker }) {
  const { session } = useApp();
  return (
    <dl className="grid gap-3">
      {[
        [
          "지점",
          session.branches.find((b) => b.id === locker.branchId)?.name ??
            locker.branchId,
        ],
        ["사물함 번호", locker.lockerNo],
        ["4주 요금", won(locker.ratePer4WeeksKrw)],
        ["운영 상태", locker.status],
        ["점유 상태", locker.assignmentState],
      ].map(([label, value]) => (
        <div key={label}>
          <dt className="text-muted">{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
function LockerAssignments({
  locker,
  onAssignment,
}: {
  locker: Locker;
  onAssignment: (id: string) => void;
}) {
  const { session, scope } = useApp(),
    [page, setPage] = useState(1);
  const records = useQuery({
    queryKey: [
      "data",
      session.user.id,
      scope,
      "locker-assignments",
      "locker",
      locker.id,
      page,
    ],
    queryFn: ({ signal }) =>
      lockerApi.assignments(scope, { lockerId: locker.id, page }, signal),
    retry: false,
  });
  return (
    <section className="my-5">
      <h3>배정 내역 (예정·결제 실패 포함)</h3>
      {records.isPending ? (
        <State loading />
      ) : records.error ? (
        <ErrorState
          error={records.error}
          retry={() => void records.refetch()}
        />
      ) : (
        <>
          {records.data.items.length ? (
            <ul className="grid gap-2">
              {records.data.items.map((r) => (
                <li key={r.id}>
                  <Button onClick={() => onAssignment(r.id)}>
                    {r.customer.name} · {r.startDate} ~ {r.endDate} · {r.status}
                    {r.overdue ? " · 미반납 만료" : ""}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="help">배정 내역이 없어요.</p>
          )}
          <Pager
            page={page}
            total={records.data.meta.total}
            onChange={setPage}
          />
        </>
      )}
    </section>
  );
}
function LockerForm({
  locker,
  mode = "edit",
  bulk = false,
  onSaved,
}: {
  locker?: Locker;
  mode?: string;
  bulk?: boolean;
  onSaved: () => void;
}) {
  const { session, scope } = useApp(),
    write = useLockerWrite("lockers", "lookups");
  const branches = session.branches.filter(
    (b) =>
      (scope === "all" || b.id === scope) &&
      can(session.user, b.id, "operations:write"),
  );
  const [original] = useState(locker),
    [branch, setBranch] = useState(
      locker?.branchId ?? (branches.length === 1 ? branches[0].id : ""),
    );
  const [draft, setDraft] = useState({
    lockerNo: locker?.lockerNo ?? "",
    rate: String(locker?.ratePer4WeeksKrw ?? 10000),
    reason: "",
  });
  const [latest, setLatest] = useState<Locker>(),
    [error, setError] = useState<Error | null>(null),
    [blocked, setBlocked] = useState(false),
    [dirty, setDirty] = useState(false);
  const leave = useLockerLeaveGuard(dirty),
    requestedStatus =
      original?.status === "운영 중단" ? "사용 가능" : "운영 중단";
  const change = (key: keyof typeof draft, value: string) => {
    setDirty(true);
    setDraft((d) => ({ ...d, [key]: value }));
  };
  async function compare() {
    if (!locker) return;
    try {
      setLatest(
        await write.run(
          "locker:compare",
          {},
          (signal) => lockerApi.locker(scope, locker.id, signal),
          false,
        ),
      );
    } catch (e) {
      if (!abortError(e)) {
        setError(e as Error);
        if (accessError(e)) setBlocked(true);
      }
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (
      write.busy ||
      blocked ||
      !can(session.user, branch, "operations:write") ||
      (versionError(error) && !latest)
    )
      return;
    if (mode === "status" && latest?.status === requestedStatus) {
      setError(
        new Error(
          "서버에 이미 같은 운영 상태가 적용되어 있어요. 취소 후 최신 상태를 확인하세요.",
        ),
      );
      return;
    }
    const body: Record<string, unknown> = bulk
      ? { ratePer4WeeksKrw: Number(draft.rate) }
      : locker
        ? { version: (latest ?? original)!.version }
        : {
            branchId: branch,
            lockerNo: draft.lockerNo,
            ratePer4WeeksKrw: Number(draft.rate),
          };
    if (locker) {
      if (mode === "status") {
        body.status = requestedStatus;
        body.reason = draft.reason;
      } else {
        if (draft.lockerNo !== original!.lockerNo)
          body.lockerNo = draft.lockerNo;
        if (Number(draft.rate) !== original!.ratePer4WeeksKrw)
          body.ratePer4WeeksKrw = Number(draft.rate);
      }
    }
    if (locker && Object.keys(body).length === 1) {
      setError(new Error("변경할 내용을 입력하세요."));
      return;
    }
    setError(null);
    try {
      await write.run<unknown>(
        `locker:${locker?.id ?? branch}:${bulk ? "rate" : mode}`,
        body,
        (signal, key) =>
          bulk
            ? lockerApi.applyRate(
                branch,
                { ratePer4WeeksKrw: Number(draft.rate) },
                signal,
                key,
              )
            : locker
              ? mode === "status"
                ? lockerApi.lockerStatus(
                    scope,
                    locker.id,
                    body as LockerStatusChange,
                    signal,
                  )
                : lockerApi.updateLocker(
                    scope,
                    locker.id,
                    body as LockerUpdate,
                    signal,
                  )
              : lockerApi.createLocker(
                  scope,
                  body as LockerCreate,
                  signal,
                  key,
                ),
        true,
        locker
          ? keyFor(session.user.id, scope, "lockers", locker.id)
          : undefined,
      );
      leave.saved();
      onSaved();
    } catch (e) {
      if (!abortError(e)) {
        setError(e as Error);
        if (versionError(e)) setLatest(undefined);
        if (accessError(e)) setBlocked(true);
      }
    }
  }
  if (!branches.length) return <State title="관리 권한이 없어요" />;
  return (
    <form onSubmit={(e) => void submit(e)}>
      {leave.guard}
      <fieldset disabled={write.busy || blocked} className="grid gap-4">
        {!locker && (
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
        {mode === "status" && locker ? (
          <>
            <p>
              {requestedStatus === "운영 중단"
                ? "운영을 중단해도 기존 배정과 반납 의무는 유지됩니다."
                : "사물함 운영을 재개합니다."}
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
            {!bulk && (
              <Field label="사물함 번호">
                <input
                  aria-label="사물함 번호"
                  required
                  maxLength={40}
                  value={draft.lockerNo}
                  onChange={(e) => change("lockerNo", e.target.value)}
                />
              </Field>
            )}
            <Field label="4주 요금 (원)">
              <input
                aria-label="4주 요금 (원)"
                type="number"
                min={1}
                step={1}
                required
                value={draft.rate}
                onChange={(e) => change("rate", e.target.value)}
              />
            </Field>
            <p className="help">
              {bulk ? "선택 지점의 모든 사물함에 적용합니다. " : ""}기존 배정의
              결제 금액은 바뀌지 않습니다. 다음 배정·연장부터 현재 요금이
              적용됩니다.
            </p>
          </>
        )}
        <LockerWriteError
          error={error}
          compare={compare}
          latest={latest && <LockerInfo locker={latest} />}
        />
        <Button
          variant="primary"
          type="submit"
          disabled={!branch || (versionError(error) && !latest)}
        >
          {write.busy ? "처리 중…" : bulk ? "요금 일괄 적용" : "저장"}
        </Button>
      </fieldset>
    </form>
  );
}
