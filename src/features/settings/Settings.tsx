import { Navigate, useSearchParams } from "react-router";
import { api } from "../../shared/api/client";
import { useApp } from "../../app/context";
import { useUi } from "../../app/store";
import { ThemePicker } from "../auth/Login";
import { Heading } from "../../shared/ui/primitives";
import { PasswordForm } from "../auth/PasswordForm";
import { AuditLog } from "./AuditLog";
import { auditSearchKeys } from "./audit-model";
import { ProfileForm } from "./ProfileForm";

function legacySettingsTarget(params: URLSearchParams) {
  const tab = params.get("tab");
  let section: string;
  let keys: readonly string[];
  const query = new URLSearchParams();
  if (tab === "audit") {
    section = "audit";
    keys = [...auditSearchKeys, "detail"];
  } else if (tab === "rooms") {
    section = "spaces";
    keys = ["status", "page", "detail"];
    query.set("tab", "rooms");
  } else if (params.has("branchSearch") || params.has("branchPage")) {
    section = "branches";
    keys = ["branchSearch", "branchPage"];
  } else {
    return null;
  }

  for (const key of keys) {
    for (const value of params.getAll(key)) query.append(key, value);
  }
  return { pathname: "../" + section, search: query.toString() };
}

export function Settings() {
  const [params] = useSearchParams();
  const { session } = useApp();
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  if (params.get("tab") === "audit" && !session.user.owner) return <AuditLog />;
  const target = legacySettingsTarget(params);
  if (target) return <Navigate to={target} replace />;

  return (
    <div className="page">
      <Heading
        title="개인 설정"
        description="내 프로필, 비밀번호, 화면 테마를 관리해요."
      />
      <section className="card mb-5">
        <header className="card-header">
          <h2>화면 테마</h2>
          <ThemePicker />
        </header>
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-3">
          {(["forest", "navy", "sand"] as const).map((t, i) => (
            <button
              key={t}
              aria-pressed={theme === t}
              onClick={() => setTheme(t)}
              className={`rounded-xl border p-4 text-left ${theme === t ? "border-primary ring-1 ring-primary" : "border-line"}`}
            >
              <span
                className="mb-3 flex h-20 overflow-hidden rounded-lg"
                aria-hidden="true"
              >
                <i
                  className="w-1/5"
                  style={{ background: ["#163b31", "#1c2e4a", "#45352d"][i] }}
                />
                <span
                  className="flex-1 p-3"
                  style={{ background: ["#f6f7f3", "#f4f6fa", "#f8f5f0"][i] }}
                >
                  <span className="block h-4 rounded bg-white" />
                  <span
                    className="mt-2 block h-6 rounded"
                    style={{
                      background: ["#346c53", "#4165a3", "#896345"][i],
                    }}
                  />
                </span>
              </span>
              <b className="text-xs">{["포레스트", "네이비", "샌드"][i]}</b>
              <small className="mt-1 block text-[10px]">
                {
                  [
                    "차분한 그린과 아이보리",
                    "또렷한 네이비와 쿨그레이",
                    "따뜻한 브라운과 베이지",
                  ][i]
                }
              </small>
            </button>
          ))}
        </div>
      </section>
      <ProfileForm key={session.user.id} />
      <section className="card mb-5">
        <header className="card-header">
          <h2>비밀번호 변경</h2>
        </header>
        <div className="max-w-lg p-5">
          <PasswordForm
            key={session.user.id}
            change
            submit={async (newPassword, currentPassword) => {
              await api("/me/password", {
                method: "POST",
                body: { currentPassword, newPassword },
              });
              useUi
                .getState()
                .toast(
                  "비밀번호를 변경했어요. 다른 기기에서는 다시 로그인해 주세요.",
                );
            }}
          />
        </div>
      </section>
    </div>
  );
}
