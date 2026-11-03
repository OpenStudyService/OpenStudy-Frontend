import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { useApp } from "../../app/context";
import { ApiError } from "../../shared/api/client";
import { can } from "../../shared/domain/schema";
import {
  Badge,
  Button,
  ErrorState,
  FieldError,
  Panel,
  State,
} from "../../shared/ui/primitives";
import { dateTime } from "../payments/shared";
import { won } from "../../shared/domain/schema";
import { useCustomerWrite } from "./hooks";
import {
  canReadCrossBranch,
  getCrossBranchSummary,
  getSpaceHistory,
} from "./history-api";
import type { CrossBranchSummary } from "./history-api";

export function CustomerSpaceHistory({ customerId }: { customerId: string }) {
  const { session, scope } = useApp();
  // This component is also safe when mounted outside CustomerPanel's keyed session.
  const identity = JSON.stringify([customerId, scope, session.user]);
  return <HistorySession key={identity} customerId={customerId} />;
}
function HistorySession({ customerId }: { customerId: string }) {
  const { session, scope } = useApp();
  const client = useQueryClient();
  const [visible, setVisible] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const query = useQuery({
    queryKey: [
      "data",
      session.user.id,
      scope,
      "customers",
      "space-history",
      customerId,
      session.user.status,
      session.user.owner,
      session.user.memberships,
    ],
    queryFn: async ({ signal }) => {
      try {
        return await getSpaceHistory(customerId, scope, signal);
      } catch (error) {
        if (
          !signal.aborted &&
          error instanceof ApiError &&
          [401, 403].includes(error.status)
        ) {
          void client.invalidateQueries({ queryKey: ["session"] });
        }
        throw error;
      }
    },
    enabled: visible && session.user.status === "활성",
    retry: false,
  });
  const branches = session.branches.filter(
    (b) =>
      (scope === "all" || b.id === scope) &&
      canReadCrossBranch(session.user, b.id),
  );
  const branchName = (id: string) =>
    session.branches.find((b) => b.id === id)?.name ?? `지점 ${id}`;
  return (
    <section
      className="mt-6 grid gap-3"
      aria-label="룸·사물함 이력과 타 지점 요약"
    >
      <div className="flex flex-wrap gap-2">
        <Button aria-expanded={visible} onClick={() => setVisible(!visible)}>
          룸·사물함 이력 {visible ? "접기" : "보기"}
        </Button>
        {branches.length > 0 && (
          <Button
            aria-expanded={summaryOpen}
            onClick={() => setSummaryOpen(!summaryOpen)}
          >
            타 지점 최소 요약 {summaryOpen ? "닫기" : "조회"}
          </Button>
        )}
      </div>
      {summaryOpen && branches.length > 0 && (
        <Panel
          open
          title="타 지점 최소 요약"
          description="응대 사유를 입력한 뒤 최소 이용 정보만 확인해 주세요."
          onClose={() => setSummaryOpen(false)}
        >
          <SummaryForm
            customerId={customerId}
            branches={branches}
            branchName={branchName}
          />
        </Panel>
      )}
      {visible && (
        <section aria-label="허용 지점 룸·사물함 이력" className="grid gap-3">
          <h3>룸 예약·사물함 배정 이력</h3>
          <p className="help">선택한 범위의 허용 지점 이력만 표시해요.</p>
          {query.error ? (
            <ErrorState
              error={query.error}
              retry={() => void query.refetch()}
            />
          ) : query.isPending ? (
            <State loading />
          ) : (
            query.data && (
              <>
                {!query.data.reservations.length &&
                  !query.data.assignments.length && (
                    <State title="룸·사물함 이력이 없어요" />
                  )}
                {query.data.reservations
                  .filter((r) => can(session.user, r.branchId))
                  .map((r) => (
                    <article className="tip" key={`room:${r.id}`}>
                      <h4>
                        스터디룸 {r.room.roomNo} · {r.room.name}
                      </h4>
                      <p>
                        {branchName(r.branchId)} · <Badge>{r.status}</Badge>
                      </p>
                      <p>
                        예약: {dateTime(r.startAt)} ~ {dateTime(r.endAt)}
                      </p>
                      {r.usage && (
                        <p>
                          실제 이용: {dateTime(r.usage.startedAt)} ~{" "}
                          {r.usage.endedAt
                            ? dateTime(r.usage.endedAt)
                            : "이용 중"}
                        </p>
                      )}
                      {r.billing &&
                        can(session.user, r.branchId, "payments:read") && (
                          <p>
                            청구 금액: {won(r.billing.amountKrw)} ·{" "}
                            {r.billing.paymentStatus}{" "}
                            <Link
                              className="btn"
                              to={`/app/${encodeURIComponent(r.branchId)}/payments?detail=${encodeURIComponent(r.billing.paymentId)}`}
                            >
                              관련 결제 상세
                            </Link>
                          </p>
                        )}
                      <Link
                        className="btn mt-2"
                        to={`/app/${encodeURIComponent(r.branchId)}/reservations?detail=${encodeURIComponent(r.id)}`}
                      >
                        룸 예약 상세
                      </Link>
                    </article>
                  ))}
                {query.data.assignments
                  .filter((r) => can(session.user, r.branchId))
                  .map((r) => (
                    <article className="tip" key={`locker:${r.id}`}>
                      <h4>사물함 {r.locker.lockerNo}</h4>
                      <p>
                        {branchName(r.branchId)} · <Badge>{r.status}</Badge>{" "}
                        {r.overdue && <Badge>반납 지연</Badge>}
                      </p>
                      <p>
                        배정: {r.startDate} ~ {r.endDate} (종료일 제외)
                      </p>
                      {r.returnedAt && <p>반납: {dateTime(r.returnedAt)}</p>}
                      {can(session.user, r.branchId, "payments:read") &&
                        r.charges?.map((c) => (
                          <p key={c.id}>
                            {c.kind} {c.startDate} ~ {c.endDate} · {c.status} ·{" "}
                            {won(c.amountKrw)}{" "}
                            <Link
                              className="btn"
                              to={`/app/${encodeURIComponent(r.branchId)}/payments?detail=${encodeURIComponent(c.paymentId)}`}
                            >
                              관련 결제 상세
                            </Link>
                          </p>
                        ))}
                      <Link
                        className="btn mt-2"
                        to={`/app/${encodeURIComponent(r.branchId)}/spaces?tab=lockers&assignment=${encodeURIComponent(r.id)}&detail=${encodeURIComponent(r.locker.id)}`}
                      >
                        사물함 배정 상세
                      </Link>
                    </article>
                  ))}
              </>
            )
          )}
        </section>
      )}
    </section>
  );
}
function SummaryForm({
  customerId,
  branches,
  branchName,
}: {
  customerId: string;
  branches: { id: string; name: string }[];
  branchName: (id: string) => string;
}) {
  const write = useCustomerWrite();
  const [branchId, setBranchId] = useState(branches[0].id);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<CrossBranchSummary | null>(null);
  const [failure, setFailure] = useState<Error | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  return (
    <form
      className="form-grid tip"
      aria-label="타 지점 최소 요약 조회"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        if (write.busy) return;
        if (!reason.trim() || reason.trim().length > 500) {
          setFields({ reason: "응대 사유를 1~500자로 입력해 주세요." });
          return;
        }
        setFailure(null);
        setFields({});
        setResult(null);
        try {
          const body = { branchId, reason: reason.trim() };
          const value = await write.run(
            "cross-branch-summary",
            body,
            (signal) => getCrossBranchSummary(customerId, body, signal),
            false,
          );
          setResult(value);
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError")
            return;
          setFailure(error as Error);
          if (error instanceof ApiError)
            setFields(error.detail.fieldErrors ?? {});
        }
      }}
    >
      <p className="help">
        열람할 때마다 응대 지점·사유가 기록돼요. 일반 고객 조회 범위는 바뀌지
        않아요. 이용 내역은 최근 50건까지 표시해요.
      </p>
      <label className="field">
        <span>응대 지점</span>
        <select
          aria-label="응대 지점"
          disabled={write.busy}
          value={branchId}
          onChange={(e) => {
            setBranchId(e.target.value);
            setResult(null);
          }}
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        {fields.branchId && <FieldError>{fields.branchId}</FieldError>}
      </label>
      <label className="field">
        <span>응대 사유</span>
        <textarea
          aria-label="응대 사유"
          required
          aria-required="true"
          aria-invalid={!!fields.reason}
          maxLength={500}
          disabled={write.busy}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setFields({});
            setResult(null);
          }}
        />
        {fields.reason && <FieldError>{fields.reason}</FieldError>}
      </label>
      <Button type="submit" variant="primary" disabled={write.busy}>
        {write.busy ? "조회 중…" : "사유를 기록하고 조회"}
      </Button>
      {failure && <FieldError>{failure.message}</FieldError>}
      {result && (
        <section aria-label="타 지점 최소 요약 결과" className="grid gap-3">
          <p>기준 시각: {dateTime(result.asOf)}</p>
          <h4>보유 이용권·유효 상태</h4>
          {result.passes.map((p, i) => (
            <article key={i}>
              <p>
                {p.productName} · {p.kind} · <Badge>{p.status}</Badge>
              </p>
              <p>만료: {p.expiresAt ? dateTime(p.expiresAt) : "없음"}</p>
            </article>
          ))}
          {!result.passes.length && <p>보유 이용권이 없어요.</p>}
          <h4>최근 이용 일시·지점</h4>
          {result.usages.map((u, i) => (
            <p key={i}>
              {u.kind} · {branchName(u.branchId)} · {dateTime(u.startAt)} ~{" "}
              {u.endAt ? dateTime(u.endAt) : "이용 중"}
            </p>
          ))}
          {!result.usages.length && <p>이용 내역이 없어요.</p>}
        </section>
      )}
    </form>
  );
}
