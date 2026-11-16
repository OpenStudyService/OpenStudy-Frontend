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
  }));

  const priority: Record<string, string> = { URGENT: "긴급", HIGH: "높음" };
  const status: Record<string, string> = {
    TODO: "할 일",
    IN_PROGRESS: "진행 중",
  };
  const due = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  // The DomainLens result mock-up's task table: the task, its branch, due date, priority and status.
  return (
    <div
      className="grid gap-2"
      data-testid="viewspec-task-list"
      role="region"
      aria-label="긴급·높음 우선순위 미완료 업무 목록"
    >
      <div className="data-scroll">
        <table className="data-table">
          <caption className="sr-only">처리해야 할 업무</caption>
          <thead>
            <tr>
              <th scope="col">업무</th>
              <th scope="col">지점</th>
              <th scope="col">기한</th>
              <th scope="col">우선순위</th>
              <th scope="col">상태</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => {
              const urgent = task.priority === "URGENT";
              const at = Date.parse(task.dueAt);
              return (
                <tr key={task.id}>
                  <td>
                    <Link
                      to={`/app/${scope}/tasks?detail=${encodeURIComponent(task.id)}`}
                      className="font-semibold text-ink hover:text-primary"
                    >
                      {task.title}
                    </Link>
                  </td>
                  <td>{task.branchName}</td>
                  <td>{Number.isFinite(at) ? due.format(at) : "-"}</td>
                  <td>
                    <span
                      className={`status-pill ${urgent ? "danger" : "warn"}`}
                    >
                      {priority[task.priority] ?? task.priority}
                    </span>
                  </td>
                  <td>{status[task.status] ?? task.status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Link
        to={`/app/${scope}/tasks`}
        className="help justify-self-end hover:text-primary"
      >
        업무 관리 화면에서 보기 →
      </Link>
    </div>
  );
}
