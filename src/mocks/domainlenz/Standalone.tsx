import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import ChannelDemo from "./ChannelDemo";
import { DEMO_CLOCK } from "./catalog";
import type { DemoViewer } from "./model";
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
function Standalone() {
  const [channel, setChannel] = useState(channels[0]),
    [role, setRole] = useState("owner"),
    [gallery, setGallery] = useState(false),
    [draft, setDraft] = useState(""),
    [request, setRequest] = useState<{ id: string; text: string } | null>(null),
    [messages, setMessages] = useState<
      { id: string; channel: string; text: string; name: string }[]
    >([]);
  const input = useRef<HTMLTextAreaElement>(null),
    viewer = role === "owner" ? owner : staff;
  const key = `${viewer.id}:${channel.id}`;
  function send() {
    const text = draft.trim();
    if (!text) return;
    if (/^@DomainLenz(?:\s|$)/i.test(text))
      setRequest({ id: crypto.randomUUID(), text });
    else
      setMessages((items) => [
        ...items,
        {
          id: crypto.randomUUID(),
          channel: channel.id,
          text,
          name: viewer.name,
        },
      ]);
    setDraft("");
  }
  function changeChannel(next: typeof channel) {
    setChannel(next);
    setDraft("");
    setRequest(null);
    setGallery(false);
  }
  return (
    <div className="dl-standalone">
      <aside className="dl-rail">
        <span className="dl-brand">
          O<span>✦</span>
        </span>
        <span>⌂</span>
        <span className="selected">☷</span>
        <span>▦</span>
        <span>◷</span>
        <span className="dl-rail-bottom">서</span>
      </aside>
      <aside className="dl-channel-sidebar">
        <div className="dl-workspace">
          <b>
            OpenStudy<span>⌄</span>
          </b>
          <small>함께 운영하는 스터디 공간</small>
        </div>
        <div className="dl-side-heading">
          팀 채팅 <span>＋</span>
        </div>
        <p className="dl-nav-label">채널</p>
        {channels.map((c) => (
          <button
            key={c.id}
            className={channel.id === c.id ? "active" : ""}
            onClick={() => changeChannel(c)}
          >
            <span>#</span>
            {c.name}
            {c.id === "general" && <small>3</small>}
          </button>
        ))}
        <div className="dl-sidebar-note">
          <b>✦ DomainLenz 데모</b>
          <p>
            업무 데이터를 대화로 탐색하고
            <br />
            결과 화면을 확인해 보세요.
          </p>
          <span>13개 업무군 · 34개 예문</span>
        </div>
        <div className="dl-persona">
          <label>
            시연 사용자
            <select
              aria-label="시연 사용자"
              value={role}
              onChange={(e) => {
                setRole(e.target.value);
                setRequest(null);
                setDraft("");
              }}
            >
              <option value="owner">사장님 · OWNER</option>
              <option value="staff">직원 · 강남 매출 조회만</option>
            </select>
          </label>
          <small>공유 결과의 열람 제한도 시뮬레이션합니다.</small>
        </div>
      </aside>
      <main className="dl-channel-main">
        <header className="dl-channel-header">
          <div>
            <h1># {channel.name}</h1>
            <p>하루의 업무와 인수인계를 함께 나누는 공간</p>
          </div>
          <span className="dl-demo-pill">고정 데이터 데모</span>
          <span className="dl-top-avatar">{viewer.name.slice(0, 1)}</span>
        </header>
        <div className="dl-offline-banner">
          <span>
            OPENSTUDY × DOMAINLENZ <b>채팅에서 만나는 업무 데이터</b>
          </span>
          <small>DB·모델 미연결 · {DEMO_CLOCK}</small>
        </div>
        <div className="dl-channel-feed">
          <div className="dl-date-divider">2026년 10월 17일 토요일</div>
          <div className="dl-human">
            <span className="dl-human-avatar">민</span>
            <div>
              <b>
                이민지 <time>오전 10:45</time>
              </b>
              <p>
                오늘 운영 현황도 여기서 함께 확인해요.
                <br />
                아래 <strong>AI 질문</strong>에서 궁금한 업무를 골라 보세요.
              </p>
            </div>
          </div>
          {messages
            .filter((m) => m.channel === channel.id)
            .map((m) => (
              <div className="dl-human" key={m.id}>
                <span className="dl-human-avatar">{m.name.slice(0, 1)}</span>
                <div>
                  <b>{m.name}</b>
                  <p>{m.text}</p>
                </div>
              </div>
            ))}
          <ChannelDemo
            key={key}
            viewer={viewer}
            scope={channel.scope}
            channelId={channel.id}
            channelName={channel.name}
            request={request}
            galleryOpen={gallery}
            onGalleryOpen={setGallery}
            onPick={(prompt) => {
              setDraft(`@DomainLenz ${prompt}`);
              setTimeout(() => input.current?.focus(), 0);
            }}
          />
        </div>
        <form
          className="dl-standalone-composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            ref={input}
            aria-label="메시지"
            placeholder={`#${channel.name}에 메시지 보내기`}
            value={draft}
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
          <div>
            <button
              type="button"
              className="dl-ai-trigger"
              onClick={() => setGallery(true)}
            >
              ✦ AI 질문
            </button>
            <small>Enter 전송 · Shift+Enter 줄바꿈</small>
            <button type="submit" disabled={!draft.trim()}>
              보내기 ↗
            </button>
          </div>
        </form>
        <footer className="dl-app-footer">
          개발자 전달용 인터랙티브 데모{" "}
          <span>개인 결과 → 확인 → 채널 공유</span>
        </footer>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Standalone />);
