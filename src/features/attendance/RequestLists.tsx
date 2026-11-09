import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { Button } from "../../shared/ui/primitives";
import { DataNotice } from "../../shared/ui/DataNotice";
import { shiftTime } from "./api";
import { corrections, swaps, requestApi, type Correction } from "./request-api";
import { RequestFeedback } from "./RequestFeedback";
import { useRequestWrite } from "./useRequestWrite";

type Action = "approve" | "reject" | "cancel" | "cancel-approval";
type Row = {
  id: string;
  version: number;
  branchId: string;
  status: string;
  createdAt: string;
  reason: string;
  decision: { by: { name: string }; at: string; reason?: string | null } | null;
  cancellation: { kind: string; by: { name: string }; at: string } | null;
  canApprove: boolean;
  canReject: boolean;
  canCancel: boolean;
  canCancelApproval?: boolean;
};
const actions: Record<Action, string> = {
  approve: "승인",
  reject: "반려",
  cancel: "신청 취소",
  "cancel-approval": "승인 취소",
};

export function RequestList<T extends Row>({
  resource,
  service,
  title,
  effects,
  children,
  rejectReason,
  payload,
}: {
  resource: string;
  service: ReturnType<typeof requestApi<T>>;
  title: string;
  effects: string[];
  children: (row: T) => ReactNode;
  rejectReason?: boolean;
  payload?: (row: T, action: Action) => Record<string, unknown>;
}) {
  const { session, scope } = useApp();
  const [page, setPage] = useState(1);
  const rows = useQuery({
    queryKey: ["data", session.user.id, scope, resource, page],
    queryFn: ({ signal }) => service.list(scope, page, signal),
    retry: false,
  });

  return (
    <section className="grid gap-3 p-4" aria-label={title}>
      <Button onClick={() => void rows.refetch()} disabled={rows.isFetching}>
        목록 새로고침
      </Button>
      <DataNotice
        label={title}
        loading={rows.isPending}
        error={rows.error}
        retry={() => void rows.refetch()}
      />
      {rows.data?.items.length === 0 && <p>신청 내역이 없습니다.</p>}
      {rows.data?.items.map((row) => (
        <RequestCard
          key={row.id}
          row={row}
          rejectReason={rejectReason}
          effects={[resource, ...effects]}
          reload={() => void rows.refetch()}
          send={(action, reason) => {
            const body = {
              version: row.version,
              ...payload?.(row, action),
              ...(action === "reject" && rejectReason ? { reason } : {}),
            };
            return service.command(row.id, action, body);
          }}
        >
          {children(row)}
        </RequestCard>
      ))}
      <div className="flex items-center gap-3">
        <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>
          이전
        </Button>
        <span>
          {page}페이지 · {rows.data?.total ?? 0}건
        </span>
        <Button
          disabled={!rows.data || page * 20 >= rows.data.total}
          onClick={() => setPage(page + 1)}
        >
          다음
        </Button>
      </div>
    </section>
  );
}

function RequestCard({
  row,
  rejectReason,
  effects,
  reload,
  send,
  children,
}: {
  row: Row;
  rejectReason?: boolean;
  effects: string[];
  reload: () => void;
  send: (action: Action, reason?: string) => Promise<unknown>;
  children: ReactNode;
}) {
  const { lookups } = useApp();
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const write = useRequestWrite(...effects);
  const pending = row.status === "신청";
  const available: [Action, boolean][] = [
    ["approve", pending && row.canApprove],
    ["reject", pending && row.canReject],
    ["cancel", pending && row.canCancel],
    ["cancel-approval", row.status === "승인" && !!row.canCancelApproval],
  ];
  const act = (action: Action) =>
    void write.run(
      () => send(action, reason.trim()),
      () => {
        setRejecting(false);
        setReason("");
      },
    );
  return (
    <article className="card grid gap-2 p-4">
      <p>
        {row.status} · #{row.id} ·{" "}
        {lookups.branches.find((branch) => branch.id === row.branchId)?.name ??
          row.branchId}
      </p>
      {children}
      <p>
        신청 사유: {row.reason} · {shiftTime(row.createdAt)}
      </p>
      {row.decision && (
        <p>
          처리: {row.decision.by.name} · {shiftTime(row.decision.at)}
          {row.decision.reason && ` · 반려 사유: ${row.decision.reason}`}
        </p>
      )}
      {row.cancellation && (
        <p>
          {row.cancellation.kind}: {row.cancellation.by.name} ·{" "}
          {shiftTime(row.cancellation.at)}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {available
          .filter(([, allowed]) => allowed)
          .map(([action]) => (
            <Button
              key={action}
              disabled={write.busy}
              onClick={() => {
                if (action === "reject" && rejectReason) setRejecting(true);
                else act(action);
              }}
            >
              {actions[action]}
            </Button>
          ))}
      </div>
      {rejecting && pending && row.canReject && (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (reason.trim()) act("reject");
          }}
        >
          <label>
            반려 사유
            <textarea
              required
              maxLength={500}
              value={reason}
              disabled={write.busy}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <Button type="submit" disabled={write.busy || !reason.trim()}>
            반려 확정
          </Button>
        </form>
      )}
      {write.error && <RequestFeedback error={write.error} reload={reload} />}
    </article>
  );
}

const interval = (start: string | null, end: string | null) =>
  start && end ? `${shiftTime(start)} ~ ${shiftTime(end)}` : "—";
const corrected = (row: Correction, values: Correction["before"]) =>
  row.kind === "출퇴근"
    ? interval(values.clockInAt, values.clockOutAt)
    : interval(values.breakStartedAt, values.breakEndedAt);

export function CorrectionList() {
  return (
    <RequestList
      resource="attendance-corrections"
      title="기록 정정"
      service={corrections}
      rejectReason
      effects={["attendance-records", "attendance-current", "shifts", "home"]}
    >
      {(row) => (
        <>
          <h3>
            {row.employee.name} · {row.kind} 정정
          </h3>
          <p>
            근태 #{row.attendanceRecordId}
            {row.breakId && ` · 휴게 #${row.breakId}`}
          </p>
          <p>원본: {corrected(row, row.before)}</p>
          <p>정정: {corrected(row, row.after)}</p>
        </>
      )}
    </RequestList>
  );
}

export function SwapList() {
  return (
    <RequestList
      resource="shift-swaps"
      title="대체근무"
      service={swaps}
      effects={["shifts", "attendance-records", "home"]}
      payload={(row, action) =>
        action === "approve" ? { shiftVersion: row.shiftVersion } : {}
      }
    >
      {(row) => (
        <>
          <h3>
            {row.requester.name} → {row.replacement.name}
          </h3>
          <p>근무 #{row.shiftId}</p>
          <p>원래 근무: {interval(row.originalStartsAt, row.originalEndsAt)}</p>
          <p>제안 근무: {interval(row.proposedStartsAt, row.proposedEndsAt)}</p>
        </>
      )}
    </RequestList>
  );
}
