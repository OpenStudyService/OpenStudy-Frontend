import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { useApp } from "../../app/context";
import { ApiError, api, queryString } from "../../shared/api/client";
import type {
  components,
  operations,
} from "../../shared/api/foundation.generated";
import { isAccessError } from "../../shared/api/read-model";
import { businessDate, can, displayDate } from "../../shared/domain/schema";
import { DataNotice } from "../../shared/ui/DataNotice";
import { Icon } from "../../shared/ui/Icon";
import {
  Avatar,
  Badge,
  ErrorState,
  Heading,
  State,
} from "../../shared/ui/primitives";

type HomeSummary = components["schemas"]["HomeSummary"];
type HomeLink = components["schemas"]["HomeLink"];
type Ratio = components["schemas"]["Ratio"];
type HomeQuery = NonNullable<
  operations["getHomeSummary"]["parameters"]["query"]
>;

const destinations = {
  "seat-board": { page: "spaces", tab: "seats" },
  "task-list": { page: "tasks" },
  "task-detail": { page: "tasks" },
  "inquiry-list": { page: "inquiries" },
  "inquiry-detail": { page: "inquiries" },
  "facility-list": { page: "facilities" },
  "facility-detail": { page: "facilities" },
  "shift-list": { page: "attendance", tab: "shifts", view: "list" },
  "shift-detail": { page: "attendance", tab: "shifts", view: "list" },
  "notice-list": { page: "notices" },
  "notice-detail": { page: "notices" },
} satisfies Record<
  HomeLink["screen"],
  { page: string; tab?: string; view?: string }
>;

function homeHref(scope: string, link: HomeLink) {
  const { page, ...defaults } = destinations[link.screen];
  const params = new URLSearchParams({ ...defaults, ...link.query });
  if (link.targetId !== null) params.set("detail", link.targetId);
  const query = params.toString();
  return `/app/${encodeURIComponent(link.branchId ?? scope)}/${page}${query ? `?${query}` : ""}`;
}

function ratioLabel(ratio: Ratio | undefined) {
  if (!ratio) return "—";
  return ratio.state === "notApplicable" ? "해당 없음" : `${ratio.percent}%`;
}

export function Home() {
  const { session, scope, lookups } = useApp();
  const [params, setParams] = useSearchParams();
  const assigneeId = params.get("assigneeId") || undefined;
  const rawMine = params.get("mine");
  const mine =
    !assigneeId && rawMine === "true"
      ? true
      : rawMine === "false"
        ? false
        : undefined;
  const filters: HomeQuery = { scope, mine, assigneeId };
  const data = useQuery({
    queryKey: [
      "data",
      session.user.id,
      scope,
      "home",
      filters.mine,
      filters.assigneeId,
    ],
    queryFn: async ({ signal }) => {
      const query = queryString({ ...filters, mine: filters.mine?.toString() });
      const summary = await api<HomeSummary>(`/home/summary?${query}`, {
        signal,
      });
      if (
        !summary?.meta ||
        !summary.seats ||
        !summary.tasks ||
        !summary.inquiries ||
        !summary.facilities ||
        !summary.shifts ||
        !summary.notices
      ) {
        throw new ApiError(502, {
          code: "INVALID_RESPONSE",
          message: "홈 요약을 확인할 수 없어요.",
        });
      }
      return summary;
    },
  });
  if (isAccessError(data.error))
    return <ErrorState error={data.error!} retry={() => void data.refetch()} />;
  const d = data.data;
  const appliedMine =
    d?.meta.taskFilter.mine ?? mine ?? (!assigneeId && !session.user.owner);
  const href = (link: HomeLink) => homeHref(scope, link);
  const emptyTitle = (title: string) =>
    data.isPending
      ? "데이터를 불러오고 있어요"
      : !d
        ? "데이터를 확인할 수 없어요"
        : title;
  const name = session.user.nickname || session.user.name;
  const date = d?.meta.date ?? businessDate(session.asOf);
  const chooseMine = (next: boolean) => {
    if (next === appliedMine && !assigneeId) return;
    const updated = new URLSearchParams(params);
    updated.delete("assigneeId");
    updated.set("mine", String(next));
    setParams(updated, { replace: true });
  };
  const stats = [
    {
      label: "현재 이용 좌석",
      value: d && `${d.seats.inUse}/${d.seats.total}석`,
      note: d && `${d.seats.available}석 이용 가능`,
      icon: "seats",
      link: d?.seats.link,
    },
    {
      label: "오늘 업무",
      value: d && `${d.tasks.today.open}건`,
      note: d && `내 업무 ${d.tasks.mine.open}건`,
      icon: "tasks",
      link: d?.tasks.link,
    },
    {
      label: "미처리 문의",
      value: d && `${d.inquiries.unresolved}건`,
      icon: "inquiry",
      link: d?.inquiries.link,
    },
    {
      label: "오늘의 근무 계획",
      value: d && `${d.shifts.count}건`,
      icon: "clock",
      link: d?.shifts.link,
    },
  ];
  return (
    <div className="page">
      <Heading
        title={`안녕하세요, ${name}님 ☀`}
        description="우리 공간의 오늘을 한눈에 확인하고, 팀과 함께 하루를 시작해요."
      >
        <small className="flex items-center gap-2">
          <Icon name="calendar" size={15} />
          {date} · KST
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
              {lookups.branches.length
                ? "선택한 범위의 운영 현황을 함께 살펴보고 있어요."
                : "등록된 지점이 없어요. 지점 등록 후 운영 현황을 확인할 수 있어요."}
            </p>
          </div>
          {d && (
            <Link
              className="btn hidden border-white/25 bg-white/10 text-white sm:inline-flex"
              to={href(d.tasks.link)}
            >
              오늘의 업무 확인 <Icon name="arrow" size={16} />
            </Link>
          )}
        </div>
      </section>
      <div className="stat-grid">
        {stats.map(({ label, value, note, icon, link }) => {
          const content = (
            <>
              <div className="flex items-center justify-between text-[11px] text-muted">
                <span>{label}</span>
                <Icon name={icon} size={17} />
              </div>
              <p className="stat-value">{value ?? "—"}</p>
              {note && (
                <small className="text-[10px] text-primary">{note}</small>
              )}
            </>
          );
          return link ? (
            <Link key={label} className="card p-5" to={href(link)}>
              {content}
            </Link>
          ) : (
            <div key={label} className="card p-5">
              {content}
            </div>
          );
        })}
      </div>
      <div className="home-grid">
        <div className="grid content-start gap-5">
          <section className="card">
            <header className="card-header">
              <h2>
                {appliedMine ? "내 업무" : "오늘 업무"}{" "}
                <small>{d?.tasks.today.total}</small>
              </h2>
              {d && (
                <Link className="text-xs text-primary" to={href(d.tasks.link)}>
                  전체 보기 →
                </Link>
              )}
            </header>
            <div className="tabs mb-0 px-2">
              <button
                className={`tab ${!appliedMine ? "active" : ""}`}
                aria-pressed={!appliedMine}
                onClick={() => chooseMine(false)}
              >
                오늘 업무
              </button>
              <button
                className={`tab ${appliedMine ? "active" : ""}`}
                aria-pressed={appliedMine}
                onClick={() => chooseMine(true)}
              >
                내 업무
              </button>
            </div>
            {d?.tasks.items.length ? (
              d.tasks.items.map((task) => (
                <Link key={task.id} className="task-line" to={href(task.link)}>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[13px]">{task.title}</b>
                    <small>
                      {displayDate(task.dueAt)} · {task.assignee?.name}
                    </small>
                  </span>
                  <Badge>{task.overdue ? "기한 지남" : task.status}</Badge>
                </Link>
              ))
            ) : (
              <State title={emptyTitle("오늘 배정된 미완료 업무가 없어요")} />
            )}
            <div className="flex justify-between px-5 py-3 text-xs text-muted">
              <span>완료율 {ratioLabel(d?.tasks.today.completionRate)}</span>
              {d && (
                <span>
                  {d.tasks.today.completedToday}/{d.tasks.today.total}건 완료
                </span>
              )}
            </div>
          </section>
          <section className="card">
            <header className="card-header">
              <h2>
                점검 필요 시설 <small>{d?.facilities.inspectionDue}</small>
              </h2>
              {d && (
                <Link
                  className="text-xs text-primary"
                  to={href(d.facilities.link)}
                >
                  점검 보기 →
                </Link>
              )}
            </header>
            {d?.facilities.items.length ? (
              d.facilities.items.map((facility) => (
                <Link
                  className="task-line"
                  key={facility.id}
                  to={href(facility.link)}
                >
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-xs">{facility.name}</b>
                    <small>다음 점검 {facility.nextInspectionOn}</small>
                  </span>
                  <Badge>{facility.status}</Badge>
                </Link>
              ))
            ) : (
              <State title={emptyTitle("등록된 점검 항목이 없어요")} />
            )}
          </section>
          <section className="card">
            <header className="card-header">
              <h2>미처리 문의</h2>
              {d && (
                <Link
                  className="text-xs text-primary"
                  to={href(d.inquiries.link)}
                >
                  문의 보기 →
                </Link>
              )}
            </header>
            {d?.inquiries.items.length ? (
              d.inquiries.items.map((inquiry) => (
                <Link
                  className="task-line"
                  key={inquiry.id}
                  to={href(inquiry.link)}
                >
                  <b className="min-w-0 flex-1 truncate text-xs">
                    {inquiry.subject}
                  </b>
                  <Badge>{inquiry.status}</Badge>
                </Link>
              ))
            ) : (
              <State title={emptyTitle("미처리 문의가 없어요")} />
            )}
          </section>
          <section className="card">
            <header className="card-header">
              <h2>게시 중 공지</h2>
              {d && (
                <Link
                  className="text-xs text-primary"
                  to={href(d.notices.link)}
                >
                  전체 공지 →
                </Link>
              )}
            </header>
            {d?.notices.items.length ? (
              d.notices.items.map((notice) => (
                <Link
                  className="task-line"
                  key={notice.id}
                  to={href(notice.link)}
                >
                  {notice.pinned && <Badge>중요</Badge>}
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                    {notice.title}
                  </span>
                </Link>
              ))
            ) : (
              <State title={emptyTitle("등록된 공지사항이 없어요")} />
            )}
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
                    background: `conic-gradient(var(--primary) ${d?.seats.occupancy.percent ?? 0}%,var(--soft) 0)`,
                  }}
                >
                  <div className="grid h-28 w-28 place-content-center rounded-full bg-surface text-center">
                    <strong className="text-lg">
                      {ratioLabel(d?.seats.occupancy)}
                    </strong>
                    <small>좌석 점유율</small>
                  </div>
                </div>
                <div className="grid flex-1 gap-4 text-[11px]">
                  <span>
                    이용 중{" "}
                    <b className="float-right">{d?.seats.inUse ?? "—"}</b>
                  </span>
                  <span>
                    이용 가능{" "}
                    <b className="float-right">{d?.seats.available ?? "—"}</b>
                  </span>
                </div>
              </div>
              {d?.seats.branches.map((branch) => (
                <div
                  key={branch.branchId}
                  className="mt-5 flex justify-between text-xs"
                >
                  <b>
                    {lookups.branches.find((b) => b.id === branch.branchId)
                      ?.name ?? branch.branchId}
                  </b>
                  <span>
                    {branch.inUse}/{branch.total}석 ·{" "}
                    {ratioLabel(branch.occupancy)}
                  </span>
                </div>
              ))}
            </div>
          </section>
          <section className="card">
            <header className="card-header">
              <h2>오늘 근무</h2>
              {d && (
                <Link className="text-xs text-primary" to={href(d.shifts.link)}>
                  근무표 보기 →
                </Link>
              )}
            </header>
            {d?.shifts.items.length ? (
              d.shifts.items.map((shift) => (
                <Link
                  className="task-line"
                  key={shift.id}
                  to={href(shift.link)}
                >
                  <Avatar name={shift.employee.name} />
                  <span>
                    <b className="block text-xs">{shift.employee.name}</b>
                    <small>
                      {displayDate(shift.startsAt)} –{" "}
                      {displayDate(shift.endsAt)}
                    </small>
                  </span>
                </Link>
              ))
            ) : (
              <State title={emptyTitle("오늘 예정된 근무가 없어요")} />
            )}
            <div className="border-t border-line p-5">
              <h3 className="mb-2 text-sm font-semibold">
                오늘 함께하는 동료 <small>{d?.shifts.colleagueCount}</small>
              </h3>
              {d?.shifts.colleagues.length ? (
                <ul className="grid gap-3">
                  {d.shifts.colleagues.map((colleague, index) => (
                    <li key={index} className="text-xs">
                      <b className="block">{colleague.employeeName}</b>
                      <small>
                        {displayDate(colleague.startsAt)} –{" "}
                        {displayDate(colleague.endsAt)}
                      </small>
                    </li>
                  ))}
                </ul>
              ) : (
                <State title={emptyTitle("오늘 예정된 동료 근무가 없어요")} />
              )}
            </div>
          </section>
          {can(session.user, scope, "ai:read") && (
            <section className="card p-5">
              <h2>AI 채팅</h2>
              <Link
                className="btn mt-4 w-full"
                to={`/app/${encodeURIComponent(scope)}/chat`}
              >
                AI 채팅 열기 <Icon name="arrow" size={16} />
              </Link>
            </section>
          )}
        </aside>
      </div>
      <footer className="mt-6 flex justify-between gap-4 text-[10px] text-muted">
        <span>OpenStudy · 좋은 공간을 함께 만드는 우리 팀</span>
        <span>집계 기준 {date}</span>
      </footer>
    </div>
  );
}
