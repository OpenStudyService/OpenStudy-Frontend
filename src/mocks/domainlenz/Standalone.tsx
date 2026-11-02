import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { Dialog } from "radix-ui";
import ChannelDemo from "./ChannelDemo";
import { Showcase } from "./Showcase";
import { ResultCard } from "./ResultCard";
import { DEMO_CLOCK, domains, scenarios, showcase } from "./catalog";
import {
  canReadDemo,
  scopeLabel,
  sharedSnapshot,
  subscribeShares,
} from "./model";
import type { DemoTrace, DemoViewer } from "./model";
import "./standalone.css";

const owner: DemoViewer = {
  id: "owner",
  name: "김서연",
  owner: true,
  active: true,
  aiBranches: ["gangnam", "seongsu"],
  salesBranches: ["gangnam", "seongsu"],
  paymentBranches: ["gangnam", "seongsu"],
};
const staff: DemoViewer = {
  id: "staff",
  name: "가상직원 A",
  owner: false,
  active: true,
  aiBranches: ["gangnam"],
  salesBranches: ["gangnam"],
  paymentBranches: [],
};
const channels = [
  { id: "general", name: "전체-공지", scope: "all" },
  { id: "gangnam", name: "강남점-운영", scope: "gangnam" },
  { id: "seongsu", name: "성수점-운영", scope: "seongsu" },
];
const pages = [
  { id: "workspace", icon: "AI", label: "업무 AI" },
  { id: "records", icon: "WR", label: "공유 기록" },
  { id: "domains", icon: "DB", label: "DB 도메인" },
  { id: "trace", icon: "TR", label: "실행 추적" },
  { id: "guide", icon: "EV", label: "데모 안내" },
];

function Standalone() {
  const [channel, setChannel] = useState(channels[0]),
    [role, setRole] = useState("owner"),
    [page, setPage] = useState("workspace"),
    [menu, setMenu] = useState(false),
    [gallery, setGallery] = useState(false),
    [draft, setDraft] = useState(""),
    [request, setRequest] = useState<{ id: string; text: string } | null>(null),
    [traces, setTraces] = useState<DemoTrace[]>([]),
    [traceOpen, setTraceOpen] = useState(false),
    [recommend, setRecommend] = useState(true),
    [width, setWidth] = useState(1120),
    [recommendHeight, setRecommendHeight] = useState(300),
    [inputHeight, setInputHeight] = useState(64),
    [workflow, setWorkflow] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null),
    viewer = role === "owner" ? owner : staff;
  const flow = useRef<string[]>([]),
    flowTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    drag = useRef<{ y: number; height: number } | null>(null);
  const shared = useSyncExternalStore(subscribeShares, () =>
    sharedSnapshot(channel.id),
  );
  const key = `${viewer.id}:${channel.id}`,
    latest = traces.at(-1);
  useEffect(
    () => () => {
      if (flowTimer.current) clearTimeout(flowTimer.current);
    },
    [],
  );
  function stopFlow() {
    flow.current = [];
    if (flowTimer.current) clearTimeout(flowTimer.current);
    flowTimer.current = null;
    setWorkflow(false);
  }
  function send() {
    const text = draft.trim();
    if (!text) return;
    stopFlow();
    setRequest({ id: crypto.randomUUID(), text });
    setDraft("");
    setRecommend(false);
  }
  function pick(prompt: string) {
    setPage("workspace");
    setDraft(`@DomainLenz ${prompt}`);
    setTimeout(() => input.current?.focus(), 0);
  }
  function changeChannel(id: string) {
    stopFlow();
    setChannel(channels.find((c) => c.id === id)!);
    setRequest(null);
    setDraft("");
    setGallery(false);
    setTraces([]);
  }
  function traceDone(trace: DemoTrace) {
    setTraces((items) => [...items, trace]);
    if (!["ready", "empty", "fallback"].includes(trace.status)) {
      stopFlow();
      return;
    }
    const next = flow.current.shift();
    if (next) {
      flowTimer.current = setTimeout(() => {
        setRequest({
          id: crypto.randomUUID(),
          text: scenarios.find((s) => s.id === next)!.prompt,
        });
        flowTimer.current = null;
      }, 650);
    } else setWorkflow(false);
  }
  function startFlow() {
    if (workflow) {
      stopFlow();
      return;
    }
    if (!viewer.owner) return;
    changeChannel("general");
    setPage("workspace");
    setRecommend(false);
    flow.current = ["seats-heatmap", "products-top5"];
    setWorkflow(true);
    setRequest({
      id: crypto.randomUUID(),
      text: scenarios.find((s) => s.id === "sales-net")!.prompt,
    });
  }
  function openPage(id: string) {
    setMenu(false);
    if (id === "trace") setTraceOpen(true);
    else setPage(id);
  }
  return (
    <div
      className="v8-app"
      onKeyDown={(e) => {
        if (e.key === "Escape") setMenu(false);
      }}
    >
      {menu && (
        <button
          className="v8-sidebar-scrim"
          aria-label="메뉴 닫기"
          onClick={() => setMenu(false)}
        />
      )}
      <aside
        className={`v8-sidebar ${menu ? "open" : ""}`}
        aria-label="데모 메뉴"
      >
        <div className="v8-brand">
          <span>
            <i>D</i> OPENSTUDY
            <br /> BACKOFFICE DEMO
          </span>
          <h1>DomainLenz</h1>
          <p>스터디카페 운영 분석 · 시뮬레이션</p>
        </div>
        <p className="v8-nav-label">WORKSPACE</p>
        <nav>
          {pages.map((item) => (
            <button
              key={item.id}
              className={page === item.id ? "active" : ""}
              onClick={() => openPage(item.id)}
            >
              <i>{item.icon}</i>
              {item.label}
              {item.id === "records" && shared.length > 0 && (
                <small>{shared.length}</small>
              )}
            </button>
          ))}
        </nav>
        <div className="v8-sidebar-bottom">
          <section className="v8-profile">
            <header>
              <b>Mock 사용자 프로필</b>
              <span>DEMO</span>
            </header>
            <label htmlFor="demo-persona">
              권한 시뮬레이션 · 실제 로그인 아님
            </label>
            <select
              id="demo-persona"
              aria-label="시연 사용자"
              value={role}
              onChange={(e) => {
                stopFlow();
                setRole(e.target.value);
                setRequest(null);
                setDraft("");
                setTraces([]);
              }}
            >
              <option value="owner">OWNER · 전체 지점</option>
              <option value="staff">직원 · 강남 매출 조회만</option>
            </select>
            <label htmlFor="demo-channel">현재 대화 채널</label>
            <select
              id="demo-channel"
              aria-label="시연 채널"
              value={channel.id}
              onChange={(e) => changeChannel(e.target.value)}
            >
              {channels.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p>
              {viewer.owner
                ? "전체 업무군 시연 가능"
                : "강남 매출 조회 · 거래 상세 권한 없음"}
            </p>
          </section>
          <section className="v8-stack">
            <header>
              <b>Application Stack</b>
              <span>SIMULATED</span>
            </header>
            {[
              ["QuerySpec / ViewSpec", "협의용 초안"],
              ["LLM / DomainLenz", "미연결"],
              ["Spring Boot · MySQL", "미연결"],
              ["개인정보 원본", "미포함"],
            ].map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <b>{value}</b>
                <i />
              </div>
            ))}
          </section>
        </div>
      </aside>
      <div className="v8-shell">
        <header className="v8-topbar">
          <button
            className="v8-mobile-menu"
            aria-label="메뉴 열기"
            aria-expanded={menu}
            onClick={() => setMenu((v) => !v)}
          >
            ☰
          </button>
          <div className="v8-context">
            <b>{pages.find((p) => p.id === page)?.label ?? "업무 AI"}</b>
            <span>OpenStudy · 개발자 체험 · 가상 데이터</span>
          </div>
          <div className="v8-top-actions">
            <span className="v8-system-badge">LOCAL DEMO</span>
            <span className="v8-system-badge v8-api-badge">API 미연결</span>
            <button
              className="v8-trace-trigger"
              onClick={() => setTraceOpen(true)}
            >
              <i>TR</i> Trace
            </button>
            <button
              className={`v8-workflow ${workflow ? "running" : ""}`}
              disabled={!viewer.owner}
              onClick={startFlow}
            >
              <i>{workflow ? "Ⅱ" : "▶"}</i>
              {workflow ? "시연 중지" : "워크플로"}
            </button>
            <span className="v8-avatar">OS</span>
          </div>
        </header>
        <div className="v8-notice">
          OPENSTUDY DEMO · 모든 결과는 고정 가상 데이터입니다. 실제
          DomainLenz·OpenAI·백엔드·DB와 연결되지 않습니다.
        </div>
        <main className="v8-content">
          <section
            className="v8-workspace"
            hidden={page !== "workspace"}
            style={{ maxWidth: width }}
            aria-label="업무 AI 대화창"
          >
            <div className="v8-size-toolbar">
              <span>↕ 화면 크기</span>
              <label>
                가로폭{" "}
                <input
                  type="range"
                  min="700"
                  max="1560"
                  step="20"
                  value={width}
                  aria-label="대화 화면 가로 너비"
                  onChange={(e) => setWidth(Number(e.target.value))}
                />
                <output>{width}px</output>
              </label>
              <button
                onClick={() => {
                  setWidth(1120);
                  setRecommendHeight(300);
                  setInputHeight(64);
                }}
              >
                초기화
              </button>
            </div>
            <div
              className="v8-conversation"
              role="log"
              aria-label="업무 AI 대화 기록"
            >
              <div className="v8-introduction">
                <span>DL</span>
                <div>
                  <p>운영 데이터에 자연어로 질문해 보세요.</p>
                  <b>한 문장으로, 질문에 맞는 업무 화면을 만납니다.</b>
                  <p>
                    매출 비교, 이용 현황 히트맵, 좌석 배치, 예약 캘린더를 직접
                    확인하고 결과를 공유할 수 있습니다.
                  </p>
                  <small>로컬 시뮬레이션 · 기준 {DEMO_CLOCK}</small>
                </div>
              </div>
              <ChannelDemo
                key={key}
                viewer={viewer}
                scope={channel.scope}
                channelId={channel.id}
                channelName={channel.name}
                request={request}
                galleryOpen={gallery}
                onGalleryOpen={setGallery}
                onPick={pick}
                onTrace={traceDone}
                workspace
              />
            </div>
            {recommend && (
              <div
                className="v8-resize-divider"
                role="separator"
                tabIndex={0}
                aria-label="대화 결과창 높이 조절"
                aria-orientation="horizontal"
                aria-valuemin={120}
                aria-valuemax={500}
                aria-valuenow={recommendHeight}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  drag.current = { y: e.clientY, height: recommendHeight };
                }}
                onPointerMove={(e) => {
                  if (drag.current)
                    setRecommendHeight(
                      Math.max(
                        120,
                        Math.min(
                          500,
                          drag.current.height + drag.current.y - e.clientY,
                        ),
                      ),
                    );
                }}
                onPointerUp={() => {
                  drag.current = null;
                }}
                onPointerCancel={() => {
                  drag.current = null;
                }}
                onKeyDown={(e) => {
                  if (["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
                    e.preventDefault();
                    setRecommendHeight((h) =>
                      e.key === "Home"
                        ? 120
                        : e.key === "End"
                          ? 500
                          : Math.max(
                              120,
                              Math.min(
                                500,
                                h + (e.key === "ArrowUp" ? 24 : -24),
                              ),
                            ),
                    );
                  }
                }}
              >
                <i />
                <span>결과창 높이 조절 · 위아래로 드래그</span>
              </div>
            )}
            {recommend && (
              <div
                className="v8-recommendations"
                style={{ height: recommendHeight }}
              >
                <div className="v8-showcase-heading">
                  <div>
                    <span>TRY OPENSTUDY AI · MOCK</span>
                    <h2>한 문장으로, 다양한 업무 화면을 경험해 보세요</h2>
                    <p>
                      질문을 선택하고 전송하면 해당 조건의 결과가 준비됩니다.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="v8-gallery-button"
                    onClick={() => setGallery(true)}
                  >
                    ✦ AI 질문
                  </button>
                </div>
                <Showcase onPick={pick} />
                <div className="v8-extra-prompts">
                  <span>더 살펴보기</span>
                  {["customers-new", "tasks-overdue", "shifts-week"].map(
                    (id) => {
                      const s = scenarios.find((s) => s.id === id)!;
                      return (
                        <button key={id} onClick={() => pick(s.prompt)}>
                          {s.title}
                        </button>
                      );
                    },
                  )}
                </div>
                <div className="v8-policy-tests">
                  <span>상태·예외</span>
                  {scenarios
                    .filter((s) => s.outcome !== "ready")
                    .map((s) => (
                      <button key={s.id} onClick={() => pick(s.prompt)}>
                        {
                          (
                            {
                              clarification: "확인 질문",
                              unsupported: "미지원 질의",
                              empty: "빈 결과",
                              denied: "권한 부족",
                              scope: "범위 초과",
                              failed: "조회 실패",
                              canceled: "취소",
                              fallback: "표 대체",
                            } as Record<string, string>
                          )[s.outcome]
                        }
                      </button>
                    ))}
                </div>
              </div>
            )}
            <div className="v8-execution-summary">
              <span>
                {latest
                  ? `${latest.status.toUpperCase()} · ${scopeLabel(latest.scope)}`
                  : "예시 화면 · 현재 실행 기록 없음"}
              </span>
              <button onClick={() => setTraceOpen(true)}>
                명세·Trace 보기 →
              </button>
            </div>
            <form
              className="v8-composer"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <div className="v8-composer-controls">
                <label htmlFor="v8-question">
                  질문 입력 <small>Enter 전송 · Shift+Enter 줄바꿈</small>
                </label>
                <div>
                  {!recommend && (
                    <button
                      type="button"
                      className="v8-recommend-toggle"
                      onClick={() => setGallery(true)}
                    >
                      ✦ AI 질문
                    </button>
                  )}
                  <button
                    type="button"
                    className="v8-recommend-toggle"
                    aria-expanded={recommend}
                    onClick={() => setRecommend((v) => !v)}
                  >
                    {recommend ? "추천 질문 숨기기" : "추천 질문 보기"}
                  </button>
                  <button
                    type="button"
                    aria-label="입력창 높이 줄이기"
                    onClick={() => setInputHeight((h) => Math.max(48, h - 24))}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    aria-label="입력창 높이 늘리기"
                    onClick={() => setInputHeight((h) => Math.min(184, h + 24))}
                  >
                    ＋
                  </button>
                </div>
              </div>
              <div className="v8-composer-input">
                <textarea
                  id="v8-question"
                  ref={input}
                  aria-label="메시지"
                  placeholder="예: 지난달 지점별 순매출을 보여줘"
                  value={draft}
                  style={{ height: inputHeight }}
                  maxLength={4000}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing &&
                      e.keyCode !== 229
                    ) {
                      e.preventDefault();
                      send();
                    }
                  }}
                />
                <button
                  type="submit"
                  aria-label="보내기 ↗"
                  disabled={!draft.trim()}
                >
                  ↑
                </button>
              </div>
            </form>
          </section>
          {page === "records" && (
            <section className="v8-page">
              <div className="v8-page-heading">
                <span>SHARED WORK HISTORY</span>
                <h2>대화에서 확인하고 공유한 결과</h2>
                <p>#{channel.name} · 원본 대화와 독립된 메모리 스냅샷입니다.</p>
              </div>
              {!shared.length ? (
                <div className="v8-empty">
                  <b>아직 공유한 결과가 없습니다</b>
                  <p>
                    업무 AI에서 결과를 조회한 뒤 ‘채널에 공유’를 눌러 보세요.
                  </p>
                  <button onClick={() => setPage("workspace")}>
                    업무 AI로 돌아가기
                  </button>
                </div>
              ) : (
                shared.map((item) => (
                  <article className="v8-record" key={item.id}>
                    <header>
                      <span>
                        {item.author} · {scopeLabel(item.result.scope)}
                      </span>
                      <b>SHARED SNAPSHOT</b>
                    </header>
                    {canReadDemo(
                      viewer,
                      item.result.scenario,
                      item.result.scope,
                    ) &&
                    (channel.scope === "all" ||
                      channel.scope === item.result.scope) ? (
                      <ResultCard result={item.result} readOnly />
                    ) : (
                      <p>
                        공유된 결과를 볼 권한이 없거나 현재 조회 범위와
                        다릅니다.
                      </p>
                    )}
                  </article>
                ))
              )}
            </section>
          )}
          {page === "domains" && (
            <section className="v8-page">
              <div className="v8-page-heading">
                <span>OPENSTUDY DOMAIN CATALOG</span>
                <h2>질문의 근거가 되는 DB 도메인</h2>
                <p>
                  실제 마이그레이션·API 계약에 연결한 {domains.length}개
                  업무군입니다. 원본 API 준비 상태와 AI 연결 여부는 구분합니다.
                </p>
              </div>
              <div className="v8-domain-grid">
                {domains.map((d) => (
                  <details key={d.id}>
                    <summary>
                      <i>{d.icon}</i>
                      <b>{d.name}</b>
                      <span>
                        {
                          scenarios.filter(
                            (s) => s.domainId === d.id && s.outcome === "ready",
                          ).length
                        }
                        개 질문
                      </span>
                    </summary>
                    <div>
                      <p>{d.readiness}</p>
                      {d.sources.map((source) => (
                        <p key={source.table}>
                          <code>{source.table}</code>
                          <small>{source.fields.join(" · ")}</small>
                        </p>
                      ))}
                      <p>{d.policy}</p>
                      <button
                        onClick={() =>
                          pick(
                            scenarios.find((s) => s.domainId === d.id)!.prompt,
                          )
                        }
                      >
                        이 도메인에 질문하기 ↗
                      </button>
                    </div>
                  </details>
                ))}
              </div>
            </section>
          )}
          {page === "guide" && (
            <section className="v8-page">
              <div className="v8-page-heading">
                <span>DEMO VERIFICATION</span>
                <h2>무엇을 확인할 수 있나요?</h2>
                <p>실제 AI 정확도나 서버 지연을 측정한 화면이 아닙니다.</p>
              </div>
              <div className="v8-guide-stats">
                <div>
                  <b>{domains.length}</b>
                  <span>조회 업무군</span>
                </div>
                <div>
                  <b>{scenarios.length}</b>
                  <span>준비된 예문</span>
                </div>
                <div>
                  <b>{showcase.length}</b>
                  <span>대표 질문</span>
                </div>
              </div>
              <div className="v8-guide-card">
                <h3>권장 시연 순서</h3>
                <ol>
                  <li>대표 질문으로 매출 KPI·차트·표를 확인합니다.</li>
                  <li>
                    개발자 보기와 Trace에서 물리 필드·조회 조건을 확인합니다.
                  </li>
                  <li>결과를 공유하고 개인 화면의 지점 조건을 바꿉니다.</li>
                  <li>히트맵·판매 순위·좌석 배치·예약 캘린더를 살펴봅니다.</li>
                  <li>
                    사용자 프로필을 바꿔 권한 안내와 공유 열람 제한을
                    확인합니다.
                  </li>
                </ol>
                <p>
                  모든 수치는 가상입니다. 개인정보 원본, 서버 권한 보장, DB
                  실행, 실제 LLM, CSV 승인, 업무 변경은 포함하지 않습니다.
                </p>
                <button onClick={() => setPage("workspace")}>
                  시연 화면으로 돌아가기
                </button>
              </div>
            </section>
          )}
        </main>
      </div>
      <Dialog.Root open={traceOpen} onOpenChange={setTraceOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="v8-trace-overlay" />
          <Dialog.Content className="v8-trace-panel">
            <header>
              <div>
                <span>LOCAL EXECUTION TRACE</span>
                <Dialog.Title>실행 추적</Dialog.Title>
              </div>
              <Dialog.Close aria-label="실행 추적 닫기">×</Dialog.Close>
            </header>
            <Dialog.Description>
              현재 사용자·채널에서 실행한 시연 기록입니다. 서버 로그·실측 시간은
              수집하지 않습니다.
            </Dialog.Description>
            <div className="v8-trace-body">
              <div className="v8-pipeline">
                {["질문 해석", "조건 확인", "데이터 조회", "결과 렌더링"].map(
                  (step, i) => (
                    <div key={step}>
                      <i>{String(i + 1).padStart(2, "0")}</i>
                      <span>{step}</span>
                      <small>시뮬레이션</small>
                    </div>
                  ),
                )}
              </div>
              {traces.length ? (
                <>
                  <h3>최근 요청</h3>
                  <div className="v8-trace-list">
                    {traces
                      .slice(-6)
                      .reverse()
                      .map((t) => (
                        <div key={t.id}>
                          <span>{t.status.toUpperCase()}</span>
                          <b>{t.prompt.replace(/^@DomainLenz\s*/i, "")}</b>
                          <small>{scopeLabel(t.scope)}</small>
                        </div>
                      ))}
                  </div>
                  {latest?.result && (
                    <>
                      <h3>QuerySpec · 협의용 초안</h3>
                      <pre>
                        {JSON.stringify(latest.result.querySpec, null, 2)}
                      </pre>
                      <h3>ViewSpec · 협의용 초안</h3>
                      <pre>
                        {JSON.stringify(latest.result.viewSpec, null, 2)}
                      </pre>
                    </>
                  )}
                </>
              ) : (
                <div className="v8-empty">
                  질문을 실행하면 명세와 상태가 여기에 표시됩니다.
                </div>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Standalone />);
