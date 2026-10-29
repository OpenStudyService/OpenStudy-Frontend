import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { ApiError } from "../../shared/api/client";
import { Badge, Button, FieldError } from "../../shared/ui/primitives";
import { customerApi } from "./api";
import {
  canCreateCustomer,
  customerKeys,
  createBody,
  draftFromCustomer,
  updateBody,
  validateDraft,
} from "./model";
import type { Customer, CustomerDraft } from "./model";
import { useCustomerLeaveGuard, useCustomerWrite } from "./hooks";

export function CustomerForm({
  customer,
  onSaved,
}: {
  customer?: Customer;
  onSaved: () => void;
}) {
  const { session, scope } = useApp(),
    id = useId(),
    query = useQueryClient(),
    write = useCustomerWrite();
  const [base] = useState(customer),
    [initial] = useState(() => draftFromCustomer(customer, scope));
  const [draft, setDraft] = useState(initial),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [failure, setFailure] = useState<Error | null>(null),
    [latest, setLatest] = useState<Customer | null>(null),
    [conflict, setConflict] = useState(false),
    [reading, setReading] = useState(false);
  const leave = useCustomerLeaveGuard(
    JSON.stringify(initial) !== JSON.stringify(draft),
  );
  const denied =
    (latest && !latest.canEdit) ||
    (failure instanceof ApiError &&
      [401, 403, 404].includes(failure.status) &&
      failure.detail.code !== "CSRF_INVALID");
  const branches = session.branches.filter(
    (branch) =>
      branch.status === "운영 중" &&
      canCreateCustomer(session.user, branch.id) &&
      (scope === "all" || branch.id === scope),
  );
  async function refresh() {
    if (!base || write.busy || reading) return;
    setReading(true);
    setLatest(null);
    try {
      const value = await write.run(
        "customer-latest",
        {},
        (signal) => customerApi.detail(scope, base.id, signal),
        false,
      );
      setLatest(value);
      query.setQueryData(
        customerKeys.detail(session.user.id, scope, base.id),
        value,
      );
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        setFailure(error as Error);
    } finally {
      setReading(false);
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (write.busy || reading || denied || (conflict && !latest)) return;
    const checked = validateDraft(draft, !base);
    if (
      !base &&
      !branches.some((branch) => branch.id === draft.registeredBranchId)
    )
      checked.registeredBranchId = "등록 가능한 지점을 선택해 주세요.";
    setErrors(checked);
    if (Object.keys(checked).length) return;
    const update = base
      ? updateBody(base, draft, latest?.version ?? base.version)
      : null;
    const create = !base ? createBody(draft) : null;
    if (base && !update) {
      leave.saved();
      onSaved();
      return;
    }
    try {
      await write.run(
        base ? `customers/${base.id}` : "customers/new",
        update ?? create,
        (signal, key) =>
          base
            ? customerApi.update(scope, base.id, update!, signal)
            : customerApi.create(scope, create!, signal, key),
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
  function change(key: keyof CustomerDraft, value: string) {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => ({ ...previous, [key]: "" }));
  }
  const fields: {
    key: keyof CustomerDraft;
    label: string;
    max?: number;
    required?: boolean;
  }[] = [
    { key: "registeredBranchId", label: "등록 지점", required: true },
    { key: "name", label: "회원 이름", max: 100, required: true },
    { key: "phone", label: "연락처", max: 30, required: true },
    { key: "email", label: "이메일", max: 254 },
    { key: "memo", label: "응대 메모", max: 1000 },
  ];
  return (
    <form className="form-grid" noValidate onSubmit={submit}>
      {leave.guard}
      {fields.map((field) => {
        const inputId = `${id}-${field.key}`,
          errorId = `${inputId}-error`;
        const props = {
          id: inputId,
          "aria-label": field.label,
          "aria-required": !!field.required,
          "aria-invalid": !!errors[field.key],
          "aria-describedby": errors[field.key] ? errorId : undefined,
          value: draft[field.key],
          disabled:
            write.busy ||
            reading ||
            !!denied ||
            (field.key === "registeredBranchId" && !!base),
          onChange: (
            event: React.ChangeEvent<
              HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
            >,
          ) => change(field.key, event.target.value),
        };
        return (
          <div className="field" key={field.key}>
            <label htmlFor={inputId}>
              {field.label}
              {field.required && (
                <span className="ml-1 text-primary" aria-hidden="true">
                  *
                </span>
              )}
            </label>
            {field.key === "registeredBranchId" ? (
              <select {...props}>
                <option value="">
                  {base && !base.registeredBranchId
                    ? "등록 지점 미지정"
                    : "선택해 주세요"}
                </option>
                {base?.registeredBranchId &&
                  !branches.some(
                    (branch) => branch.id === base.registeredBranchId,
                  ) && (
                    <option value={base.registeredBranchId}>
                      {session.branches.find(
                        (branch) => branch.id === base.registeredBranchId,
                      )?.name ?? base.registeredBranchId}
                    </option>
                  )}
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            ) : field.key === "memo" ? (
              <textarea {...props} maxLength={field.max} />
            ) : (
              <input
                {...props}
                maxLength={field.max}
                type={
                  field.key === "phone"
                    ? "tel"
                    : field.key === "email"
                      ? "email"
                      : "text"
                }
                autoComplete="off"
              />
            )}
            {errors[field.key] && (
              <FieldError id={errorId}>{errors[field.key]}</FieldError>
            )}
          </div>
        );
      })}
      {failure && <FieldError>{failure.message}</FieldError>}
      {errors.body && <FieldError>{errors.body}</FieldError>}
      {conflict && (
        <section className="tip" aria-label="버전 충돌 확인">
          <p>
            입력 내용은 유지했어요. 최신 회원 정보와 비교한 뒤 다시 저장해
            주세요.
          </p>
          <Button
            type="button"
            disabled={write.busy || reading}
            onClick={() => void refresh()}
          >
            최신 내용 확인
          </Button>
          {latest && <LatestCustomer customer={latest} />}
        </section>
      )}
      {denied && (
        <p className="help">
          이 회원을 수정할 수 없어요. 권한과 조회 범위를 다시 확인해 주세요.
        </p>
      )}
      <div className="sticky bottom-0 flex justify-end border-t border-line bg-surface pt-4">
        <Button
          type="submit"
          variant="primary"
          disabled={write.busy || reading || !!denied || (conflict && !latest)}
        >
          {write.busy
            ? "처리 중…"
            : base
              ? latest
                ? "최신 기준으로 다시 저장"
                : "저장하기"
              : "회원 등록"}
        </Button>
      </div>
    </form>
  );
}

export function LatestCustomer({ customer }: { customer: Customer }) {
  return (
    <div className="mt-3" role="status">
      <h3>최신 회원 · 버전 {customer.version}</h3>
      <dl className="grid gap-2">
        {[
          ["회원 이름", customer.name],
          ["연락처", customer.phone],
          ["이메일", customer.email ?? "없음"],
          ["응대 메모", customer.memo ?? "없음"],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className="whitespace-pre-wrap break-words">{value}</dd>
          </div>
        ))}
        <div>
          <dt>상태</dt>
          <dd>
            <Badge>{customer.status}</Badge>
          </dd>
        </div>
        <div>
          <dt>상태 사유</dt>
          <dd className="whitespace-pre-wrap break-words">
            {customer.statusReason ?? "없음"}
          </dd>
        </div>
      </dl>
    </div>
  );
}
