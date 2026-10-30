import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { useApp } from "../../app/context";
import { useUi } from "../../app/store";
import { ApiError } from "../../shared/api/client";
import { displayDate } from "../../shared/domain/schema";
import {
  Badge,
  Button,
  ErrorState,
  FieldError,
  Panel,
  State,
} from "../../shared/ui/primitives";
import { customerApi } from "./api";
import { canCreateCustomer, customerStatuses } from "./model";
import type { Customer } from "./model";
import {
  useCustomerDetail,
  useCustomerLeaveGuard,
  useCustomerWrite,
} from "./hooks";
import { CustomerForm, LatestCustomer } from "./CustomerForm";

export function CustomerPanel(props: { id: string; onClose: () => void }) {
  const { session, scope } = useApp();
  const context = JSON.stringify([
    session.user.id,
    scope,
    session.user.status,
    session.user.owner,
    session.user.memberships,
  ]);
  return <CustomerPanelSession key={`${props.id}:${context}`} {...props} />;
}
function CustomerPanelSession({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const { session, scope } = useApp(),
    [params, setParams] = useSearchParams(),
    row = useCustomerDetail(id),
    toast = useUi((state) => state.toast);
  const creating = id === "new",
    editing = params.get("edit") === "1",
    changingStatus = params.get("action") === "status",
    customer = row.data;
  function mode(kind: "edit" | "action" | "", value = "") {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete("edit");
      next.delete("action");
      if (kind && value) next.set(kind, value);
      return next;
    });
  }
  const canCreate = session.branches.some(
    (branch) =>
      branch.status === "운영 중" &&
      (scope === "all" || branch.id === scope) &&
      canCreateCustomer(session.user, branch.id),
  );
  const denied =
    row.error instanceof ApiError && [401, 403, 404].includes(row.error.status);
  const keepEditor = !!customer && (editing || changingStatus) && !denied;
  return (
    <Panel
      open
      title={
        creating
          ? "회원 등록"
          : editing
            ? "회원 수정"
            : changingStatus
              ? "회원 상태 변경"
              : (customer?.name ?? "회원 상세")
      }
      description="회원 정보와 응대 내용을 확인해 주세요."
      onClose={onClose}
    >
      {keepEditor && row.error && (
        <ErrorState error={row.error} retry={() => void row.refetch()} />
      )}
      {creating ? (
        canCreate ? (
          <CustomerForm
            onSaved={() => {
              toast("회원을 등록했어요.");
              onClose();
            }}
          />
        ) : (
          <State title="회원 등록 권한이 없어요" />
        )
      ) : row.isPending ? (
        <State loading />
      ) : row.error && !keepEditor ? (
        <ErrorState error={row.error} retry={() => void row.refetch()} />
      ) : (
        customer &&
        (editing || changingStatus ? (
          customer.canEdit && session.user.status === "활성" ? (
            editing ? (
              <CustomerForm
                key={`${id}:edit`}
                customer={customer}
                onSaved={() => {
                  toast("회원 정보를 저장했어요.");
                  mode("");
                }}
              />
            ) : (
              <CustomerStatusForm
                key={`${id}:status`}
                customer={customer}
                onSaved={() => {
                  toast("회원 상태를 저장했어요.");
                  mode("");
                }}
              />
            )
          ) : (
            <State title="이 회원을 수정할 권한이 없어요" />
          )
        ) : (
          <>
            {params.get("action") && (
              <FieldError>이 작업을 수행할 수 없어요.</FieldError>
            )}
            <dl className="grid gap-4">
              {[
                ["회원번호", customer.memberNo],
                ["회원 이름", customer.name],
                ["연락처", customer.phone],
                ["이메일", customer.email ?? "없음"],
                [
                  "등록 지점",
                  customer.registeredBranchId
                    ? (session.branches.find(
                        (branch) => branch.id === customer.registeredBranchId,
                      )?.name ?? customer.registeredBranchId)
                    : "등록 지점 미지정",
                ],
                ["응대 메모", customer.memo ?? "없음"],
                ["상태 사유", customer.statusReason ?? "없음"],
                ["등록일", displayDate(customer.registeredAt)],
                ["수정일", displayDate(customer.updatedAt)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-muted">{label}</dt>
                  <dd className="whitespace-pre-wrap break-words">{value}</dd>
                </div>
              ))}
              <div>
                <dt className="text-muted">상태</dt>
                <dd>
                  <Badge>{customer.status}</Badge>
                </dd>
              </div>
            </dl>
            {customer.canEdit && session.user.status === "활성" && (
              <div className="mt-6 flex flex-wrap gap-2">
                <Button onClick={() => mode("edit", "1")}>수정하기</Button>
                <Button onClick={() => mode("action", "status")}>
                  상태 변경
                </Button>
              </div>
            )}
          </>
        ))
      )}
    </Panel>
  );
}

function CustomerStatusForm({
  customer,
  onSaved,
}: {
  customer: Customer;
  onSaved: () => void;
}) {
  const { session, scope } = useApp(),
    query = useQueryClient(),
    write = useCustomerWrite();
  const [base, setBase] = useState(customer),
    [status, setStatus] = useState(customer.status),
    [reason, setReason] = useState("");
  const [failure, setFailure] = useState<Error | null>(null),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [conflict, setConflict] = useState(false),
    [latest, setLatest] = useState<Customer | null>(null);
  const leave = useCustomerLeaveGuard(status !== customer.status || !!reason);
  const denied =
    !base.canEdit ||
    (failure instanceof ApiError &&
      [401, 403, 404].includes(failure.status) &&
      failure.detail.code !== "CSRF_INVALID");
  async function refresh() {
    if (write.busy) return;
    setLatest(null);
    try {
      const value = await write.run(
        "customer-status-latest",
        {},
        (signal) => customerApi.detail(scope, customer.id, signal),
        false,
      );
      setLatest(value);
      setBase(value);
      query.setQueryData(
        ["data", session.user.id, scope, "customers", "detail", customer.id],
        value,
      );
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        setFailure(error as Error);
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (write.busy || denied || (conflict && !latest)) return;
    if (!reason.trim() || reason.trim().length > 500) {
      setErrors({ reason: "변경 사유를 1~500자로 입력해 주세요." });
      return;
    }
    const body = { version: base.version, status, reason: reason.trim() };
    try {
      await write.run(`customers/${customer.id}/status`, body, (signal) =>
        customerApi.changeStatus(scope, customer.id, body, signal),
      );
      leave.saved();
      onSaved();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFailure(error as Error);
      setLatest(null);
      if (error instanceof ApiError) {
        setErrors(error.detail.fieldErrors ?? {});
        if (error.status === 409 && error.detail.code === "VERSION_CONFLICT")
          setConflict(true);
      }
    }
  }
  return (
    <form className="form-grid" noValidate onSubmit={submit}>
      {leave.guard}
      <label className="field">
        <span>상태</span>
        <select
          aria-label="상태"
          value={status}
          disabled={write.busy || denied}
          onChange={(event) =>
            setStatus(event.target.value as Customer["status"])
          }
        >
          {customerStatuses.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        {errors.status && <FieldError>{errors.status}</FieldError>}
      </label>
      <label className="field">
        <span>변경 사유</span>
        <textarea
          aria-label="변경 사유"
          required
          aria-required="true"
          aria-invalid={!!errors.reason}
          maxLength={500}
          value={reason}
          disabled={write.busy || denied}
          onChange={(event) => {
            setReason(event.target.value);
            setErrors((previous) => ({ ...previous, reason: "" }));
          }}
        />
        {errors.reason && <FieldError>{errors.reason}</FieldError>}
      </label>
      {failure && <FieldError>{failure.message}</FieldError>}
      {conflict && (
        <section className="tip" aria-label="버전 충돌 확인">
          <p>
            입력은 유지했어요. 최신 상태를 비교한 뒤 명시적으로 다시 저장해
            주세요.
          </p>
          <Button
            type="button"
            disabled={write.busy}
            onClick={() => void refresh()}
          >
            최신 내용 확인
          </Button>
          {latest && <LatestCustomer customer={latest} />}
        </section>
      )}
      {denied && <p className="help">이 회원의 상태를 변경할 수 없어요.</p>}
      <Button
        type="submit"
        variant="primary"
        disabled={write.busy || denied || (conflict && !latest)}
      >
        {write.busy
          ? "처리 중…"
          : latest
            ? "최신 기준으로 상태 저장"
            : "상태 저장"}
      </Button>
    </form>
  );
}
