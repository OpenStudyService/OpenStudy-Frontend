import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { useApp } from "../../app/context";
import {
  Badge,
  Button,
  ErrorState,
  Heading,
  State,
} from "../../shared/ui/primitives";
import { DataNotice } from "../../shared/ui/DataNotice";
import { Icon } from "../../shared/ui/Icon";
import {
  hasBlockingReadError,
  isAccessError,
} from "../../shared/api/read-model";
import { canCreateTask } from "./model";
import { taskApi } from "./api";
import { TaskPanel } from "./TaskPanel";
import { useTaskAssignees } from "./hooks";

function localDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Date(date.getTime() - date.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
}

export function Tasks() {
  const { session, scope, lookups } = useApp(),
    [params, setParams] = useSearchParams();
  const requestParams = new URLSearchParams(params);
  ["detail", "edit", "action", "thread", "tab"].forEach((key) =>
    requestParams.delete(key),
  );
  const search = requestParams.toString();
  const rows = useQuery({
    queryKey: ["data", session.user.id, scope, "tasks", "list", search],
    queryFn: ({ signal }) => taskApi.list(scope, search, signal),
    retry: false,
  });
  const summary = useQuery({
    queryKey: ["data", session.user.id, scope, "tasks", "summary", search],
    queryFn: ({ signal }) => taskApi.summary(scope, search, signal),
    retry: false,
  });
  const candidates = useTaskAssignees(scope);
  const page = rows.data?.meta.page ?? 1,
    pageSize = rows.data?.meta.pageSize ?? 20,
    total = rows.data?.meta.total ?? 0;
  const filter = (key: string, value: string) =>
    setParams(
      (p) => {
        if (value) p.set(key, value);
        else p.delete(key);
        p.delete("page");
        return p;
      },
      { replace: true },
    );
  function show(id: string) {
    setParams((p) => {
      p.set("detail", id);
      p.delete("edit");
      p.delete("action");
      return p;
    });
  }
  function close() {
    setParams((p) => {
      p.delete("detail");
      p.delete("edit");
      p.delete("action");
      return p;
    });
  }
  const creatable =
    scope === "all"
      ? session.branches.some((b) => canCreateTask(session.user, b.id))
      : canCreateTask(session.user, scope);
  return (
    <section className="page">
      <Heading
        title="업무 관리"
        description="작은 업무도 놓치지 않도록, 우리 팀의 하루를 함께 채워요."
      >
        {creatable && (
          <Button variant="primary" onClick={() => show("new")}>
            <Icon name="plus" size={16} />
            업무 등록
          </Button>
        )}
      </Heading>
      <div className="mb-4 flex flex-wrap gap-4" aria-label="업무 집계">
        {summary.data &&
        !hasBlockingReadError(summary) &&
        !summary.isPending ? (
          [
            ["전체", summary.data.totals.total],
            ["할 일", summary.data.totals.todo],
            ["진행 중", summary.data.totals.inProgress],
            ["완료", summary.data.totals.done],
            ["기한 초과", summary.data.totals.overdue],
          ].map(([label, value]) => (
            <span key={label}>
              {label} {value}건
            </span>
          ))
        ) : (
          <DataNotice
            label="업무 집계"
            loading={summary.isPending}
            error={summary.error!}
            retry={() => void summary.refetch()}
          />
        )}
      </div>
      <div className="card overflow-hidden">
        <div className="filters">
          <input
            type="search"
            aria-label="업무 검색"
            placeholder="업무 검색"
            value={params.get("q") ?? ""}
            onChange={(e) => filter("q", e.target.value)}
          />
          <select
            aria-label="상태 필터"
            value={params.get("status") ?? ""}
            onChange={(e) => filter("status", e.target.value)}
          >
            <option value="">전체 상태</option>
            {["할 일", "진행 중", "완료"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            aria-label="담당자 필터"
            value={params.get("assigneeId") ?? ""}
            onChange={(e) => filter("assigneeId", e.target.value)}
          >
            <option value="">전체 담당자</option>
            {(scope === "all"
              ? lookups.employees
              : (candidates.data ?? [])
            ).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Button
            variant={
              ["true", "1"].includes(params.get("mine") ?? "") ? "primary" : ""
            }
            aria-pressed={["true", "1"].includes(params.get("mine") ?? "")}
            onClick={() =>
              filter(
                "mine",
                ["true", "1"].includes(params.get("mine") ?? "") ? "" : "true",
              )
            }
          >
            내 업무
          </Button>
          <input
            type="datetime-local"
            aria-label="기한 시작 필터"
            value={localDateTime(params.get("dueFrom"))}
            onChange={(e) =>
              filter(
                "dueFrom",
                e.target.value ? new Date(e.target.value).toISOString() : "",
              )
            }
          />
          <input
            type="datetime-local"
            aria-label="기한 종료 필터"
            value={localDateTime(params.get("dueTo"))}
            onChange={(e) =>
              filter(
                "dueTo",
                e.target.value ? new Date(e.target.value).toISOString() : "",
              )
            }
          />
          <Button
            variant={params.get("overdue") === "true" ? "primary" : ""}
            aria-pressed={params.get("overdue") === "true"}
            onClick={() =>
              filter("overdue", params.get("overdue") === "true" ? "" : "true")
            }
          >
            기한 초과
          </Button>
          <select
            aria-label="정렬"
            value={params.get("sort") ?? "createdAt"}
            onChange={(e) => filter("sort", e.target.value)}
          >
            <option value="createdAt">등록일 순</option>
            <option value="updatedAt">수정일 순</option>
            <option value="priority">우선순위 순</option>
            <option value="dueAt">기한 순</option>
          </select>
          <select
            aria-label="정렬 방향"
            value={params.get("direction") ?? "desc"}
            onChange={(e) => filter("direction", e.target.value)}
          >
            <option value="desc">내림차순</option>
            <option value="asc">오름차순</option>
          </select>
          <Button
            variant="quiet"
            onClick={() =>
              setParams((p) => {
                for (const key of [
                  "q",
                  "status",
                  "assigneeId",
                  "mine",
                  "date",
                  "dueFrom",
                  "dueTo",
                  "overdue",
                  "sort",
                  "direction",
                  "page",
                  "pageSize",
                ])
                  p.delete(key);
                return p;
              })
            }
          >
            초기화
          </Button>
        </div>
        {rows.data?.items.length &&
        rows.error &&
        !hasBlockingReadError(rows) ? (
          <DataNotice
            label="업무 관리 데이터"
            error={rows.error}
            retry={() => void rows.refetch()}
          />
        ) : null}
        <div className="data-scroll">
          <table className="data-table">
            <thead>
              <tr>
                {[
                  "업무 제목",
                  "지점",
                  "담당자",
                  "기한",
                  "우선순위",
                  "상태",
                ].map((label) => (
                  <th key={label} scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.isPending ||
              hasBlockingReadError(rows) ||
              !rows.data?.items.length ? (
                <tr>
                  <td colSpan={6}>
                    {isAccessError(rows.error) ? (
                      <ErrorState error={rows.error!} />
                    ) : (
                      <>
                        <DataNotice
                          label="업무 관리 데이터"
                          loading={rows.isPending}
                          error={rows.error!}
                          retry={() => void rows.refetch()}
                        />
                        {!rows.isPending && !rows.error && (
                          <State
                            title="등록된 항목이 없어요"
                            message="검색 조건을 바꾸거나 새로운 항목을 등록해 주세요."
                          />
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ) : (
                rows.data.items.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <button
                        className="cell-link"
                        onClick={() => show(task.id)}
                      >
                        {task.title}
                      </button>
                    </td>
                    <td>
                      {session.branches.find((b) => b.id === task.branchId)
                        ?.name ?? task.branchId}
                    </td>
                    <td>{task.assignee.name}</td>
                    <td>
                      {task.dueAt
                        ? new Date(task.dueAt).toLocaleString("ko-KR")
                        : "미지정"}
                      {task.overdue && <Badge>기한 초과</Badge>}
                    </td>
                    <td>
                      <Badge>{task.priority}</Badge>
                    </td>
                    <td>
                      <Badge>{task.status}</Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-xs text-muted">
          <span>
            {rows.error
              ? "항목 수 확인 불가"
              : rows.isPending
                ? "항목 수 확인 중"
                : `총 ${total}건 · ${page}페이지`}
          </span>
          <div className="flex gap-2">
            <Button
              disabled={rows.isPending || !!rows.error || page <= 1}
              onClick={() =>
                setParams((p) => {
                  p.set("page", String(page - 1));
                  return p;
                })
              }
            >
              이전
            </Button>
            <Button
              disabled={
                rows.isPending || !!rows.error || page * pageSize >= total
              }
              onClick={() =>
                setParams((p) => {
                  p.set("page", String(page + 1));
                  return p;
                })
              }
            >
              다음
            </Button>
          </div>
        </footer>
      </div>
      {params.get("detail") && (
        <TaskPanel id={params.get("detail")!} onClose={close} />
      )}
    </section>
  );
}
