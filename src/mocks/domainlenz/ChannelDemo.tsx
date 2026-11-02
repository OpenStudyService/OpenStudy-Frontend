import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Dialog } from "radix-ui";
import { DEMO_CLOCK, domains, matchScenario, scenarios } from "./catalog";
import type { DemoScenario } from "./catalog";
import {
  canReadDemo,
  makeResult,
  scopeLabel,
  sharedSnapshot,
  shareResult,
  subscribeShares,
} from "./model";
import type { DemoResult, DemoViewer } from "./model";
import { ResultCard } from "./ResultCard";
import "./demo.css";

interface Entry {
  id: string;
  prompt: string;
  phase: number;
  result?: DemoResult;
  status?: string;
  message?: string;
  shared?: boolean;
}
export interface ChannelDemoProps {
  viewer: DemoViewer;
  scope: string;
  channelId: string;
  channelName: string;
  request: { id: string; text: string } | null;
  galleryOpen: boolean;
  onGalleryOpen: (open: boolean) => void;
  onPick: (prompt: string) => void;
}
const phases = ["질문 해석", "조건 확인", "데이터 조회", "결과 준비"];
export default function ChannelDemo({
  viewer,
  scope,
  channelId,
  channelName,
  request,
  galleryOpen,
  onGalleryOpen,
  onPick,
}: ChannelDemoProps) {
  const [entries, setEntries] = useState<Entry[]>([]),
    [group, setGroup] = useState("all"),
    [search, setSearch] = useState("");
  const active = useRef<{
    id: string;
    timers: ReturnType<typeof setTimeout>[];
  } | null>(null);
  const newestEntry = useRef<HTMLElement>(null);
  const newestPublication = useRef<HTMLElement>(null);
  const galleryTrigger = useRef<HTMLElement | null>(null);
  const pickedExample = useRef(false);
  const shareKey = channelId;
  const published = useSyncExternalStore(subscribeShares, () =>
    sharedSnapshot(shareKey),
  );
  function cancel() {
    const pending = active.current;
    if (!pending) return;
    pending.timers.forEach(clearTimeout);
    active.current = null;
    setEntries((items) =>
      items.map((e) =>
        e.id === pending.id
          ? {
              ...e,
              status: "canceled",
              message: "요청을 취소했습니다. 늦은 응답은 반영하지 않습니다.",
            }
          : e,
      ),
    );
  }
  function run(
    text: string,
    id: string,
    refinedScope = scope,
    forcedScenario?: DemoScenario,
  ) {
    if (active.current) return;
    const s = forcedScenario ?? matchScenario(text);
    setEntries((items) => [...items, { id, prompt: text, phase: 0 }]);
    const timers: ReturnType<typeof setTimeout>[] = [];
    active.current = { id, timers };
    for (let phase = 1; phase < 4; phase++)
      timers.push(
        setTimeout(() => {
          if (active.current?.id === id)
            setEntries((items) =>
              items.map((e) => (e.id === id ? { ...e, phase } : e)),
            );
        }, phase * 220),
      );
    timers.push(
      setTimeout(() => {
        if (active.current?.id !== id) return;
        active.current = null;
        let status = s?.outcome ?? "unsupported",
          message =
            s?.summary ??
            "준비된 예문을 선택해 주세요. 이 데모는 자유 자연어 해석을 실행하지 않습니다.";
        if (
          s &&
          (!canReadDemo(viewer, s, refinedScope) ||
            (s.id === "leave-approved" && refinedScope !== "all"))
        ) {
          status = "denied";
          message =
            s.id === "leave-approved" && refinedScope !== "all"
              ? "휴가의 지점 귀속 정책은 협의가 필요합니다. 전체 지점 OWNER 시연에서 확인해 주세요."
              : "조회 권한이 없습니다. 정책 미확정 도메인은 OWNER 전용 시연입니다.";
        }
        const result =
          s && ["ready", "empty", "fallback"].includes(status)
            ? makeResult(s, refinedScope, channelId)
            : undefined;
        setEntries((items) =>
          items.map((e) =>
            e.id === id ? { ...e, phase: 4, status, message, result } : e,
          ),
        );
      }, 880),
    );
  }
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  useEffect(() => {
    if (!request) return;
    // A request belongs to this mounted user/scope/channel only. StrictMode cleanup
    // cancels its timers; the second setup restarts the same id without duplicating.
    const kickoff = setTimeout(() => {
      setEntries((items) =>
        items
          .filter((e) => e.id !== request.id)
          .map((e) =>
            e.status
              ? e
              : {
                  ...e,
                  status: "canceled",
                  message: "새 질문을 시작해 이전 조회를 취소했습니다.",
                },
          ),
      );
      runRef.current(request.text, request.id);
    }, 0);
    return () => {
      clearTimeout(kickoff);
      active.current?.timers.forEach(clearTimeout);
      active.current = null;
    };
  }, [request]);
  useEffect(
    () => () => {
      active.current?.timers.forEach(clearTimeout);
      active.current = null;
    },
    [],
  );
  useEffect(() => {
    if (entries.length)
      newestEntry.current?.scrollIntoView?.({
        block: "start",
        behavior: "smooth",
      });
  }, [entries.length]);
  const previousShareCount = useRef(published.length);
  useEffect(() => {
    if (published.length > previousShareCount.current)
      newestPublication.current?.scrollIntoView?.({
        block: "start",
        behavior: "smooth",
      });
    previousShareCount.current = published.length;
  }, [published.length]);
  const choose = (prompt: string) => {
    pickedExample.current = true;
    onPick(prompt);
    onGalleryOpen(false);
  };
  const visible = scenarios.filter(
    (s) =>
      (group === "all" ||
        (group === "states"
          ? s.outcome !== "ready"
          : s.domainId === group && s.outcome === "ready")) &&
      `${s.prompt} ${s.title}`.includes(search),
  );
  return (
    <div className="dl-demo" aria-label="DomainLenz 채팅 데모">
      {!entries.length && !published.length && (
        <div className="dl-welcome">
          <span className="dl-ai-mark">
            D<span>✦</span>
          </span>
          <div>
            <b>업무 데이터에 질문해 보세요</b>
            <p>13개 업무군 · 34개 예문 · 결과는 먼저 나에게만</p>
          </div>
          <button onClick={() => onGalleryOpen(true)}>예문 둘러보기 ↗</button>
        </div>
      )}
      {entries.map((entry, index) => (
        <article
          className="dl-conversation"
          key={entry.id}
          ref={index === entries.length - 1 ? newestEntry : undefined}
        >
          <div className="dl-question">
            <span>{viewer.name}</span>
            <p>@DomainLenz {entry.prompt.replace(/^@DomainLenz\s*/i, "")}</p>
            <small>나에게만 표시</small>
          </div>
          <div className="dl-answer">
            <div className="dl-author">
              <span className="dl-ai-mark">
                D<span>✦</span>
              </span>
              <b>DomainLenz</b>
              <span className="dl-badge">DEMO</span>
              <small>나에게만 표시</small>
            </div>
            {!entry.status ? (
              <div className="dl-progress" role="status">
                <div>
                  {phases.map((p, i) => (
                    <span key={p} className={entry.phase >= i ? "active" : ""}>
                      <i>{entry.phase > i ? "✓" : i + 1}</i>
                      {p}
                    </span>
                  ))}
                </div>
                <button onClick={cancel}>조회 취소</button>
              </div>
            ) : entry.result ? (
              <>
                <ResultCard
                  result={entry.result}
                  onFollowup={(next) => {
                    if (scope !== "all" && scope !== next) {
                      setEntries((items) => [
                        ...items,
                        {
                          id: crypto.randomUUID(),
                          prompt: "다른 지점으로 좁히기",
                          phase: 4,
                          status: "scope",
                          message: "현재 채널의 지점 범위를 넓힐 수 없습니다.",
                        },
                      ]);
                      return;
                    }
                    run(
                      `${scopeLabel(next)}만 보기`,
                      crypto.randomUUID(),
                      next,
                      entry.result!.scenario,
                    );
                  }}
                />
                <div className="dl-share">
                  <small>
                    채널 공유도 현재 브라우저 메모리에서만 재현합니다.
                  </small>
                  <button
                    disabled={entry.shared || entry.result.rows.length === 0}
                    onClick={() => {
                      shareResult(shareKey, {
                        id: entry.id,
                        author: viewer.name,
                        result: entry.result!,
                      });
                      setEntries((items) =>
                        items.map((e) =>
                          e.id === entry.id ? { ...e, shared: true } : e,
                        ),
                      );
                    }}
                  >
                    {entry.shared ? "✓ 채널에 공유됨" : "채널에 공유 ↗"}
                  </button>
                </div>
              </>
            ) : (
              <div
                className={`dl-state dl-state-${entry.status}`}
                role="status"
              >
                <span className="dl-eyebrow">
                  {entry.status?.toUpperCase()}
                </span>
                <h3>
                  {entry.status === "clarification"
                    ? "조건을 먼저 확인할게요"
                    : entry.status === "canceled"
                      ? "조회가 취소되었어요"
                      : entry.status === "failed"
                        ? "다시 조회할 수 있어요"
                        : "조회 안내"}
                </h3>
                <p>{entry.message}</p>
                {entry.status === "clarification" ? (
                  <button
                    onClick={() =>
                      run("지난달 지점별 순매출을 보여줘", crypto.randomUUID())
                    }
                  >
                    지난달 지점별 순매출
                  </button>
                ) : (
                  <button onClick={() => onGalleryOpen(true)}>
                    지원 예문 보기
                  </button>
                )}
              </div>
            )}
          </div>
        </article>
      ))}
      {!!published.length && (
        <div className="dl-publications" aria-label="채널에 공유된 AI 결과">
          <div className="dl-divider">
            <span># {channelName}에 공유된 결과</span>
          </div>
          {published.map((entry, index) => (
            <article
              className="dl-publication"
              key={entry.id}
              ref={
                index === published.length - 1 ? newestPublication : undefined
              }
            >
              <div className="dl-author">
                <span className="dl-share-icon">↗</span>
                <b>{entry.author}</b>
                <small>결과를 채널에 공유했어요 · 시뮬레이션</small>
              </div>
              {canReadDemo(viewer, entry.result.scenario, entry.result.scope) &&
              (scope === "all" || scope === entry.result.scope) ? (
                <ResultCard result={entry.result} readOnly />
              ) : (
                <div className="dl-state">
                  공유된 결과를 볼 권한이 없거나 현재 조회 범위와 다릅니다.
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      <Dialog.Root open={galleryOpen} onOpenChange={onGalleryOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dl-overlay" />
          <Dialog.Content
            className="dl-gallery"
            aria-describedby="dl-gallery-description"
            onOpenAutoFocus={() => {
              galleryTrigger.current =
                document.activeElement instanceof HTMLElement
                  ? document.activeElement
                  : null;
              pickedExample.current = false;
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (!pickedExample.current) galleryTrigger.current?.focus();
            }}
          >
            <header>
              <div>
                <span className="dl-eyebrow">OPENSTUDY × DOMAINLENZ</span>
                <Dialog.Title>어떤 업무가 궁금하세요?</Dialog.Title>
                <Dialog.Description id="dl-gallery-description">
                  예문을 선택하면 채팅 입력창에 준비됩니다. 실제 DB·모델 호출
                  없이 고정 데이터로 시연합니다.
                </Dialog.Description>
              </div>
              <Dialog.Close className="dl-close" aria-label="AI 예문 닫기">
                ×
              </Dialog.Close>
            </header>
            <div className="dl-gallery-body">
              <nav aria-label="질문 도메인">
                <button
                  className={group === "all" ? "active" : ""}
                  onClick={() => setGroup("all")}
                >
                  전체 예문 <span>34</span>
                </button>
                {domains.map((d) => (
                  <button
                    key={d.id}
                    className={group === d.id ? "active" : ""}
                    onClick={() => setGroup(d.id)}
                  >
                    <i>{d.icon}</i>
                    {d.name}
                    <span>2</span>
                  </button>
                ))}
                <button
                  className={group === "states" ? "active" : ""}
                  onClick={() => setGroup("states")}
                >
                  상태·예외 시연 <span>8</span>
                </button>
              </nav>
              <section>
                <label className="dl-search">
                  <span>예문 검색</span>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="매출, 예약, 점검…"
                  />
                </label>
                <p className="dl-gallery-count">
                  {visible.length}개 예문 <span>기준 {DEMO_CLOCK}</span>
                </p>
                <div className="dl-example-grid">
                  {visible.map((s) => (
                    <button key={s.id} onClick={() => choose(s.prompt)}>
                      <span>
                        {s.outcome === "ready"
                          ? domains.find((d) => d.id === s.domainId)?.name
                          : "상태·예외"}
                        <em>
                          {s.outcome === "ready"
                            ? s.view.toUpperCase()
                            : s.outcome.toUpperCase()}
                        </em>
                      </span>
                      <b>{s.prompt}</b>
                      <small>
                        {s.outcome === "ready"
                          ? domains.find((d) => d.id === s.domainId)
                              ?.description
                          : "조회 과정과 경계 상황을 재현합니다."}
                        <i>↗</i>
                      </small>
                    </button>
                  ))}
                </div>
                {!visible.length && <p>일치하는 예문이 없습니다.</p>}
              </section>
            </div>
            <footer>
              고정 시연 데이터 · 정책 미확정 도메인은 OWNER 전용 · 새로고침하면
              AI 기록 초기화
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
