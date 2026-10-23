import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, MOCK } from "../../shared/api/client";
import type { CurrentUser } from "../../shared/domain/schema";
import { Button, FieldError, State } from "../../shared/ui/primitives";
import { Icon } from "../../shared/ui/Icon";
import { RoomArt } from "../../shared/ui/RoomArt";
import { useSession } from "../../app/context";
import { useUi } from "../../app/store";
const schema = z.object({
  email: z.email("이메일 형식을 확인해 주세요."),
  password: z
    .string()
    .min(1, "비밀번호를 입력해 주세요.")
    .refine(
      (value) => new TextEncoder().encode(value).length <= 72,
      "비밀번호는 UTF-8 기준 72바이트 이하로 입력해 주세요.",
    ),
});
export function ThemePicker() {
  const { theme, setTheme } = useUi();
  return (
    <div className="flex gap-2" role="group" aria-label="화면 테마">
      {(["forest", "navy", "sand"] as const).map((t, i) => (
        <button
          key={t}
          type="button"
          aria-label={`${["포레스트", "네이비", "샌드"][i]} 테마`}
          aria-pressed={theme === t}
          onClick={() => setTheme(t)}
          className="grid h-8 w-8 place-items-center rounded-full border"
          style={{
            borderColor: theme === t ? "var(--primary)" : "transparent",
          }}
        >
          <span
            className="h-4 w-4 rounded-full"
            style={{ background: ["#163b31", "#1c2e4a", "#45352d"][i] }}
          />
        </button>
      ))}
    </div>
  );
}
export function Login() {
  const session = useSession(),
    navigate = useNavigate(),
    location = useLocation(),
    query = useQueryClient(),
    clearPrivate = useUi((s) => s.clearPrivate);
  const [error, setError] = useState(""),
    [show, setShow] = useState(false),
    [busy, setBusy] = useState(false);
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });
  if (session.data)
    return (
      <Navigate
        to={
          session.data.user.status === "승인 대기"
            ? "/pending-approval"
            : `/app/${session.data.user.owner ? "all" : session.data.branches[0]?.id || "all"}/home`
        }
        replace
      />
    );
  function finish(data: CurrentUser) {
    clearPrivate();
    query.clear();
    query.setQueryData(["session"], data);
    const from = (location.state as { from?: string } | null)?.from;
    const safe = from?.startsWith("/app/") ? from : undefined;
    navigate(
      data.user.status === "승인 대기"
        ? "/pending-approval"
        : safe ||
            `/app/${data.user.owner ? "all" : data.branches[0]?.id || "all"}/home`,
      { replace: true },
    );
  }
  async function login(values: z.infer<typeof schema>) {
    setBusy(true);
    setError("");
    try {
      finish(
        await api<CurrentUser>("/auth/login", { method: "POST", body: values }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      form.setValue("password", "");
    }
  }
  async function demo(persona: string) {
    setBusy(true);
    setError("");
    try {
      await api("/_demo", { method: "POST", body: { persona } });
      finish(await api<CurrentUser>("/me"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-visual">
        <div className="wordmark">
          <span className="brand-symbol">
            <Icon name="logo" size={25} />
          </span>
          OpenStudy
        </div>
        <div className="login-copy">
          <small className="font-semibold tracking-[.18em] text-primary">
            A BETTER SPACE, TOGETHER
          </small>
          <h1>
            좋은 공간을 만드는
            <br />
            <em className="not-italic text-primary">우리 팀의 워크스페이스.</em>
          </h1>
          <p>
            공간의 작은 변화부터 동료와의 대화까지.
            <br />
            오늘의 운영과 업무를 한곳에서 이어가세요.
          </p>
          <RoomArt />
        </div>
        <div className="flex justify-between text-[10px] text-muted">
          <span>조용한 공간, 자연스러운 협업</span>
          <span>STUDY · WORK · TOGETHER</span>
        </div>
      </section>
      <section className="login-side">
        <div className="absolute top-6 right-6">
          <ThemePicker />
        </div>
        <div className="login-wrap">
          <div className="wordmark login-mobile-brand mb-8 hidden">
            <span className="brand-symbol">
              <Icon name="logo" />
            </span>
            OpenStudy
          </div>
          <div className="mb-5 inline-flex items-center gap-2 rounded-md bg-soft px-3 py-1.5 text-[10px] font-semibold text-primary">
            <Icon name="leaf" size={14} /> 좋은 공간을 함께 만드는 우리 팀
          </div>
          <h2 className="text-[28px] font-semibold tracking-tight">
            다시 만나 반가워요.
          </h2>
          <p className="mt-2 mb-7 text-[13px] leading-6 text-muted">
            오늘도 우리 공간의 하루를 함께 시작해요.
            <br />
            직원 계정으로 로그인해 주세요.
          </p>
          <form
            className="form-grid"
            onSubmit={form.handleSubmit(login)}
            noValidate
          >
            <div className="field">
              <label htmlFor="email">이메일</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="name@openstudy.com"
                {...form.register("email")}
                aria-invalid={!!form.formState.errors.email}
              />
              {form.formState.errors.email && (
                <FieldError>{form.formState.errors.email.message}</FieldError>
              )}
            </div>
            <div className="field">
              <label htmlFor="password">비밀번호</label>
              <div className="relative">
                <input
                  id="password"
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  className="pr-12"
                  {...form.register("password")}
                  aria-invalid={!!form.formState.errors.password}
                />
                <button
                  type="button"
                  className="absolute top-3 right-3 text-muted"
                  onClick={() => setShow(!show)}
                  aria-label={show ? "비밀번호 숨기기" : "비밀번호 표시"}
                >
                  <Icon name="eye" size={18} />
                </button>
              </div>
              {form.formState.errors.password && (
                <FieldError>
                  {form.formState.errors.password.message}
                </FieldError>
              )}
            </div>
            {(error || session.error) && (
              <FieldError>{error || session.error?.message}</FieldError>
            )}
            <Button
              type="submit"
              variant="primary"
              className="mt-2 w-full"
              disabled={busy}
            >
              {busy ? "로그인 중…" : "로그인"}
            </Button>
          </form>
          {MOCK && (
            <>
              <div className="my-6 flex items-center gap-3 text-[11px] text-muted">
                <span className="h-px flex-1 bg-line" />
                데모로 먼저 둘러보세요
                <span className="h-px flex-1 bg-line" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  className="min-h-16 justify-start bg-canvas"
                  onClick={() => void demo("owner")}
                  disabled={busy}
                >
                  <Icon name="members" />
                  <span>
                    사장님으로 체험
                    <small className="block text-[10px]">
                      전체 지점·운영 관리
                    </small>
                  </span>
                </Button>
                <Button
                  className="min-h-16 justify-start bg-canvas"
                  onClick={() => void demo("junho")}
                  disabled={busy}
                >
                  <Icon name="tasks" />
                  <span>
                    직원으로 체험
                    <small className="block text-[10px]">내 업무·팀 채팅</small>
                  </span>
                </Button>
              </div>
              <p className="help mt-5">
                가상 데이터로 동작하는 프론트엔드 데모입니다. 로그인 폼은
                owner@openstudy.test 또는 junho@openstudy.test와 8자 이상의 데모
                비밀번호로 체험할 수 있어요.
              </p>
            </>
          )}
          <p className="mt-10 text-center text-[10px] text-muted">
            © OpenStudy · 좋은 공간을 함께 만들어요.
          </p>
        </div>
      </section>
    </main>
  );
}
export function InvitationAccept() {
  const [params] = useSearchParams(),
    token = params.get("token") || "",
    query = useQueryClient(),
    navigate = useNavigate(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const preview = useQuery({
    queryKey: ["invitation", token],
    queryFn: ({ signal }) =>
      api<{ name: string; email: string; branchId: string; expiresAt: string }>(
        `/invitations/preview?token=${encodeURIComponent(token)}`,
        { signal },
      ),
    retry: false,
  });
  async function accept(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const current = await api<CurrentUser>("/invitations/accept", {
        method: "POST",
        body: {
          token,
          email: preview.data?.email,
          password: data.get("password"),
        },
      });
      query.clear();
      query.setQueryData(["session"], current);
      navigate("/pending-approval", { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <section className="card w-full max-w-md p-7">
        <h1>우리 팀에 초대되었어요</h1>
        {preview.isPending ? (
          <State loading />
        ) : preview.error ? (
          <FieldError>{preview.error.message}</FieldError>
        ) : (
          <form className="form-grid mt-6" onSubmit={accept}>
            <p>
              {preview.data?.name}님, 초대를 수락한 뒤 관리자의 최종 승인을
              기다려 주세요.
            </p>
            <div className="field">
              <label htmlFor="invite-email">초대 이메일</label>
              <input
                id="invite-email"
                value={preview.data?.email || ""}
                readOnly
              />
            </div>
            <div className="field">
              <label htmlFor="invite-password">새 계정 비밀번호</label>
              <input
                id="invite-password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                placeholder="신규 계정은 8자 이상"
              />
            </div>
            <p className="help">
              기존 계정은 먼저 해당 이메일로 로그인한 뒤 같은 링크를 다시 열어
              주세요.
            </p>
            {error && <FieldError>{error}</FieldError>}
            <Button variant="primary" disabled={busy}>
              초대 수락
            </Button>
          </form>
        )}
        <Link to="/login" className="mt-5 block text-xs text-primary">
          로그인으로 돌아가기
        </Link>
      </section>
    </main>
  );
}
export function PendingApproval() {
  const session = useSession(),
    query = useQueryClient(),
    navigate = useNavigate();
  if (session.isPending) return <State loading />;
  if (!session.data) return <Navigate to="/login" replace />;
  if (session.data?.user.status === "활성")
    return (
      <Navigate
        to={`/app/${session.data.branches[0]?.id || "all"}/home`}
        replace
      />
    );
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <section className="card max-w-md p-7">
        <Icon name="clock" size={36} />
        <h1 className="mt-5">최종 승인을 기다리고 있어요</h1>
        <p className="help my-5">
          초대 수락이 완료되었습니다. 관리자가 승인하면 해당 지점의 업무 공간을
          사용할 수 있어요.
        </p>
        <div className="flex gap-2">
          <Button onClick={() => void session.refetch()}>
            승인 상태 새로고침
          </Button>
          <Button
            onClick={() =>
              void api("/auth/logout", { method: "POST", body: {} }).then(
                () => {
                  query.clear();
                  navigate("/login");
                },
              )
            }
          >
            로그아웃
          </Button>
        </div>
        {MOCK && (
          <Link
            to="/login"
            onClick={() =>
              void api("/auth/logout", { method: "POST", body: {} }).then(() =>
                query.clear(),
              )
            }
            className="mt-5 block text-xs text-primary"
          >
            사장님 데모로 전환하여 승인하기
          </Link>
        )}
      </section>
    </main>
  );
}
