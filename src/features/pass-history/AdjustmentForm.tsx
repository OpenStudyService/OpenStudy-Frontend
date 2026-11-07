import { invalidateReads } from "../../shared/api/invalidateReads";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { ApiError } from "../../shared/api/client";
import { useIdempotency } from "../../shared/api/useIdempotency";
import { Button, FieldError } from "../../shared/ui/primitives";
import { Field } from "../organization/shared";
import type { Pass } from "../payments/model";
import { getPass } from "../payments/api";
import { PassFacts } from "../payments/PaymentPanels";
import { seatLeaveMessage, useSeatLeaveGuard } from "../seats/leaveGuard";
import { adjustmentBody, canAdjust, toDateInput } from "./model";
import type { PassAdjustment } from "./model";
import { adjustPass } from "./api";

export function AdjustmentForm({
  pass,
  onSaved,
  onCancel,
}: {
  pass: Pass;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { session } = useApp();
  const query = useQueryClient();
  // Background refreshes must never silently adopt a newer write version.
  const [base] = useState(pass);
  const [balance, setBalance] = useState(
    String(
      base.kind === "시간권"
        ? (base.remainingMinutes ?? "")
        : (base.remainingCreditKrw ?? ""),
    ),
  );
  const [expiry, setExpiry] = useState(toDateInput(base.expiresAt));
  const [noExpiry, setNoExpiry] = useState(base.expiresAt === null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<Error | null>(null);
  const [latest, setLatest] = useState<Pass>();
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertainBody, setUncertainBody] = useState<PassAdjustment>();
  const lock = useRef(false),
    lifecycle = useRef<AbortController | null>(null);
  const idempotency = useIdempotency();
  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    return () => controller.abort();
  }, []);
  const dirty =
    !!reason ||
    balance !==
      String(
        base.kind === "시간권"
          ? (base.remainingMinutes ?? "")
          : (base.remainingCreditKrw ?? ""),
      ) ||
    expiry !== toDateInput(base.expiresAt) ||
    noExpiry !== (base.expiresAt === null) ||
    busy;
  const guard = useSeatLeaveGuard(dirty);
  const denied =
    error instanceof ApiError &&
    [401, 403, 404].includes(error.status) &&
    error.detail.code !== "CSRF_INVALID";
  const permitted =
    canAdjust(session.user, pass) &&
    (!latest || canAdjust(session.user, latest)) &&
    !denied;
  const refresh = () =>
    invalidateReads(query, session.user.id, "passes", "customers");
  async function readLatest() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const value = await getPass(
        base.id,
        base.purchaseBranchId,
        lifecycle.current!.signal,
      );
      if (!lifecycle.current!.signal.aborted) {
        setLatest(value);
        setError(null);
      }
    } catch (cause) {
      if (!lifecycle.current!.signal.aborted) setError(cause as Error);
    } finally {
      lock.current = false;
      if (!lifecycle.current!.signal.aborted) setBusy(false);
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current || !permitted || (conflict && !latest)) return;
    let body: PassAdjustment;
    try {
      body = uncertainBody ?? {
        ...adjustmentBody(base, balance, expiry, noExpiry, reason),
        version: latest?.version ?? base.version,
      };
    } catch (cause) {
      setError(cause as Error);
      return;
    }
    lock.current = true;
    setBusy(true);
    setError(null);
    const signal = lifecycle.current!.signal;
    try {
      await adjustPass(
        base.id,
        base.purchaseBranchId,
        body,
        signal,
        idempotency.key(`adjust:${base.id}`, body),
      );
      signal.throwIfAborted();
      idempotency.committed();
      guard.saved();
      onSaved();
    } catch (cause) {
      if (!signal.aborted) {
        const failure = cause as Error;
        setError(failure);
        if (
          failure instanceof ApiError &&
          failure.detail.code === "VERSION_CONFLICT"
        ) {
          setConflict(true);
          setLatest(undefined);
          setUncertainBody(undefined);
        } else if (
          !(failure instanceof ApiError) ||
          failure.status === 0 ||
          failure.status >= 500 ||
          ["REQUEST_IN_PROGRESS", "CSRF_INVALID"].includes(failure.detail.code)
        )
          setUncertainBody(body);
      }
    } finally {
      // Aborting the browser does not guarantee that the server rolled back.
      void refresh();
      lock.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <form
      className="form-grid mt-5"
      onSubmit={submit}
      aria-label="이용권 수동 조정"
    >
      {guard.guard}
      <h3>이용권 수동 조정</h3>
      <p className="help">
        조정 후 값을 입력해 주세요. 변경한 항목만 저장하며, 사유는 원장에
        남아요. 입실 중인 이용권도 조정할 수 있어요.
      </p>
      <fieldset
        disabled={busy || !permitted || !!uncertainBody}
        className="grid gap-3"
      >
        {base.kind !== "기간권" && (
          <Field
            label={
              base.kind === "시간권"
                ? "조정 후 남은 시간 (분)"
                : "조정 후 남은 금액 (원)"
            }
          >
            <input
              type="number"
              min="0"
              step="1"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
            />
          </Field>
        )}
        {base.kind !== "기간권" && (
          <Field label="만료 없음">
            <input
              type="checkbox"
              checked={noExpiry}
              onChange={(e) => setNoExpiry(e.target.checked)}
            />
          </Field>
        )}
        <Field label="조정 후 만료 일시 (한국 시각)">
          <input
            type="datetime-local"
            step="1"
            value={expiry}
            disabled={noExpiry}
            onChange={(e) => setExpiry(e.target.value)}
          />
        </Field>
        <Field label="조정 사유 (필수)">
          <textarea
            required
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </fieldset>
      {error && (
        <FieldError>
          {error.message}
          {error instanceof ApiError &&
            Object.entries(error.detail.fieldErrors ?? {}).map(
              ([field, message]) => (
                <span className="block" key={field}>
                  {message}
                </span>
              ),
            )}
        </FieldError>
      )}
      {conflict && (
        <section className="tip" aria-label="조정 충돌 확인">
          <p>
            입력을 유지했어요. 최신값과 비교한 뒤 변경한 항목만 다시 저장해
            주세요.
          </p>
          <Button
            type="button"
            disabled={busy}
            onClick={() => void readLatest()}
          >
            최신 이용권 확인
          </Button>
          {latest && <PassFacts pass={latest} />}
        </section>
      )}
      {uncertainBody && (
        <p className="help">
          처리 결과를 확인하지 못했어요. 같은 요청으로 재시도해 중복 조정을
          방지합니다.
        </p>
      )}
      {!permitted && (
        <p className="help">
          환불 상태 또는 구매 지점 권한이 변경되어 조정할 수 없어요.
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="primary"
          disabled={busy || !permitted || (conflict && !latest)}
        >
          {busy
            ? "처리 중…"
            : uncertainBody
              ? "같은 조정 다시 시도"
              : conflict
                ? "최신 버전에 조정 저장"
                : "조정 저장"}
        </Button>
        <Button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!dirty || window.confirm(seatLeaveMessage)) {
              guard.saved();
              onCancel();
            }
          }}
        >
          조정 취소
        </Button>
      </div>
    </form>
  );
}
