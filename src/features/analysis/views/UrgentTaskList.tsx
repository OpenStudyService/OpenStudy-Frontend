import { Link } from "react-router";

export function UrgentTaskList({
  rows,
  scope = "all",
}: {
  rows: Record<string, unknown>[];
  scope?: string;
}) {
  const tasks = rows.map((r, idx) => ({
    id: String(r.id ?? idx + 1),
    title: String(r.title ?? "긴급 업무"),
    branchId: String(r.branch_id ?? r.branchId ?? ""),
    branchName: String(r.branch_name ?? r.branchName ?? "지점"),
    priority: String(r.priority ?? "URGENT").toUpperCase(),
    status: String(r.status ?? "TODO").toUpperCase(),
    dueAt: String(r.due_at ?? r.dueAt ?? ""),
    assigneeId: r.assignee_employee_id ?? r.assigneeEmployeeId ?? null,
  }));

  return (
    <div
      className="flex flex-col gap-3"
      data-testid="viewspec-task-list"
      role="region"
      aria-label="긴급·높음 우선순위 미완료 업무 목록"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-soft px-4 py-2.5 text-xs">
        <span>
          우선순위 <strong>URGENT / HIGH</strong> 및 미완료(
          <strong>TODO / IN_PROGRESS</strong>) 기준{" "}
          <strong>{tasks.length}건</strong> (업무 본문 <code>body</code> 비노출
          보안 정책 적용)
        </span>
        <Link to={`/app/${scope}/tasks`} className="btn text-xs">
          업무 관리 화면 바로가기 →
        </Link>
      </div>

      <div className="grid gap-2.5">
        {tasks.map((task) => {
          const isUrgent =
            task.priority === "URGENT" || task.priority === "긴급";
          return (
            <div
              key={task.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3.5"
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span
                  className={`mt-0.5 inline-flex shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold ${
                    isUrgent
                      ? "bg-red-500/15 text-red-700"
                      : "bg-amber-500/15 text-amber-800"
                  }`}
                >
                  {isUrgent ? "URGENT · 긴급" : "HIGH · 높음"}
                </span>
                <div className="min-w-0">
                  <div className="font-semibold text-ink">{task.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>{task.branchName}</span>
                    <span>·</span>
                    <span>상태: {task.status}</span>
                    {task.dueAt && (
                      <>
                        <span>·</span>
                        <span>
                          마감: {task.dueAt.replace("T", " ").slice(0, 16)}
                        </span>
                      </>
                    )}
                    {task.assigneeId !== null && (
                      <>
                        <span>·</span>
                        <span>담당자 #{String(task.assigneeId)}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <span className="font-mono text-xs text-muted">#{task.id}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
