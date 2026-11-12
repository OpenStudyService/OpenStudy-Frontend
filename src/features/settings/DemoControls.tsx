import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { useApp } from "../../app/context";
import { useUi } from "../../app/store";
import { abortPrivateRequests, api } from "../../shared/api/client";
import type { CurrentUser } from "../../shared/domain/schema";
import { Button, FieldError, Heading } from "../../shared/ui/primitives";

export function DemoControls() {
  const { session, scope } = useApp(),
    query = useQueryClient(),
    navigate = useNavigate(),
    clear = useUi((s) => s.clearPrivate),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const data = useQuery({
    queryKey: ["data", session.user.id, scope, "demo-controls"],
    queryFn: ({ signal }) =>
      api<{
        scenario: string;
        personas: { id: string; name: string; status: string }[];
      }>("/_demo", { signal }),
  });
  async function change(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await api("/_demo", { method: "POST", body });
      if (body.persona || body.expire) {
        abortPrivateRequests();
        clear();
        await query.cancelQueries();
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
    <div className="page">
      <Heading title="데모·검증 도구" description="모킹 모드 전용" />
      <section className="card">
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
                ["email-failure", "초대 발송 실패"],
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
            <Button
              disabled={busy}
              onClick={() => void change({ expire: true })}
            >
              세션 만료 재현
            </Button>
            <Button
              disabled={busy}
              variant="danger"
              onClick={() => {
                if (
                  window.confirm("이 탭의 가상 업무·채팅·거래를 초기화할까요?")
                )
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
    </div>
  );
}
