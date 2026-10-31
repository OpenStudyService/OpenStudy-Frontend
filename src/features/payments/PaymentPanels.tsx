import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { useApp } from "../../app/context";
import { ApiError } from "../../shared/api/client";
import { can, won } from "../../shared/domain/schema";
import {
  Badge,
  Button,
  ErrorState,
  FieldError,
  Panel,
  State,
} from "../../shared/ui/primitives";
import { Field } from "../organization/shared";
import { getPass, getPayment, refundPayment } from "./api";
import type { Pass, Payment, RefundCreate } from "./model";
import { useSubmission } from "./useSubmission";
import { MockPaymentNotice, dateTime, useSalesClock } from "./shared";

export function passBalance(pass: Pass) {
  if (pass.kind === "시간권")
    return `${new Intl.NumberFormat("ko-KR").format(pass.remainingMinutes ?? 0)}분`;
  if (pass.kind === "정액권") return won(pass.remainingCreditKrw ?? 0);
  return `${dateTime(pass.startedAt)} ~ ${dateTime(pass.expiresAt)}`;
}
export function PassFacts({ pass }: { pass: Pass }) {
  const { session } = useApp();
  const branch =
    session.branches.find((b) => b.id === pass.purchaseBranchId)?.name ??
    pass.purchaseBranchId;
  return (
    <dl className="detail-grid">
      <div>
        <dt>고객</dt>
        <dd>
          {pass.customer.name} · {pass.customer.memberNo}
        </dd>
      </div>
      <div>
        <dt>구매 상품</dt>
        <dd>
          {pass.productName} · {pass.kind}
        </dd>
      </div>
      <div>
        <dt>상태</dt>
        <dd>
          <Badge>{pass.status}</Badge>
        </dd>
      </div>
      <div>
        <dt>{pass.kind === "기간권" ? "이용 기간" : "잔량"}</dt>
        <dd>{passBalance(pass)}</dd>
      </div>
      <div>
        <dt>시작 일시</dt>
        <dd>{dateTime(pass.startedAt)}</dd>
      </div>
      <div>
        <dt>만료 일시</dt>
        <dd>{pass.expiresAt ? dateTime(pass.expiresAt) : "만료 없음"}</dd>
      </div>
      <div>
        <dt>구매 지점</dt>
        <dd>{branch}</dd>
      </div>
      <div>
        <dt>사용 이력</dt>
        <dd>{pass.used ? "있음" : "없음"}</dd>
      </div>
      <div>
        <dt>원결제 번호</dt>
        <dd>{pass.purchasePaymentId}</dd>
      </div>
    </dl>
  );
}
export function RefundForm({
  paymentId,
  branchId,
  eligible,
  onRefunded,
  onBusyChange,
}: {
  paymentId: string;
  branchId: string;
  eligible: boolean;
  onRefunded: (payment: Payment) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { session } = useApp();
  const query = useQueryClient();
  const mounted = useRef(true);
  const submitting = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [reason, setReason] = useState("");
  const [validation, setValidation] = useState("");
  const write = useSubmission<RefundCreate, Payment>(
    `refund:${session.user.id}:${paymentId}`,
    (body, key) => refundPayment(paymentId, body, key, branchId),
  );
  const denied =
    write.error instanceof ApiError &&
    [401, 403, 404].includes(write.error.status) &&
    write.error.detail.code !== "CSRF_INVALID";
  const uncertain =
    !!write.error &&
    (!(write.error instanceof ApiError) ||
      write.error.status === 0 ||
      write.error.status >= 500 ||
      ["REQUEST_IN_PROGRESS", "CSRF_INVALID"].includes(
        write.error.detail.code,
      ));
  const maySubmit =
    can(session.user, branchId, "payments:write") &&
    !denied &&
    (eligible || uncertain);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || write.pending || !maySubmit) return;
    if (!reason.trim() || reason.trim().length > 500) {
      setValidation("환불 사유를 1~500자로 입력해 주세요.");
      return;
    }
    setValidation("");
    submitting.current = true;
    onBusyChange(true);
    try {
      const result = await write.run({ reason: reason.trim() });
      if (result && mounted.current) onRefunded(result);
    } catch (error) {
      if (
        error instanceof ApiError &&
        [403, 404, 409].includes(error.status) &&
        error.detail.code !== "REQUEST_IN_PROGRESS"
      )
        await query.invalidateQueries({ queryKey: ["data", session.user.id] });
    } finally {
      submitting.current = false;
      onBusyChange(false);
    }
  }
  return (
    <form className="form-grid mt-5" onSubmit={submit}>
      <p className="help">
        원결제 지점의 결제 권한이 있고 사용 이력이 없으며 만료 전인 이용권만
        전액 환불할 수 있어요. 서버가 처리 시점에 다시 확인합니다.
      </p>
      <Field label="환불 사유">
        <textarea
          value={reason}
          required
          maxLength={500}
          disabled={write.pending || !maySubmit || uncertain}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      {validation && <FieldError>{validation}</FieldError>}
      {!maySubmit && !write.pending && (
        <p className="help">
          환불 조건이 변경되었어요. 최신 이용권 상태를 확인해 주세요.
        </p>
      )}
      {write.error && (
        <FieldError>
          {write.error.message} 같은 내용으로 재시도하면 동일한 환불 요청을
          사용합니다.
        </FieldError>
      )}
      <Button
        type="submit"
        disabled={write.pending || !maySubmit}
        variant="danger"
      >
        {write.pending
          ? "환불 처리 중…"
          : write.error
            ? "같은 환불 다시 시도"
            : "전액 환불 확정"}
      </Button>
    </form>
  );
}
function useRefundAvailability(pass: Pass | undefined) {
  const { session } = useApp();
  const now = useSalesClock();
  return (
    !!pass &&
    pass.canRefund &&
    !pass.used &&
    pass.status === "활성" &&
    (!pass.expiresAt || Date.parse(pass.expiresAt) > now) &&
    can(session.user, pass.purchaseBranchId, "payments:write")
  );
}
export function PaymentPanel({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const { session, scope } = useApp();
  return (
    <PaymentPanelSession
      key={`${session.user.id}:${scope}:${id}:${JSON.stringify(session.user.memberships)}`}
      id={id}
      onClose={onClose}
    />
  );
}
function PaymentPanelSession({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const { session, scope } = useApp();
  const query = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const payment = useQuery({
    queryKey: ["data", session.user.id, scope, "payments", "detail", id],
    queryFn: ({ signal }) => getPayment(id, scope, signal),
    retry: false,
  });
  const passId = payment.data?.passId;
  const pass = useQuery({
    queryKey: ["data", session.user.id, scope, "passes", "detail", passId],
    queryFn: ({ signal }) => getPass(passId!, scope, signal),
    enabled: !!passId,
    retry: false,
  });
  const canRefund =
    useRefundAvailability(pass.data) &&
    !!payment.data?.canRefund &&
    payment.data.status === "승인";
  const p = payment.data;
  return (
    <Panel
      open
      title="결제 상세"
      onClose={() => {
        if (!busy) onClose();
      }}
      description="원결제와 이용권·환불 결과를 확인해 주세요."
    >
      <MockPaymentNotice />
      {payment.isPending ? (
        <State loading />
      ) : payment.error ? (
        <ErrorState
          error={payment.error}
          retry={() => void payment.refetch()}
        />
      ) : (
        p && (
          <>
            <dl className="detail-grid">
              <div>
                <dt>결제 번호</dt>
                <dd>{p.id}</dd>
              </div>
              <div>
                <dt>고객</dt>
                <dd>
                  {p.customer.name} · {p.customer.memberNo}
                </dd>
              </div>
              <div>
                <dt>구매 상품</dt>
                <dd>{p.productName}</dd>
              </div>
              <div>
                <dt>원결제 지점</dt>
                <dd>
                  {session.branches.find((b) => b.id === p.branchId)?.name ??
                    p.branchId}
                </dd>
              </div>
              <div>
                <dt>서버 산정 금액</dt>
                <dd>{won(p.amountKrw)}</dd>
              </div>
              <div>
                <dt>결제 수단</dt>
                <dd>{p.method}</dd>
              </div>
              <div>
                <dt>상태</dt>
                <dd>
                  <Badge>{p.status}</Badge>
                </dd>
              </div>
              <div>
                <dt>등록 일시</dt>
                <dd>{dateTime(p.createdAt)}</dd>
              </div>
              <div>
                <dt>승인 일시</dt>
                <dd>{dateTime(p.approvedAt)}</dd>
              </div>
              <div>
                <dt>실패 일시</dt>
                <dd>{dateTime(p.failedAt)}</dd>
              </div>
            </dl>
            {p.status === "실패" && (
              <p className="tip">실패 결제에는 발급된 이용권이 없어요.</p>
            )}
            {pass.data && (
              <section className="my-5">
                <h3>발급 이용권</h3>
                <PassFacts pass={pass.data} />
              </section>
            )}
            {pass.error && (
              <ErrorState
                error={pass.error}
                retry={() => void pass.refetch()}
              />
            )}
            {p.refund && (
              <section className="my-5" role="status">
                <h3>전액 환불 완료</h3>
                <p>
                  {won(p.refund.amountKrw)} · {p.refund.reason}
                </p>
                <p>
                  {dateTime(p.refund.refundedAt)} · {p.refund.processedBy.name}
                </p>
                <p>
                  처리 지점:{" "}
                  {session.branches.find(
                    (b) => b.id === p.refund!.processingBranchId,
                  )?.name ?? p.refund.processingBranchId}
                </p>
              </section>
            )}
            {canRefund && !refunding && (
              <Button variant="danger" onClick={() => setRefunding(true)}>
                전액 환불
              </Button>
            )}
            {refunding && (
              <RefundForm
                paymentId={p.id}
                branchId={p.branchId}
                eligible={canRefund}
                onBusyChange={setBusy}
                onRefunded={async (result) => {
                  query.setQueryData(
                    ["data", session.user.id, scope, "payments", "detail", id],
                    result,
                  );
                  setRefunding(false);
                  await query.invalidateQueries({
                    queryKey: ["data", session.user.id],
                  });
                }}
              />
            )}
            {!canRefund && p.status === "승인" && (
              <p className="help">
                원결제 지점의 결제 권한과 이용권 사용·만료 조건을 충족하면
                환불할 수 있어요.
              </p>
            )}
          </>
        )
      )}
    </Panel>
  );
}
export function PassPanel({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const { session, scope } = useApp();
  return (
    <PassPanelSession
      key={`${session.user.id}:${scope}:${id}:${JSON.stringify(session.user.memberships)}`}
      id={id}
      onClose={onClose}
    />
  );
}
function PassPanelSession({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const { session, scope } = useApp();
  const query = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [result, setResult] = useState<Payment>();
  const pass = useQuery({
    queryKey: ["data", session.user.id, scope, "passes", "detail", id],
    queryFn: ({ signal }) => getPass(id, scope, signal),
    retry: false,
  });
  const canRefund = useRefundAvailability(pass.data);
  const p = pass.data;
  return (
    <Panel
      open
      title="보유 이용권 상세"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <MockPaymentNotice />
      {pass.isPending ? (
        <State loading />
      ) : pass.error ? (
        <ErrorState error={pass.error} retry={() => void pass.refetch()} />
      ) : (
        p && (
          <>
            <PassFacts pass={p} />
            {can(session.user, p.purchaseBranchId, "payments:read") && (
              <Link
                className="btn my-4"
                to={`/app/${scope}/payments?detail=${encodeURIComponent(p.purchasePaymentId)}`}
              >
                원결제 상세
              </Link>
            )}
            {canRefund && !refunding && (
              <Button variant="danger" onClick={() => setRefunding(true)}>
                전액 환불
              </Button>
            )}
            {refunding && (
              <RefundForm
                paymentId={p.purchasePaymentId}
                branchId={p.purchaseBranchId}
                eligible={canRefund}
                onBusyChange={setBusy}
                onRefunded={async (value) => {
                  setResult(value);
                  setRefunding(false);
                  await query.invalidateQueries({
                    queryKey: ["data", session.user.id],
                  });
                }}
              />
            )}
            {result?.refund && (
              <section role="status" className="tip my-3">
                <h3>전액 환불 완료</h3>
                <MockPaymentNotice />
                <p>
                  {won(result.refund.amountKrw)} · {result.refund.reason}
                </p>
                <p>{dateTime(result.refund.refundedAt)}</p>
              </section>
            )}
            {!canRefund && !result && (
              <p className="help">
                원결제 지점의 결제 권한과 이용권 사용·만료 조건을 충족하면
                환불할 수 있어요.
              </p>
            )}
          </>
        )
      )}
    </Panel>
  );
}
