import { useState, useEffect } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "../../app/context";
import { api } from "../../shared/api/client";
import type { components } from "../../shared/api/foundation.generated";
import type { CurrentUser } from "../../shared/domain/schema";
import {
  Button,
  ErrorState,
  FieldError,
  State,
} from "../../shared/ui/primitives";
import { closeStreams } from "../../shared/api/stream";
import { useUi } from "../../app/store";
type Preview = components["schemas"]["InvitationPreview"];
export function InvitationAccept() {
  const location = useLocation();
  return <InvitationAcceptance key={location.hash || location.key} />;
}
function InvitationAcceptance() {
  const location = useLocation(),
    query = useQueryClient(),
    navigate = useNavigate(),
    session = useSession();
  const [token] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get("token") || "",
  );
  const [preview, setPreview] = useState<Preview | null>(null),
    [error, setError] = useState<Error | null>(null),
    [busy, setBusy] = useState(false),
    [accepted, setAccepted] = useState(false);
  useEffect(() => {
    // Remove the secret before any subsequent navigation; keep it only in this mounted component.
    const cleanUrl = new URL(window.location.href);
    cleanUrl.hash = "";
    cleanUrl.searchParams.delete("token");
    window.history.replaceState(
      window.history.state,
      "",
      cleanUrl.pathname + cleanUrl.search,
    );
    const controller = new AbortController();
    if (!token) return;
    api<Preview>("/invitations/preview", {
      method: "POST",
      body: { token },
      signal: controller.signal,
    })
      .then(setPreview)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e as Error);
      });
    return () => controller.abort();
  }, [token]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      password = String(new FormData(form).get("password") || "");
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      if (
        preview.acceptanceMode === "EXISTING_ACCOUNT" &&
        session.data?.user.email !== preview.email
      ) {
        const current = await api<CurrentUser>("/auth/login", {
          method: "POST",
          body: { email: preview.email, password },
        });
        closeStreams();
        useUi.getState().clearPrivate();
        await query.cancelQueries();
        query.clear();
        query.setQueryData(["session"], current);
      } else {
        if (
          preview.acceptanceMode === "NEW_ACCOUNT" &&
          (password.length < 8 ||
            new TextEncoder().encode(password).length > 72)
        )
          throw new Error(
            "비밀번호는 8자 이상, UTF-8 72바이트 이하로 입력해 주세요.",
          );
        const result = await api<components["schemas"]["AcceptanceResult"]>(
          "/invitations/accept",
          {
            method: "POST",
            body:
              preview.acceptanceMode === "NEW_ACCOUNT"
                ? { mode: "NEW_ACCOUNT", token, email: preview.email, password }
                : { mode: "EXISTING_ACCOUNT", token, email: preview.email },
          },
        );
        if (result.nextAction === "LOGIN_FOR_APPROVAL_STATUS")
          setAccepted(true);
        else {
          await query.invalidateQueries({ queryKey: ["approval-status"] });
          navigate("/pending-approval", { replace: true });
        }
      }
    } catch (e) {
      setError(e as Error);
    } finally {
      form.reset();
      setBusy(false);
    }
  }
  const needsLogin =
    preview?.acceptanceMode === "EXISTING_ACCOUNT" &&
    session.data?.user.email !== preview.email;
  const needsLogout =
    preview?.acceptanceMode === "NEW_ACCOUNT" && !!session.data;
  const awaitingFirstApproval =
    preview?.acceptanceMode === "EXISTING_ACCOUNT" &&
    session.data?.user.email === preview.email &&
    session.data.sessionMode === "APPROVAL_ONLY";
  async function logoutForNewAccount() {
    setBusy(true);
    setError(null);
    try {
      await api("/auth/logout", { method: "POST", body: {} });
      closeStreams();
      useUi.getState().clearPrivate();
      await query.cancelQueries();
      query.clear();
      query.setQueryData(["session"], null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <section className="card w-full max-w-md p-7">
        <h1>
          {accepted ? "초대 수락이 완료됐어요" : "우리 팀에 초대되었어요"}
        </h1>
        {accepted ? (
          <p className="help my-5">
            승인 상태를 확인하려면 방금 설정한 비밀번호로 로그인해 주세요. 최종
            승인 후에도 다시 로그인해야 업무에 들어갈 수 있습니다.
          </p>
        ) : !token ? (
          <FieldError>유효한 이메일 초대 링크를 다시 열어 주세요.</FieldError>
        ) : !preview && !error ? (
          <State loading />
        ) : (
          preview &&
          (needsLogout ? (
            <div className="form-grid mt-6">
              <p>
                {preview.email}의 새 계정 초대입니다. 현재 계정에서 로그아웃한
                뒤 비밀번호를 설정해 주세요. 이 화면에서 계속 수락할 수
                있습니다.
              </p>
              <Button
                disabled={busy}
                onClick={() => void logoutForNewAccount()}
              >
                로그아웃하고 계속
              </Button>
            </div>
          ) : (
            <form className="form-grid mt-6" onSubmit={submit}>
              <p>
                {preview.name}님, {preview.branch.name}의{" "}
                {preview.role === "admin" ? "지점 관리자" : "일반 직원"}{" "}
                초대입니다.
              </p>
              <p className="help">
                기한: {new Date(preview.expiresAt).toLocaleString("ko-KR")}.
                수락 뒤 최종 승인이 필요합니다.
              </p>
              <label className="field">
                초대 이메일
                <input value={preview.email} readOnly autoComplete="username" />
              </label>
              {(preview.acceptanceMode === "NEW_ACCOUNT" || needsLogin) && (
                <label className="field">
                  {needsLogin ? "기존 계정 비밀번호" : "새 계정 비밀번호"}
                  <input
                    name="password"
                    type="password"
                    autoComplete={
                      needsLogin ? "current-password" : "new-password"
                    }
                    required
                    minLength={needsLogin ? 1 : 8}
                  />
                </label>
              )}
              {preview.acceptanceMode === "EXISTING_ACCOUNT" && (
                <p className="help">
                  기존 비밀번호로 로그인하여 수락합니다. 회수된 소속도
                  재초대·수락·승인을 거쳐 복구하며 다른 지점의 업무 권한은
                  유지됩니다.
                </p>
              )}
              {awaitingFirstApproval && (
                <p className="help">
                  첫 지점의 최종 승인 후 다시 로그인해야 다른 지점 초대를 수락할
                  수 있습니다. 승인 뒤 이메일의 초대 링크를 다시 열어 주세요.
                </p>
              )}
              <Button
                type="submit"
                variant="primary"
                disabled={busy || awaitingFirstApproval}
              >
                {busy
                  ? "처리 중…"
                  : needsLogin
                    ? "초대 계정으로 로그인"
                    : "초대 수락"}
              </Button>
            </form>
          ))
        )}
        {error && <ErrorState error={error} />}
        <Link
          to="/login"
          className="mt-5 block text-xs text-primary"
          onClick={async (event) => {
            if (!accepted || !session.data) return;
            event.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await api("/auth/logout", { method: "POST", body: {} });
              closeStreams();
              useUi.getState().clearPrivate();
              await query.cancelQueries();
              query.clear();
              query.setQueryData(["session"], null);
              navigate("/login", { replace: true });
            } catch (e) {
              setError(e as Error);
            } finally {
              setBusy(false);
            }
          }}
        >
          로그인으로 돌아가기
        </Link>
      </section>
    </main>
  );
}
export function PendingApproval() {
  const session = useSession(),
    query = useQueryClient(),
    navigate = useNavigate(),
    clearPrivate = useUi((s) => s.clearPrivate);
  const [error, setError] = useState<Error | null>(null),
    [leaving, setLeaving] = useState(false);
  const status = useQuery({
    queryKey: ["approval-status", session.data?.user.id],
    queryFn: ({ signal }) =>
      api<components["schemas"]["ApprovalStatus"]>(
        "/invitations/approval-status",
        { signal },
      ),
    enabled: !!session.data,
    retry: false,
    refetchInterval: 15000,
  });
  async function leave() {
    setLeaving(true);
    setError(null);
    try {
      await api("/auth/logout", { method: "POST", body: {} });
      closeStreams();
      clearPrivate();
      await query.cancelQueries();
      query.clear();
      navigate("/login", { replace: true });
    } catch (e) {
      setError(e as Error);
    } finally {
      setLeaving(false);
    }
  }
  if (session.isPending) return <State loading />;
  if (session.error)
    return (
      <ErrorState error={session.error} retry={() => void session.refetch()} />
    );
  if (!session.data) return <Navigate to="/login" replace />;
  const approved =
    (session.data.user.status === "활성" &&
      session.data.sessionMode === "APPROVAL_ONLY") ||
    status.data?.requiresLogin;
  const workspace =
    session.data.sessionMode !== "APPROVAL_ONLY" &&
    session.data.user.status === "활성";
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <section className="card w-full max-w-md p-7">
        <h1>
          {approved ? "승인이 완료됐어요" : "최종 승인을 기다리고 있어요"}
        </h1>
        <p className="help my-5">
          {approved
            ? "업무 공간에 들어가려면 다시 로그인해 주세요."
            : "관리자가 승인하면 해당 지점의 업무 공간을 사용할 수 있어요."}
        </p>
        {status.data?.invitations?.map((i) => (
          <article className="my-3" key={i.invitationId}>
            <h2>{i.branchName}</h2>
            <p>{i.status}</p>
            {i.rejectionReason && <p>반려 사유: {i.rejectionReason}</p>}
          </article>
        ))}
        {status.error && (
          <ErrorState
            error={status.error}
            retry={() => void status.refetch()}
          />
        )}
        {error && <FieldError>{error.message}</FieldError>}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void status.refetch()}>
            승인 상태 새로고침
          </Button>
          <Button disabled={leaving} onClick={() => void leave()}>
            {approved ? "다시 로그인" : "로그아웃"}
          </Button>
        </div>
        {workspace && (
          <Link
            className="btn mt-4"
            to={`/app/${session.data.branches[0]?.id || "all"}/home`}
          >
            기존 지점 업무로 돌아가기
          </Link>
        )}
      </section>
    </main>
  );
}
