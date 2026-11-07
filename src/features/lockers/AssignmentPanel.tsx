import { invalidateReads } from "../../shared/api/invalidateReads";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { ApiError } from "../../shared/api/client";
import { can, won } from "../../shared/domain/schema";
import { Button, ErrorState, Panel, State } from "../../shared/ui/primitives";
import { Field, Pager } from "../organization/shared";
import {
  CustomerSelector,
  MockPaymentNotice,
  dateTime,
  useSalesClock,
} from "../payments/shared";
import { lockerApi } from "./api";
import {
  addLockerTerms,
  canReturnAssignment,
  canExtendAssignment,
  koreaToday,
  assignmentKey,
  lockerKey,
  canReadLockerCharges,
} from "./model";
import type {
  Locker,
  LockerAssignment,
  LockerAssignmentCreate,
  LockerAssignmentExtend,
} from "./model";
import { useLockerWrite, useLockerLeaveGuard } from "./hooks";
import {
  abortError,
  accessError,
  LockerWriteError,
  versionError,
} from "./shared";

export function AssignmentPanel({
  id,
  lockerId,
  onClose,
}: {
  id: string;
  lockerId: string;
  onClose: () => void;
}) {
  const { session, scope } = useApp(),
    [mode, setMode] = useState("");
  const [actionOriginal, setActionOriginal] = useState<LockerAssignment>();
  const assignment = useQuery({
    queryKey: assignmentKey(session.user.id, scope, id),
    queryFn: ({ signal }) => lockerApi.assignment(scope, id, signal),
    enabled: id !== "new",
    retry: false,
  });
  const selectedLocker = assignment.data?.locker.id ?? lockerId;
  const locker = useQuery({
    queryKey: lockerKey(session.user.id, scope, selectedLocker),
    queryFn: ({ signal }) => lockerApi.locker(scope, selectedLocker, signal),
    enabled: !!selectedLocker,
    retry: false,
  });
  const operating =
    locker.data?.status === "사용 가능" &&
    session.branches.some(
      (b) => b.id === locker.data?.branchId && b.status === "운영 중",
    );
  const canPay =
    operating &&
    locker.data &&
    can(session.user, locker.data.branchId, "payments:write");
  return (
    <Panel
      open
      title={id === "new" ? "사물함 유료 배정" : "사물함 배정 상세"}
      onClose={onClose}
    >
      {id === "new" ? (
        locker.isPending ? (
          <State loading />
        ) : locker.error ? (
          <ErrorState
            error={locker.error}
            retry={() => void locker.refetch()}
          />
        ) : canPay && locker.data ? (
          <AssignmentForm locker={locker.data} onSaved={onClose} />
        ) : (
          <State
            title="현재 유료 배정할 수 없어요"
            message="운영 상태와 결제 권한을 확인해 주세요."
          />
        )
      ) : assignment.isPending ? (
        <State loading />
      ) : assignment.error ? (
        <ErrorState
          error={assignment.error}
          retry={() => void assignment.refetch()}
        />
      ) : (
        assignment.data && (
          <>
            {mode &&
            actionOriginal &&
            (mode === "return"
              ? can(session.user, actionOriginal.branchId)
              : canPay) ? (
              <AssignmentForm
                key={mode}
                assignment={actionOriginal}
                locker={locker.data}
                mode={mode}
                onSaved={() => setMode("")}
              />
            ) : (
              <>
                <AssignmentInfo assignment={assignment.data} />
                <div className="flex gap-2 my-4">
                  {canPay &&
                    canExtendAssignment(session.user, assignment.data) && (
                      <Button
                        onClick={() => {
                          setActionOriginal(assignment.data);
                          setMode("extend");
                        }}
                      >
                        유료 연장
                      </Button>
                    )}
                  {canReturnAssignment(session.user, assignment.data) && (
                    <Button
                      onClick={() => {
                        setActionOriginal(assignment.data);
                        setMode("return");
                      }}
                    >
                      반납 처리
                    </Button>
                  )}
                </div>
                {locker.error && (
                  <ErrorState
                    error={locker.error}
                    retry={() => void locker.refetch()}
                  />
                )}
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
export function AssignmentInfo({
  assignment: row,
}: {
  assignment: LockerAssignment;
}) {
  const { session } = useApp();
  return (
    <>
      <dl className="grid gap-3">
        {[
          ["사물함", row.locker.lockerNo],
          ["고객", `${row.customer.name} · ${row.customer.memberNo}`],
          ["배정 상태", row.status],
          ["이용 기간 (종료일 미포함)", `${row.startDate} ~ ${row.endDate}`],
          ["미반납 만료", row.overdue ? "예" : "아니오"],
          ["반납 시각", dateTime(row.returnedAt)],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {row.charges !== null &&
        canReadLockerCharges(session.user, row.branchId) && (
          <section className="my-4">
            <h3>서버 확정 결제 내역</h3>
            <MockPaymentNotice />
            <ul className="grid gap-3">
              {row.charges.map((c) => (
                <li key={c.id}>
                  {c.kind} · {c.startDate} ~ {c.endDate} · {c.terms}회(4주) ·{" "}
                  {won(c.amountKrw)} · {c.status}
                  <p className="help">
                    적용 4주 요금 {won(c.ratePer4WeeksKrw)} · 결제 {c.paymentId}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}
    </>
  );
}
function AssignmentForm({
  locker,
  assignment,
  mode = "create",
  onSaved,
}: {
  locker?: Locker;
  assignment?: LockerAssignment;
  mode?: string;
  onSaved: () => void;
}) {
  const { session, scope } = useApp(),
    now = useSalesClock(),
    query = useQueryClient(),
    write = useLockerWrite(
      "lockers",
      "locker-assignments",
      "payments",
      "passes",
      "customers",
      "sales",
    );
  const [original] = useState(assignment),
    [latest, setLatest] = useState<LockerAssignment>();
  const [customer, setCustomer] = useState(""),
    [startDate, setStartDate] = useState(koreaToday(now)),
    [terms, setTerms] = useState("1");
  const [method, setMethod] =
      useState<LockerAssignmentCreate["method"]>("카드"),
    [mockOutcome, setMockOutcome] =
      useState<LockerAssignmentCreate["mockOutcome"]>("APPROVED"),
    [reason, setReason] = useState("");
  const [dirty, setDirty] = useState(false),
    [blocked, setBlocked] = useState(false),
    [error, setError] = useState<Error | null>(null),
    [result, setResult] = useState<LockerAssignment>();
  const leave = useLockerLeaveGuard(dirty);
  // A conflicting extension must keep the requested end date, never silently
  // shift the payment period onto the newer server end date.
  const periodStart = mode === "extend" ? original!.endDate : startDate,
    endDate = addLockerTerms(periodStart, Number(terms));
  const current = latest ?? original;
  const extensionChanged =
    mode === "extend" && latest && latest.endDate !== original!.endDate;
  async function compare() {
    if (!assignment) return;
    try {
      setLatest(
        await write.run(
          "assignment:compare",
          {},
          (signal) => lockerApi.assignment(scope, assignment.id, signal),
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
  const reload = () => {
    void invalidateReads(
      query,
      session.user.id,
      "lockers",
      "locker-assignments",
      "payments",
      "sales",
      "passes",
      "customers",
    );
  };
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (
      write.busy ||
      blocked ||
      result ||
      extensionChanged ||
      (versionError(error) && !latest)
    )
      return;
    const branchId = assignment?.branchId ?? locker?.branchId;
    if (
      !branchId ||
      (mode === "return"
        ? !current || !canReturnAssignment(session.user, current)
        : !can(session.user, branchId, "payments:write") ||
          locker?.status !== "사용 가능" ||
          !session.branches.some(
            (b) => b.id === branchId && b.status === "운영 중",
          ))
    )
      return;
    if (current && current.status !== "배정") {
      setError(
        new Error(
          "최신 배정 상태에서는 이 작업을 진행할 수 없어요. 취소 후 다시 확인하세요.",
        ),
      );
      return;
    }
    if (
      mode !== "return" &&
      (!endDate || (!assignment && startDate < koreaToday(now)))
    ) {
      setError(new Error("시작일과 4주 단위 이용 기간을 확인하세요."));
      return;
    }
    const returnBody = {
      version: current?.version ?? 0,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    };
    const body =
      mode === "return"
        ? returnBody
        : assignment
          ? { version: current!.version, endDate, method, mockOutcome }
          : {
              branchId,
              lockerId: locker!.id,
              customerId: customer,
              startDate,
              endDate,
              method,
              mockOutcome,
            };
    setError(null);
    try {
      const value = await write.run(
        `assignment:${assignment?.id ?? locker!.id}:${mode}`,
        body,
        (signal, key) =>
          mode === "return"
            ? lockerApi.returnLocker(scope, assignment!.id, returnBody, signal)
            : assignment
              ? lockerApi.extend(
                  scope,
                  assignment.id,
                  body as LockerAssignmentExtend,
                  signal,
                  key,
                )
              : lockerApi.createAssignment(
                  scope,
                  body as LockerAssignmentCreate,
                  signal,
                  key,
                ),
        true,
        assignment
          ? assignmentKey(session.user.id, scope, assignment.id)
          : undefined,
      );
      leave.saved();
      setResult(value);
    } catch (e) {
      if (!abortError(e)) {
        setError(e as Error);
        if (versionError(e)) setLatest(undefined);
        if (accessError(e)) setBlocked(true);
      }
    }
  }
  if (result)
    return (
      <>
        <p role="status" className="tip">
          {mode === "return"
            ? "반납 처리되었습니다. 조기 반납 환불은 없습니다."
            : result.status === "결제 실패" ||
                result.charges?.at(-1)?.status === "실패"
              ? "Mock 결제 실패: 이용 기간과 점유는 추가되지 않았습니다."
              : "Mock 결제가 적용되었습니다."}
        </p>
        <AssignmentInfo assignment={result} />
        <Button onClick={onSaved}>완료</Button>
      </>
    );
  return (
    <form onSubmit={(e) => void submit(e)}>
      {leave.guard}
      <fieldset disabled={write.busy || blocked} className="grid gap-4">
        {mode === "return" ? (
          <>
            <p className="tip">
              반납하면 사물함 이용이 종료됩니다. 조기 반납에 따른 환불은
              없습니다.
            </p>
            <Field label="반납 사유 (선택)">
              <textarea
                aria-label="반납 사유 (선택)"
                maxLength={500}
                value={reason}
                onChange={(e) => {
                  setDirty(true);
                  setReason(e.target.value);
                }}
              />
            </Field>
          </>
        ) : (
          <>
            <p>
              {locker?.lockerNo} · 현재 서버 4주 요금{" "}
              {locker ? won(locker.ratePer4WeeksKrw) : "—"}
            </p>
            <MockPaymentNotice />
            {!assignment && (
              <>
                <CustomerSelector
                  value={customer}
                  onChange={(v) => {
                    setDirty(true);
                    setCustomer(v);
                  }}
                  disabled={write.busy}
                />
                <Field label="배정 시작일">
                  <input
                    aria-label="배정 시작일"
                    type="date"
                    required
                    min={koreaToday(now)}
                    value={startDate}
                    onChange={(e) => {
                      setDirty(true);
                      setStartDate(e.target.value);
                    }}
                  />
                </Field>
              </>
            )}
            <Field
              label={
                assignment ? "연장 기간 (4주 단위)" : "이용 기간 (4주 단위)"
              }
            >
              <input
                aria-label={
                  assignment ? "연장 기간 (4주 단위)" : "이용 기간 (4주 단위)"
                }
                type="number"
                min={1}
                step={1}
                max={1000}
                required
                value={terms}
                onChange={(e) => {
                  setDirty(true);
                  setTerms(e.target.value);
                }}
              />
            </Field>
            <p className="help">
              {periodStart} ~ {endDate || "날짜 확인 필요"} (종료일 미포함).{" "}
              {assignment &&
                "연체 여부와 관계없이 기존 종료일부터 연장합니다. "}
              28일의 배수만 선택할 수 있습니다. 결제 금액은 요청 처리 후 서버
              확정값으로 표시합니다.
            </p>
            <Field label="결제 수단">
              <select
                aria-label="결제 수단"
                value={method}
                onChange={(e) => {
                  setDirty(true);
                  setMethod(e.target.value as typeof method);
                }}
              >
                {["카드", "현금", "계좌이체", "기타"].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </Field>
            <Field label="Mock 결제 결과">
              <select
                aria-label="Mock 결제 결과"
                value={mockOutcome}
                onChange={(e) => {
                  setDirty(true);
                  setMockOutcome(e.target.value as typeof mockOutcome);
                }}
              >
                <option value="APPROVED">승인</option>
                <option value="FAILED">실패</option>
              </select>
            </Field>
          </>
        )}
        <LockerWriteError
          error={error}
          compare={compare}
          latest={latest && <AssignmentInfo assignment={latest} />}
          reload={reload}
        />
        {error instanceof ApiError &&
          error.status === 409 &&
          !versionError(error) &&
          locker && <CurrentAssignments lockerId={locker.id} />}
        {extensionChanged && (
          <p role="alert">
            서버의 종료일이 변경되었습니다. 현재 입력을 유지했습니다. 취소 후
            최신 기간에서 새 연장을 시작하세요.
          </p>
        )}
        <Button
          variant="primary"
          type="submit"
          disabled={
            !!extensionChanged ||
            (versionError(error) && !latest) ||
            (mode === "create" && !customer)
          }
        >
          {write.busy
            ? "처리 중…"
            : mode === "return"
              ? "환불 없이 반납 확정"
              : mode === "extend"
                ? "Mock 결제 후 연장"
                : "Mock 결제 후 배정"}
        </Button>
      </fieldset>
    </form>
  );
}

function CurrentAssignments({ lockerId }: { lockerId: string }) {
  const { session, scope } = useApp(),
    [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: [
      "data",
      session.user.id,
      scope,
      "locker-assignments",
      "conflict",
      lockerId,
      page,
    ],
    queryFn: ({ signal }) =>
      lockerApi.assignments(scope, { lockerId, page }, signal),
    retry: false,
  });
  return (
    <section aria-label="최신 사물함 배정 현황" className="card p-3">
      <h3>최신 사물함 배정 현황</h3>
      {list.isPending ? (
        <State loading />
      ) : list.error ? (
        <ErrorState error={list.error} retry={() => void list.refetch()} />
      ) : (
        <>
          <ul>
            {list.data.items.map((r) => (
              <li key={r.id}>
                {r.startDate} ~ {r.endDate} · {r.status}
                {r.overdue ? " · 미반납 만료" : ""}
              </li>
            ))}
          </ul>
          {!list.data.items.length && <p>현재 배정 내역이 없습니다.</p>}
          <Pager page={page} total={list.data.meta.total} onChange={setPage} />
        </>
      )}
    </section>
  );
}
