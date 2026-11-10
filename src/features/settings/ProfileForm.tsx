import { useEffect, useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { useUi } from "../../app/store";
import { api, ApiError } from "../../shared/api/client";
import type { components } from "../../shared/api/foundation.generated";
import type { CurrentUser } from "../../shared/domain/schema";
import { schemas } from "../../shared/domain/schema";
import { Avatar, Button, FieldError } from "../../shared/ui/primitives";
import { SaveError } from "../organization/shared";

type ProfileResponse = components["schemas"]["CurrentUser"];

export function ProfileForm() {
  const { session } = useApp();
  const query = useQueryClient();
  const toast = useUi((state) => state.toast);
  const id = useId();
  const [nickname, setNickname] = useState(session.user.nickname);
  // Background session refreshes must not advance a dirty form's write version.
  const [version, setVersion] = useState(session.user.version);
  const [error, setError] = useState<Error | null>(null);
  const [latest, setLatest] = useState("");
  const [busy, setBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    return () => active.abort();
  }, []);
  const allowed =
    session.sessionMode === "WORKSPACE" && session.user.status === "활성";
  const fieldError =
    error instanceof ApiError && !!error.detail.fieldErrors?.nickname;

  async function accept(current: ProfileResponse) {
    if (
      !schemas.employees.safeParse(current.user).success ||
      current.user.id !== session.user.id ||
      !Array.isArray(current.branches) ||
      !["WORKSPACE", "APPROVAL_ONLY"].includes(current.sessionMode)
    ) {
      throw new ApiError(0, {
        code: "INVALID_RESPONSE",
        message: "저장 결과를 확인하지 못했습니다. 최신 정보를 확인해 주세요.",
      });
    }
    await query.cancelQueries({ queryKey: ["session"] });
    controller.current?.signal.throwIfAborted();
    // A late response must not restore a session cleared by logout or revocation.
    const active = query.getQueryData<CurrentUser | null>(["session"]);
    if (!active || active.user.id !== session.user.id)
      throw new DOMException("Session changed", "AbortError");
    query.setQueryData(["session"], current);
    return (
      current.sessionMode === "WORKSPACE" && current.user.status === "활성"
    );
  }

  async function updatePhoto(file?: File) {
    if (!allowed || busy) return;
    setPhotoError("");
    if (
      file &&
      !["image/jpeg", "image/png", "image/webp"].includes(file.type)
    ) {
      setPhotoError("JPG, PNG, WebP 사진을 선택해 주세요.");
      return;
    }
    if (file && file.size > 5_242_880) {
      setPhotoError("사진은 5MB 이하로 선택해 주세요.");
      return;
    }
    setBusy(true);
    try {
      const body = file ? new FormData() : undefined;
      if (file) body?.append("file", file);
      const updated = await api<ProfileResponse>("/me/avatar", {
        method: file ? "PUT" : "DELETE",
        body,
        signal: controller.current?.signal,
      });
      if (await accept(updated)) {
        setVersion((previous) =>
          previous === updated.user.version - 1
            ? updated.user.version
            : previous,
        );
        void query.invalidateQueries({
          queryKey: ["data", session.user.id],
          refetchType: "none",
        });
        toast(file ? "프로필 사진을 변경했어요." : "프로필 사진을 삭제했어요.");
      }
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === "AbortError")
        return;
      setPhotoError(
        (failure instanceof ApiError && failure.detail.fieldErrors?.file) ||
          (failure as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card mb-5" aria-labelledby={`${id}-heading`}>
      <header className="card-header">
        <h2 id={`${id}-heading`}>내 프로필</h2>
      </header>
      <div className="grid gap-6 p-5 sm:grid-cols-[120px_minmax(0,500px)]">
        <div>
          <Avatar
            name={session.user.nickname || session.user.name}
            size="large"
            src={session.user.avatar}
          />
          <label className="field mt-3">
            프로필 사진
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy || !allowed}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void updatePhoto(file);
              }}
            />
          </label>
          {session.user.avatar && (
            <Button
              type="button"
              disabled={busy || !allowed}
              onClick={() => void updatePhoto()}
            >
              사진 삭제
            </Button>
          )}
          {photoError && <FieldError>{photoError}</FieldError>}
        </div>
        <form
          className="grid gap-4"
          noValidate
          aria-label="내 프로필 저장"
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy || !allowed) return;
            toast("");
            setError(null);
            if (!nickname.trim() || nickname.length > 100) {
              setError(
                new ApiError(422, {
                  code: "VALIDATION_FAILED",
                  message: "입력 형식을 확인해 주세요.",
                  fieldErrors: {
                    nickname: "닉네임을 1~100자로 입력해 주세요.",
                  },
                }),
              );
              return;
            }
            setBusy(true);
            try {
              const updated = await api<ProfileResponse>("/me/profile", {
                method: "PATCH",
                signal: controller.current?.signal,
                body: {
                  nickname,
                  version,
                } satisfies components["schemas"]["ProfileUpdate"],
              });
              if (await accept(updated)) {
                setNickname(updated.user.nickname);
                setVersion(updated.user.version);
                setLatest("");
                void query.invalidateQueries({
                  queryKey: ["data", session.user.id],
                  refetchType: "none",
                });
                toast("프로필을 저장했어요.");
              }
            } catch (failure) {
              if (
                failure instanceof DOMException &&
                failure.name === "AbortError"
              )
                return;
              setError(failure as Error);
              if (failure instanceof ApiError && failure.status === 403)
                void query.invalidateQueries({ queryKey: ["session"] });
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="field">
            <span>로그인 이메일 (ID)</span>
            <p>{session.user.email}</p>
            <p className="help">로그인 ID는 변경할 수 없습니다.</p>
          </div>
          <label className="field" htmlFor={`${id}-nickname`}>
            닉네임
            <input
              id={`${id}-nickname`}
              value={nickname}
              maxLength={100}
              required
              disabled={busy || !allowed}
              aria-invalid={fieldError}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(event) => setNickname(event.target.value)}
            />
          </label>
          <div id={`${id}-error`}>
            <SaveError
              error={error}
              latest={latest}
              fieldLabels={{ nickname: "닉네임", version: "계정 정보" }}
              refresh={async () => {
                try {
                  const current = await api<ProfileResponse>("/me", {
                    signal: controller.current?.signal,
                  });
                  if (await accept(current)) {
                    setVersion(current.user.version);
                    setLatest(
                      `닉네임 ${current.user.nickname} / 이름 ${current.user.name} (v${current.user.version})`,
                    );
                  }
                } catch (failure) {
                  if (!(
                    failure instanceof DOMException &&
                    failure.name === "AbortError"
                  ))
                    setError(failure as Error);
                }
              }}
            />
          </div>
          <Button type="submit" variant="primary" disabled={busy || !allowed}>
            {busy ? "처리 중…" : "프로필 저장"}
          </Button>
        </form>
      </div>
    </section>
  );
}
