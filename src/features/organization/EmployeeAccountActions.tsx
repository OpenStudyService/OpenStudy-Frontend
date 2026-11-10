import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { organizationRead } from "./api";
import { useApp } from "../../app/context";
import { useUi } from "../../app/store";
import { api, ApiError } from "../../shared/api/client";
import type { components } from "../../shared/api/foundation.generated";
import { Button, FieldError } from "../../shared/ui/primitives";
import { accountError } from "../auth/PasswordForm";
import { canManageBranch, type Employee } from "./model";

export function EmployeeAccountActions({ employee }: { employee: Employee }) {
  const { session, scope } = useApp();
  const actor = session.user;
  const toast = useUi((state) => state.toast);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const manages = (target: Employee) =>
    !target.owner &&
    target.memberships.some(
      (m) =>
        m.status === "활성" &&
        canManageBranch(actor, m.branchId, "people:manage"),
    );
  const managesInScope = manages(employee);
  const path = `/employees/${encodeURIComponent(employee.id)}`;
  // The detail response is scoped to the selected branch. The commands use all managed branches.
  const broader = useQuery({
    queryKey: ["data", actor.id, "all", "organization", `${path}?scope=all`],
    queryFn: ({ signal }) =>
      organizationRead<Employee>(`${path}?scope=all`, signal),
    enabled:
      actor.status === "활성" &&
      !actor.owner &&
      !employee.owner &&
      scope !== "all" &&
      !managesInScope &&
      actor.memberships.some(
        (m) =>
          m.branchId !== scope &&
          canManageBranch(actor, m.branchId, "people:manage"),
      ),
    retry: false,
  });
  const allowed =
    actor.status === "활성" &&
    (actor.owner ||
      managesInScope ||
      (broader.isEnabled &&
        !broader.isError &&
        broader.data &&
        manages(broader.data)));
  if (!allowed) return null;

  async function run(action: "password-reset" | "login-unlock") {
    if (busy) return;
    if (
      action === "password-reset" &&
      !window.confirm(
        `${employee.name} 님의 기존 비밀번호는 즉시 사용할 수 없게 되고 모든 기기에서 로그아웃됩니다. 재설정 이메일 발송을 요청할까요?`,
      )
    )
      return;
    setBusy(true);
    setError("");
    const endpoint = `${path}/${action}`;
    try {
      if (action === "password-reset") {
        await api<components["schemas"]["PasswordResetRequested"]>(endpoint, {
          method: "POST",
        });
        toast("비밀번호 재설정 이메일 발송이 예약됐어요.");
      } else {
        const result = await api<components["schemas"]["LoginUnlockResult"]>(
          endpoint,
          { method: "POST" },
        );
        toast(
          result.wasLocked
            ? "로그인 잠금을 해제했어요."
            : "잠긴 상태가 아니었어요.",
        );
      }
    } catch (failure) {
      if (failure instanceof ApiError) {
        if (failure.detail.code === "SELF_RESET_FORBIDDEN")
          return setError("설정에서 본인 비밀번호를 변경해 주세요.");
        if (failure.status === 403)
          return setError("이 직원의 계정을 관리할 권한이 없어요.");
        if (failure.status === 404) return setError("직원을 찾을 수 없어요.");
        if (failure.detail.code === "INVALID_STATE")
          return setError("활성 계정에서만 이 작업을 할 수 있어요.");
      }
      setError(accountError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {actor.id !== employee.id && employee.status === "활성" && (
        <Button disabled={busy} onClick={() => void run("password-reset")}>
          비밀번호 초기화
        </Button>
      )}
      <Button disabled={busy} onClick={() => void run("login-unlock")}>
        로그인 잠금 해제
      </Button>
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}
