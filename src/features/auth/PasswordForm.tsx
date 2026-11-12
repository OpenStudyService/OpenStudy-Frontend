import { useState } from "react";
import { ApiError } from "../../shared/api/client";
import {
  newPasswordError,
  newPasswordRequirements,
} from "../../shared/domain/password";
import { Button, FieldError } from "../../shared/ui/primitives";

export const invalidResetLink =
  "이 링크를 사용할 수 없습니다. 관리자에게 재설정 링크를 다시 요청해 주세요.";

export function accountError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 429)
      return "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.";
    if (error.detail.code === "PASSWORD_RESET_LINK_INVALID")
      return invalidResetLink;
  }
  return (error as Error).message;
}

export function PasswordForm({
  change,
  submit,
}: {
  change?: boolean;
  submit: (newPassword: string, currentPassword: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState(false);
  return (
    <form
      className="grid gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || invalid) return;
        const form = event.currentTarget;
        const data = new FormData(form);
        const next = String(data.get("newPassword") ?? "");
        const current = String(data.get("currentPassword") ?? "");
        const validation = newPasswordError(next);
        setError("");
        setFields(validation ? { newPassword: validation } : {});
        if (validation) return;
        setBusy(true);
        try {
          await submit(next, current);
          form.reset();
        } catch (failure) {
          if (failure instanceof ApiError) {
            const { code, fieldErrors } = failure.detail;
            if (code === "PASSWORD_RESET_LINK_INVALID") {
              setInvalid(true);
              form.reset();
            }
            if (
              code === "CURRENT_PASSWORD_MISMATCH" ||
              code === "PASSWORD_SAME_AS_CURRENT"
            ) {
              const field =
                code === "CURRENT_PASSWORD_MISMATCH"
                  ? "currentPassword"
                  : "newPassword";
              setFields({
                [field]: fieldErrors?.[field] || failure.detail.message,
              });
              return;
            }
            if (
              code === "VALIDATION_FAILED" &&
              (fieldErrors?.newPassword ||
                (change && fieldErrors?.currentPassword))
            ) {
              setFields(fieldErrors);
              return;
            }
          }
          setError(accountError(failure));
        } finally {
          setBusy(false);
        }
      }}
    >
      {change && (
        <label className="field">
          기존 비밀번호
          <input
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            disabled={busy}
            aria-invalid={!!fields.currentPassword}
          />
          {fields.currentPassword && (
            <FieldError>{fields.currentPassword}</FieldError>
          )}
        </label>
      )}
      <label className="field">
        새 비밀번호
        <input
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          disabled={busy || invalid}
          aria-invalid={!!fields.newPassword}
          aria-describedby="new-password-requirements"
        />
        {fields.newPassword && (
          <FieldError id="new-password-requirements">
            {fields.newPassword}
          </FieldError>
        )}
      </label>
      {!fields.newPassword && (
        <p className="help" id="new-password-requirements">
          {newPasswordRequirements}
        </p>
      )}
      {error && <FieldError>{error}</FieldError>}
      <Button type="submit" variant="primary" disabled={busy || invalid}>
        {change ? "비밀번호 변경" : "새 비밀번호 저장"}
      </Button>
    </form>
  );
}
