import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { api } from "../../shared/api/client";
import type { components } from "../../shared/api/foundation.generated";
import { Button, FieldError } from "../../shared/ui/primitives";
import { accountError, invalidResetLink, PasswordForm } from "./PasswordForm";

export function PasswordReset() {
  const location = useLocation();
  return (
    <ResetForm key={`${location.key}:${location.hash}`} hash={location.hash} />
  );
}

function ResetForm({ hash }: { hash: string }) {
  const navigate = useNavigate();
  const [token] = useState(
    () => new URLSearchParams(hash.slice(1)).get("token") || "",
  );
  const [preview, setPreview] =
    useState<components["schemas"]["PasswordResetPreview"]>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const resetRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    url.hash = "";
    url.searchParams.delete("token");
    window.history.replaceState(
      window.history.state,
      "",
      url.pathname + url.search,
    );
    if (!token) return;
    const controller = new AbortController();
    resetRequest.current = controller;
    api<components["schemas"]["PasswordResetPreview"]>(
      "/password-resets/preview",
      {
        method: "POST",
        body: { token },
        signal: controller.signal,
      },
    )
      .then(setPreview)
      .catch((failure) => {
        if (!controller.signal.aborted) setError(accountError(failure));
      });
    return () => controller.abort();
  }, [token, retry]);

  return (
    <main className="page mx-auto max-w-lg">
      <section className="card grid gap-4 p-5">
        <h1>비밀번호 재설정</h1>
        {!token ? (
          <FieldError>{invalidResetLink}</FieldError>
        ) : error ? (
          <>
            <FieldError>{error}</FieldError>
            {error !== invalidResetLink && (
              <Button
                onClick={() => {
                  setError("");
                  setRetry(retry + 1);
                }}
              >
                다시 시도
              </Button>
            )}
          </>
        ) : preview ? (
          <>
            <p>{preview.emailHint}</p>
            <p className="help">
              만료 시각{" "}
              <time dateTime={preview.expiresAt}>
                {new Date(preview.expiresAt).toLocaleString("ko-KR")}
              </time>
            </p>
            <PasswordForm
              submit={async (newPassword) => {
                await api("/password-resets/complete", {
                  method: "POST",
                  body: { token, newPassword },
                  signal: resetRequest.current?.signal,
                });
                navigate("/login", {
                  replace: true,
                  state: { passwordResetComplete: true },
                });
              }}
            />
          </>
        ) : (
          <p role="status">재설정 링크를 확인하고 있어요.</p>
        )}
        <Link to="/login">로그인으로 이동</Link>
      </section>
    </main>
  );
}
