import { useEffect, useRef, useState } from "react";
import {
  Link,
  NavLink,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DropdownMenu } from "radix-ui";
import { api, API_BASE, MOCK } from "../shared/api/client";
import { closeStreams, openStream } from "../shared/api/stream";
import { can, admin } from "../shared/domain/schema";
import type { CurrentUser, WorkspaceEvent } from "../shared/domain/schema";
import {
  Avatar,
  Badge,
  Button,
  ErrorState,
  Panel,
  State,
} from "../shared/ui/primitives";
import { Icon } from "../shared/ui/Icon";
import { emptyLookups, normalizeLookups, useSession } from "./context";
import { isAccessError } from "../shared/api/read-model";
import { DataNotice } from "../shared/ui/DataNotice";
import { useUi } from "./store";
export const navigation = [
  { path: "home", title: "대시보드", icon: "home", group: "워크스페이스" },
  { path: "tasks", title: "업무 관리", icon: "tasks", group: "워크스페이스" },
  {
    path: "members",
    title: "회원·이용권",
    icon: "members",
    group: "매장 운영",
  },
  { path: "products", title: "상품·요율", icon: "money", group: "매장 운영" },
  {
    path: "payments",
    title: "결제·환불",
    icon: "money",
    group: "매장 운영",
    permission: "payments:read" as const,
  },
  {
    path: "reservations",
    title: "예약 관리",
    icon: "calendar",
    group: "매장 운영",
  },
  { path: "spaces", title: "좌석·사물함", icon: "seats", group: "매장 운영" },
  {
    path: "facilities",
    title: "시설·점검",
    icon: "facility",
    group: "매장 운영",
  },
  {
    path: "inquiries",
    title: "고객 문의",
    icon: "inquiry",
    group: "매장 운영",
  },
  { path: "notices", title: "공지사항", icon: "notice", group: "매장 운영" },
  { path: "attendance", title: "근무·근태", icon: "clock", group: "우리 팀" },
  {
    path: "employees",
    title: "직원 관리",
    icon: "members",
    group: "우리 팀",
    admin: true,
    permission: "people:manage" as const,
  },
  {
    path: "sales",
    title: "매출 조회",
    icon: "money",
    group: "업무 분석",
    permission: "sales:read" as const,
  },
  {
    path: "ai",
    title: "업무 AI",
    icon: "ai",
    group: "업무 분석",
    permission: "ai:read" as const,
  },
  { path: "settings", title: "설정", icon: "settings", group: "환경설정" },
];
export function Layout() {
  const session = useSession(),
    { scope = "all" } = useParams(),
    navigate = useNavigate(),
    location = useLocation(),
    query = useQueryClient();
  const { navOpen, setNav, clearPrivate } = useUi();
  const [streamState, setStreamState] = useState("연결 중");
  const user = session.data?.user;
  const lookups = useQuery({
    queryKey: ["data", user?.id, scope, "lookups"],
    queryFn: async ({ signal }) =>
      normalizeLookups(
        await api<unknown>(`/lookups?scope=${scope}`, { signal }),
      ),
    enabled:
      !!user &&
      session.data?.sessionMode !== "APPROVAL_ONLY" &&
      can(user, scope),
    retry: false,
  });
  const permissionKey = JSON.stringify([
    session.data?.sessionMode,
    user?.owner,
    user?.status,
    user?.memberships,
  ]);
  const previous = useRef({ scope, userId: user?.id, permissionKey });
  useEffect(() => {
    const old = previous.current;
    if (old.scope !== scope || old.userId !== user?.id) {
      const oldKey =
        old.userId !== user?.id
          ? ["data", old.userId]
          : ["data", old.userId, old.scope];
      void query.cancelQueries({ queryKey: oldKey });
      query.removeQueries({ queryKey: oldKey });
      clearPrivate();
      previous.current = { scope, userId: user?.id, permissionKey };
    } else if (old.permissionKey !== permissionKey) {
      closeStreams();
      clearPrivate();
      void query.resetQueries({ queryKey: ["data", user?.id] });
      previous.current = { scope, userId: user?.id, permissionKey };
    }
  }, [scope, user?.id, permissionKey, query, clearPrivate]);
  useEffect(() => {
    if (
      !user ||
      session.data?.sessionMode === "APPROVAL_ONLY" ||
      !can(user, scope) ||
      !lookups.isSuccess ||
      lookups.data?.preview
    )
      return;
    const invalidate = () => {
      void query.invalidateQueries({ queryKey: ["data", user.id, scope] });
    };
    const resync = () => {
      invalidate();
      void query.invalidateQueries({ queryKey: ["session"] });
    };
    const authorizationChanged = () => {
      closeStreams();
      clearPrivate();
      void query.cancelQueries({ queryKey: ["data", user.id] });
      query.removeQueries({ queryKey: ["data", user.id] });
      void query.invalidateQueries({ queryKey: ["session"] });
    };
    const controller = new AbortController();
    const stop = openStream(
      `${API_BASE}/workspace/events?scope=${encodeURIComponent(scope)}`,
      {
        invalidate,
        resync,
        "authorization.changed": authorizationChanged,
        connected: () => {
          setStreamState("연결됨");
          void query.invalidateQueries({ queryKey: ["data", user.id, scope] });
        },
        workspace: (event) => {
          try {
            const e = JSON.parse(
              (event as MessageEvent).data,
            ) as WorkspaceEvent;
            if (e.type === "read") {
              void query.invalidateQueries({
                queryKey: ["data", user.id, scope, "chat", "channels"],
              });
            } else void query.invalidateQueries({ queryKey: ["data"] });
            if (e.type === "permissions") authorizationChanged();
          } catch {
            setStreamState("데이터 확인 필요");
          }
        },
      },
      (connected) => {
        if (connected) {
          setStreamState("연결됨");
          return;
        }
        setStreamState("재연결 중");
        void api<CurrentUser>("/me", { signal: controller.signal })
          .then(() => query.invalidateQueries({ queryKey: ["session"] }))
          .catch(() => undefined);
      },
    );
    return () => {
      controller.abort();
      stop();
    };
  }, [
    user,
    session.data?.sessionMode,
    scope,
    permissionKey,
    query,
    lookups.isSuccess,
    lookups.data?.preview,
    clearPrivate,
  ]);
  if (session.isPending) return <State loading />;
  if (session.error)
    return (
      <ErrorState error={session.error} retry={() => void session.refetch()} />
    );
  if (!session.data)
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  if (
    session.data.sessionMode === "APPROVAL_ONLY" ||
    session.data.user.status === "승인 대기"
  )
    return <Navigate to="/pending-approval" replace />;
  if (session.data.user.status !== "활성")
    return (
      <State
        title="사용이 제한된 계정이에요"
        message={`현재 상태: ${session.data.user.status}. 관리자에게 문의해 주세요.`}
        action={<Button onClick={() => void logout()}>로그아웃</Button>}
      />
    );
  if (!can(session.data.user, scope))
    return (
      <State
        title="이 지점에 접근할 수 없어요"
        message="허용된 지점으로 이동하거나 관리자에게 문의해 주세요."
        action={
          <Button
            onClick={() =>
              navigate(`/app/${session.data!.branches[0]?.id || "all"}/home`)
            }
          >
            내 지점으로 이동
          </Button>
        }
      />
    );
  const current = session.data,
    activeUser = current.user;
  const workspaceLookups = {
    ...(lookups.data || emptyLookups),
    branches: lookups.data?.branches.length
      ? lookups.data.branches
      : current.branches,
    employees: lookups.data?.employees.length
      ? lookups.data.employees
      : [activeUser],
  };
  const menu = navigation.filter(
    (n) =>
      (!n.admin || admin(activeUser, scope)) &&
      (!n.permission || can(activeUser, scope, n.permission)),
  );
  const section = location.pathname.split("/")[3] || "home",
    title =
      section === "chat"
        ? "팀 채팅"
        : navigation.find((n) => n.path === section)?.title || "OpenStudy";
  async function logout() {
    await api("/auth/logout", { method: "POST", body: {} });
    closeStreams();
    clearPrivate();
    query.clear();
    navigate("/login", { replace: true });
  }
  function changeScope(next: string) {
    setNav(false);
    navigate(`/app/${next}/${section}${location.search}`);
  }
  const sidebar = (
    <aside className="sidebar">
      <div className="side-brand">
        OpenStudy <Icon name="leaf" size={18} />
      </div>
      <div className="side-scroll">
        <p className="nav-label">MY WORKSPACE</p>
        <label className="sr-only" htmlFor="branch-select">
          현재 지점
        </label>
        <select
          id="branch-select"
          className="scope-select"
          value={scope}
          onChange={(e) => changeScope(e.target.value)}
          disabled={current.branches.length === 0}
        >
          {current.branches.length === 0 && (
            <option value={scope}>등록된 지점 없음</option>
          )}
          {current.branches.length > 0 &&
            (scope === "all" || current.branches.length > 1) && (
              <option value="all">전체 허용 지점</option>
            )}
          {current.branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        {menu.map((n, i) => (
          <div key={n.path}>
            {menu[i - 1]?.group !== n.group && (
              <p className="nav-label">{n.group}</p>
            )}
            <NavLink
              to={`/app/${scope}/${n.path}`}
              className={({ isActive }) =>
                `nav-link ${isActive ? "active" : ""}`
              }
              onClick={() => setNav(false)}
            >
              <Icon name={n.icon} size={17} />
              {n.title}
            </NavLink>
          </div>
        ))}
      </div>
      <div className="border-t border-line px-5 py-4 text-[10px] text-primary">
        <Icon name="leaf" size={15} /> 오늘도, 좋은 공간을 함께.
      </div>
    </aside>
  );
  return (
    <div className="workspace">
      <a className="skip-link" href="#main">
        본문으로 건너뛰기
      </a>
      <nav className="rail" aria-label="빠른 탐색">
        <Link
          className="rail-logo"
          to={`/app/${scope}/home`}
          aria-label="OpenStudy 홈"
        >
          <Icon name="logo" size={30} />
        </Link>
        {[
          ["home", "home", "홈"],
          ["tasks", "tasks", "업무"],
          ["chat", "chat", "채팅"],
        ].map(([p, icon, label]) => (
          <NavLink
            key={p}
            to={`/app/${scope}/${p}`}
            className={({ isActive }) =>
              `rail-link ${isActive ? "active" : ""}`
            }
          >
            <Icon name={icon} size={23} />
            {label}
          </NavLink>
        ))}
        <div className="flex-1" />
        <NavLink className="rail-link" to={`/app/${scope}/settings`}>
          <Icon name="settings" />
          설정
        </NavLink>
        <Avatar name={activeUser.nickname || activeUser.name} />
      </nav>
      {sidebar}
      <div className="main-shell">
        <header className="topbar">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              className="mobile-menu"
              aria-label="메뉴 열기"
              onClick={() => setNav(true)}
            >
              <Icon name="menu" />
            </Button>
            <span className="hidden text-xs text-muted sm:block">
              워크스페이스
            </span>
            <span className="hidden text-line sm:block">/</span>
            <strong className="truncate text-xs">{title}</strong>
          </div>
          <div className="flex items-center gap-3">
            {(MOCK || lookups.data?.preview) && (
              <Badge>{MOCK ? "데모 데이터" : "로컬 샘플"}</Badge>
            )}
            <span
              className="hidden text-[10px] text-muted lg:inline"
              role="status"
            >
              {lookups.data?.preview
                ? "샘플 조회 모드"
                : !lookups.isSuccess
                  ? "데이터 연결 대기"
                  : streamState}
            </span>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  className="flex items-center gap-2 rounded-lg p-1 text-left"
                  aria-label="사용자 메뉴"
                >
                  <Avatar name={activeUser.nickname || activeUser.name} />
                  <span className="hidden text-xs sm:block">
                    <b>{activeUser.nickname || activeUser.name}</b>
                    <small className="block">
                      {activeUser.owner
                        ? "사장님"
                        : admin(activeUser, scope)
                          ? "지점 관리자"
                          : "직원"}
                    </small>
                  </span>
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="z-50 min-w-40 rounded-xl border border-line bg-surface p-2 shadow-xl"
                  sideOffset={10}
                >
                  <DropdownMenu.Item className="nav-link" asChild>
                    <Link to={`/app/${scope}/settings`}>내 프로필·테마</Link>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="nav-link"
                    onSelect={() => void logout()}
                  >
                    로그아웃
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </header>
        <main id="main" className="content" tabIndex={-1}>
          {lookups.data?.preview && (
            <p
              className="mb-4 rounded-xl border border-line bg-soft px-4 py-3 text-xs text-primary"
              role="status"
            >
              화면 확인용 샘플 데이터입니다. 업무 데이터의 추가·수정·삭제는
              지원하지 않습니다.
            </p>
          )}
          {isAccessError(lookups.error) ? (
            <ErrorState
              error={lookups.error!}
              retry={() => void lookups.refetch()}
            />
          ) : (
            <>
              <DataNotice
                label="공통 정보"
                loading={lookups.isPending}
                error={lookups.error}
                retry={() => void lookups.refetch()}
              />
              <Outlet
                key={`${activeUser.id}:${scope}`}
                context={{
                  session: current,
                  scope,
                  lookups: workspaceLookups,
                }}
              />
            </>
          )}
        </main>
      </div>
      <nav className="bottom-nav" aria-label="모바일 빠른 탐색">
        {[
          ["home", "home", "홈"],
          ["tasks", "tasks", "업무"],
          ["chat", "chat", "채팅"],
          ["settings", "settings", "설정"],
        ].map(([p, icon, label]) => (
          <NavLink
            key={p}
            to={`/app/${scope}/${p}`}
            className={({ isActive }) =>
              `rail-link ${isActive ? "active" : ""}`
            }
          >
            <Icon name={icon} />
            {label}
          </NavLink>
        ))}
      </nav>
      <Panel
        open={navOpen}
        onClose={() => setNav(false)}
        title="메뉴"
        description="업무 공간과 운영 메뉴를 선택하세요."
      >
        <div className="drawer-sidebar">{sidebar}</div>
      </Panel>
    </div>
  );
}
