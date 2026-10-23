import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { useState } from "react";
import { api } from "../../shared/api/client";
import { businessDate, displayDate } from "../../shared/domain/schema";
import type { ResourceMap } from "../../shared/domain/schema";
import { useApp } from "../../app/context";
import {
  Avatar,
  Badge,
  ErrorState,
  Heading,
  State,
} from "../../shared/ui/primitives";
import { Icon } from "../../shared/ui/Icon";
import { asCollections, isAccessError } from "../../shared/api/read-model";
import { DataNotice } from "../../shared/ui/DataNotice";
interface HomeData {
  tasks: ResourceMap["tasks"][];
  seats: ResourceMap["seats"][];
  facilities: ResourceMap["facilities"][];
  inquiries: ResourceMap["inquiries"][];
  notices: ResourceMap["notices"][];
  shifts: ResourceMap["shifts"][];
  messages: ResourceMap["messages"][];
}
const emptyHome: HomeData = {
  tasks: [],
  seats: [],
  facilities: [],
  inquiries: [],
  notices: [],
  shifts: [],
  messages: [],
};
export function Home() {
  const { session, scope, lookups } = useApp(),
    [mine, setMine] = useState(!session.user.owner);
  const data = useQuery({
    queryKey: ["data", session.user.id, scope, "home"],
    queryFn: async ({ signal }) =>
      asCollections(
        emptyHome,
        await api<unknown>(`/home?scope=${scope}`, { signal }),
      ),
    retry: false,
  });
  if (isAccessError(data.error))
    return <ErrorState error={data.error!} retry={() => void data.refetch()} />;
  const d = data.data || emptyHome;
  const unavailable = !data.data && (data.isPending || !!data.error);
  const emptyTitle = (title: string) =>
    data.isPending
      ? "데이터를 불러오고 있어요"
      : data.error
        ? "데이터를 확인할 수 없어요"
        : title;
  const name = session.user.nickname || session.user.name,
    tasks = d.tasks.filter((t) => !mine || t.assigneeId === session.user.id),
    used = d.seats.filter((s) => s.status === "이용 중").length,
    free = d.seats.filter((s) => s.status === "이용 가능").length,
    rate = d.seats.length ? Math.round((used / d.seats.length) * 100) : 0,
    completed = tasks.filter((t) => t.status === "완료").length;
  const facilities = d.facilities.filter((f) => f.status !== "완료"),
    notices = d.notices.filter((n) => n.status === "게시 중"),
    shifts = d.shifts.filter(
      (s) =>
        businessDate(s.startsAt) === businessDate(session.asOf) &&
        s.status !== "취소",
    );
  const href = (page: string, id?: string) =>
    `/app/${scope}/${page}${id ? `?detail=${id}` : ""}`;
  const person = (id: string) =>
    lookups.employees.find((p) => p.id === id)?.name || id;
  return (
    <div className="page">
      <Heading
        title={`안녕하세요, ${name}님 ☀`}
        description="우리 공간의 오늘을 한눈에 확인하고, 팀과 함께 하루를 시작해요."
      >
        <small className="flex items-center gap-2">
          <Icon name="calendar" size={15} />
          {businessDate(session.asOf)} · KST
        </small>
      </Heading>
      <DataNotice
        label="홈 데이터"
        loading={data.isPending}
        error={data.error}
        retry={() => void data.refetch()}
      />
      <section className="hero">
        <div className="relative z-10 flex items-center justify-between gap-6">
          <div>
            <small className="text-[10px] font-semibold tracking-[.12em]">
              TOGETHER, BETTER SPACES
            </small>
            <h2>
              집중할 수 있는 공간,
              <br />
              오늘도 함께 만들어요.
            </h2>
            <p className="text-xs">
              {lookups.branches.length ? (
                <>
                  지금 허용된{" "}
                  {
                    lookups.branches.filter(
                      (b) => scope === "all" || b.id === scope,
                    ).length
                  }
                  개 지점의 하루를 함께 살펴보고 있어요.
                </>
              ) : (
                "등록된 지점이 없어요. 지점 등록 후 운영 현황을 확인할 수 있어요."
              )}
            </p>
          </div>
          <Link
            className="btn hidden border-white/25 bg-white/10 text-white sm:inline-flex"
            to={href("tasks")}
          >
            오늘의 업무 확인 <Icon name="arrow" size={16} />
          </Link>
        </div>
      </section>
      <div className="stat-grid">
        {[
          {
            label: "현재 이용 좌석",
            number: used,
            unit: `/${d.seats.length}석`,
            note: `${free}석 이용 가능`,
            icon: "seats",
            link: "spaces",
          },
          {
            label: mine ? "나의 오늘 업무" : "오늘의 업무",
            number: tasks.filter((t) => t.status !== "완료").length,
            unit: "건",
            note: `전체 ${tasks.length}건 중 ${completed}건 완료`,
            icon: "tasks",
            link: "tasks",
          },
          {
            label: "확인이 필요한 문의",
            number: d.inquiries.filter((i) => i.status !== "답변 완료").length,
            unit: "건",
            note: "회원의 이야기를 기다리고 있어요",
            icon: "inquiry",
            link: "inquiries",
          },
          {
            label: "오늘의 근무 계획",
            number: d.shifts.filter(
              (s) =>
                businessDate(s.startsAt) === businessDate(session.asOf) &&
                s.status !== "취소",
            ).length,
            unit: "명",
            note: "근무표의 예정 인원",
            icon: "clock",
            link: "attendance",
          },
        ].map((s) => (
          <Link key={s.label} className="card p-5" to={href(s.link)}>
            <div className="flex items-center justify-between text-[11px] text-muted">
              <span>{s.label}</span>
              <Icon name={s.icon} size={17} />
            </div>
            <p className="stat-value">
              {unavailable ? "—" : s.number}
              {!unavailable && (
                <small className="ml-1 font-normal">{s.unit}</small>
              )}
            </p>
            <small className="text-[10px] text-primary">
              {unavailable ? "데이터 확인 대기" : s.note}
            </small>
          </Link>
        ))}
      </div>
      <div className="home-grid">
        <div className="grid content-start gap-5">
          <section className="card">
            <header className="card-header">
              <h2>
                오늘의 업무 <small>{tasks.length}</small>
              </h2>
              <Link className="text-xs text-primary" to={href("tasks")}>
                전체 보기 →
              </Link>
            </header>
            <div className="tabs mb-0 px-2">
              <button
                className={`tab ${!mine ? "active" : ""}`}
                onClick={() => setMine(false)}
              >
                오늘의 업무
              </button>
              <button
                className={`tab ${mine ? "active" : ""}`}
                onClick={() => setMine(true)}
              >
                내 업무
              </button>
            </div>
            {tasks.length ? (
              tasks.slice(0, 5).map((t) => (
                <Link key={t.id} className="task-line" to={href("tasks", t.id)}>
                  <span
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border border-line ${t.status === "완료" ? "bg-primary text-white" : ""}`}
                  >
                    {t.status === "완료" && <Icon name="check" size={12} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <b
                      className={`block truncate text-[13px] ${t.status === "완료" ? "text-muted line-through" : ""}`}
                    >
                      {t.title}
                    </b>
                    <small className="mt-1 block text-[10px]">
                      {lookups.branches.find((b) => b.id === t.branchId)?.name}{" "}
                      · {t.category} · {t.due}
                    </small>
                  </span>
                  <Badge>{t.priority === "높음" ? "높음" : t.status}</Badge>
                  <Avatar name={person(t.assigneeId)} />
                </Link>
              ))
            ) : (
              <State title={emptyTitle("오늘 배정된 업무가 없어요")} />
            )}
            <div className="flex justify-between px-5 py-3 text-[10px] text-muted">
              <span>하나씩 완료하며 오늘을 채워가요.</span>
              <span>
                {unavailable
                  ? "—"
                  : tasks.length
                    ? Math.round((completed / tasks.length) * 100)
                    : 0}
                % 완료
              </span>
            </div>
            <div className="progress rounded-none">
              <i
                style={{
                  width: `${tasks.length ? (completed / tasks.length) * 100 : 0}%`,
                }}
              />
            </div>
          </section>
          <section className="card">
            <header className="card-header">
              <h2>확인이 필요한 일</h2>
              <Link className="text-xs text-primary" to={href("facilities")}>
                점검 보기 →
              </Link>
            </header>
            {!facilities.length && (
              <State title={emptyTitle("등록된 점검 항목이 없어요")} />
            )}
            {facilities.map((f) => (
              <Link
                className="task-line"
                key={f.id}
                to={href("facilities", f.id)}
              >
                <span className="rounded-xl bg-soft p-3 text-primary">
                  <Icon name="facility" />
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-xs">{f.title}</b>
                  <small className="block text-[10px]">
                    {person(f.assigneeId)} 담당 · 다음 점검 {f.nextCheck}
                  </small>
                </span>
                <Badge>{f.condition}</Badge>
              </Link>
            ))}
          </section>
          <section className="card">
            <header className="card-header">
              <h2>최근 업무 공유</h2>
              <Link className="text-xs text-primary" to={href("chat")}>
                채팅 열기 →
              </Link>
            </header>
            {!d.messages.length && (
              <State title={emptyTitle("아직 공유된 업무가 없어요")} />
            )}
            {d.messages
              .slice(-3)
              .reverse()
              .map((m) => (
                <Link
                  className="task-line"
                  key={m.id}
                  to={`${href("chat")}/${m.channelId}`}
                >
                  <Avatar name={person(m.authorId)} />
                  <div className="min-w-0 flex-1">
                    <b className="text-xs">{person(m.authorId)}</b>
                    <p className="truncate text-xs text-muted">{m.text}</p>
                    <small className="text-[10px]">
                      {displayDate(m.createdAt)}
                    </small>
                  </div>
                </Link>
              ))}
          </section>
          <section className="card">
            <header className="card-header">
              <h2>팀에게 전하는 소식</h2>
              <Link className="text-xs text-primary" to={href("notices")}>
                전체 공지 →
              </Link>
            </header>
            {!notices.length && (
              <State title={emptyTitle("등록된 공지사항이 없어요")} />
            )}
            {notices.slice(0, 3).map((n) => (
              <Link className="task-line" key={n.id} to={href("notices", n.id)}>
                {n.pinned && <Badge>중요</Badge>}
                <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                  {n.title}
                </span>
              </Link>
            ))}
          </section>
        </div>
        <aside className="home-aside grid content-start gap-5">
          <section className="card">
            <header className="card-header">
              <h2>우리 공간은 지금</h2>
              <Icon name="leaf" />
            </header>
            <div className="card-body">
              <div className="flex items-center gap-5">
                <div
                  className="relative grid h-32 w-32 shrink-0 place-items-center rounded-full"
                  style={{
                    background: `conic-gradient(var(--primary) ${rate}%,var(--soft) 0)`,
                  }}
                >
                  <div className="grid h-28 w-28 place-content-center rounded-full bg-surface text-center">
                    <strong className="text-[29px]">
                      {unavailable ? "—" : rate}
                      {!unavailable && <small>%</small>}
                    </strong>
                    <small className="text-[10px]">좌석 이용률</small>
                  </div>
                </div>
                <div className="grid flex-1 gap-4 text-[11px]">
                  <span>
                    이용 중{" "}
                    <b className="float-right">{unavailable ? "—" : used}</b>
                  </span>
                  <span>
                    이용 가능{" "}
                    <b className="float-right">{unavailable ? "—" : free}</b>
                  </span>
                </div>
              </div>
              {!d.seats.length && (
                <p className="help mt-4">
                  {emptyTitle("등록된 좌석이 없어요")}
                </p>
              )}
              {lookups.branches
                .filter((b) => scope === "all" || b.id === scope)
                .map((b) => {
                  const seats = d.seats.filter((s) => s.branchId === b.id),
                    busy = seats.filter((s) => s.status === "이용 중").length;
                  return (
                    <div key={b.id} className="mt-5">
                      <div className="mb-2 flex justify-between text-[11px]">
                        <b>{b.name}</b>
                        <span>
                          {busy} / {seats.length}석
                        </span>
                      </div>
                      <div className="progress">
                        <i
                          style={{
                            width: `${seats.length ? (busy / seats.length) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
            <div className="border-t border-line px-5 py-3 text-[10px] text-primary">
              쾌적한 공간을 함께 유지하고 있어요
            </div>
          </section>
          <section className="card">
            <header className="card-header">
              <h2>오늘 함께하는 동료</h2>
              <Icon name="clock" />
            </header>
            <div className="grid gap-5 p-5">
              {!shifts.length && (
                <State title={emptyTitle("오늘 예정된 근무가 없어요")} />
              )}
              {shifts.map((s) => (
                <div className="flex items-center gap-3" key={s.id}>
                  <Avatar name={person(s.employeeId)} />
                  <div className="min-w-0 flex-1">
                    <b className="text-xs">{person(s.employeeId)}</b>
                    <small className="block text-[10px]">
                      {displayDate(s.startsAt)} –{" "}
                      {displayDate(s.endsAt).split(" ").at(-1)}
                    </small>
                  </div>
                  <Badge>예정</Badge>
                </div>
              ))}
            </div>
          </section>
          <section className="card p-5">
            <h2>대화로 이어지는 업무</h2>
            <p className="help my-4">
              점검 결과부터 작은 요청까지.
              <br />
              우리 팀 채널에서 이야기해요.
            </p>
            <Link className="btn w-full" to={href("chat")}>
              팀 채팅 열기 <Icon name="arrow" size={16} />
            </Link>
          </section>
        </aside>
      </div>
      <footer className="mt-6 flex justify-between gap-4 text-[10px] text-muted">
        <span>OpenStudy · 좋은 공간을 함께 만드는 우리 팀</span>
        <span>집계 기준 {businessDate(session.asOf)}</span>
      </footer>
    </div>
  );
}
