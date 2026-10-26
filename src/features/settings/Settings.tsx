import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api, MOCK } from "../../shared/api/client";
import { useApp } from "../../app/context";
import type { CurrentUser } from "../../shared/domain/schema";
import { admin } from "../../shared/domain/schema";
import { useUi } from "../../app/store";
import { ThemePicker } from "../auth/Login";
import { Button, FieldError, Heading } from "../../shared/ui/primitives";
import { ProfileForm } from "./ProfileForm";
import { ResourceGroup } from "../records/ResourcePage";
import { BranchManagement } from "../organization/Organization";
export function Settings() {
  const { session, scope } = useApp(),
    theme = useUi((s) => s.theme),
    setTheme = useUi((s) => s.setTheme);
  return (
    <div>
      <div className="page pb-0">
        <Heading
          title="설정"
          description="나에게 편한 화면과 우리 공간의 환경을 정리해요."
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
        <section className="card mb-5 p-5">
          <h2>알림 범위</h2>
          <p className="help mt-3">
            직원 초대 이메일과 팀 채팅의 읽지 않은 표시를 사용합니다. 이용권
            만료 이메일·문자·별도 웹 푸시는 이번 버전에 포함하지 않습니다.
          </p>
        </section>
        {MOCK && <DemoControls />}
        <BranchManagement key={`${session.user.id}:${scope}`} />
      </div>
      {admin(session.user, scope) && (
        <ResourceGroup
          title="공간·운영 환경"
          description="담당 지점의 공간과 변경 이력을 관리해요."
          tabs={[
            { resource: "rooms", label: "스터디룸" },
            { resource: "channels", label: "채널 관리", admin: true },
            { resource: "audit", label: "변경 이력", admin: true },
          ]}
        />
      )}
    </div>
  );
}
function DemoControls() {
  const { session } = useApp(),
    query = useQueryClient(),
    navigate = useNavigate(),
    clear = useUi((s) => s.clearPrivate),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const data = useQuery({
    queryKey: ["demo-controls"],
    queryFn: () =>
      api<{
        scenario: string;
        personas: { id: string; name: string; status: string }[];
      }>("/_demo"),
  });
  async function change(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await api("/_demo", { method: "POST", body });
      if (body.persona || body.expire) {
        clear();
        query.clear();
        if (body.expire) navigate("/login");
        else {
          const current = await api<CurrentUser>("/me");
          query.setQueryData(["session"], current);
          navigate(
            `/app/${current.user.owner ? "all" : current.branches[0]?.id || "all"}/home`,
          );
        }
      } else {
        await query.invalidateQueries();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card mb-5">
      <header className="card-header">
        <h2>데모·검증 도구</h2>
        <small>모킹 모드 전용</small>
      </header>
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <label className="field">
          체험 계정
          <select
            value={session.user.id}
            disabled={busy}
            onChange={(e) => void change({ persona: e.target.value })}
          >
            {data.data?.personas
              .filter((p) => p.status === "활성")
              .map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name} (
                  {p.id === "owner"
                    ? "사장님"
                    : p.id === "junho" || p.id === "doyun"
                      ? "직원"
                      : "지점 관리자"}
                  )
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          API 시나리오
          <select
            value={data.data?.scenario || "normal"}
            disabled={busy}
            onChange={(e) => void change({ scenario: e.target.value })}
          >
            {[
              ["normal", "정상 응답"],
              ["slow", "느린 응답"],
              ["empty", "검색 결과 없음"],
              ["error", "서버 오류"],
              ["forbidden", "권한 거부"],
              ["payment-failure", "Mock 결제 실패"],
              ["message-failure", "메시지 전송 실패"],
              ["email-failure", "초대 발송 실패"],
              ["disconnect", "SSE 연결 단절"],
              ["ai-failure", "AI 실행 실패"],
              ["ai-unavailable", "AI 준비 안 됨"],
              ["ai-view-fallback", "미지원 AI 결과 화면"],
            ].map(([v, l]) => (
              <option value={v} key={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button
            disabled={busy}
            onClick={() => void change({ scenario: "normal" })}
          >
            정상 응답 복원
          </Button>
          <Button disabled={busy} onClick={() => void change({ expire: true })}>
            세션 만료 재현
          </Button>
          <Button
            disabled={busy}
            variant="danger"
            onClick={() => {
              if (window.confirm("이 탭의 가상 업무·채팅·거래를 초기화할까요?"))
                void change({ reset: true, scenario: "normal" });
            }}
          >
            가상 데이터 초기화
          </Button>
        </div>
        {error && <FieldError>{error}</FieldError>}
        <p className="help sm:col-span-2">
          이 계정 전환과 데이터 저장은 브라우저 탭 안의 시연 도구입니다. 실제
          인증·권한·거래의 보안을 보장하지 않습니다.
        </p>
      </div>
    </section>
  );
}
