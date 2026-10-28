import { useApp } from "../../app/context";
import { ApiError } from "../../shared/api/client";
import { Badge, Button } from "../../shared/ui/primitives";
import { Icon } from "../../shared/ui/Icon";
import { useTaskDetail } from "../tasks/hooks";

export function TaskCard({ id, onOpen }: { id: string; onOpen: () => void }) {
  const { lookups } = useApp(),
    task = useTaskDetail(id);
  const inaccessible =
    task.error instanceof ApiError && [403, 404].includes(task.error.status);
  if (inaccessible)
    return (
      <div className="task-card" role="note">
        접근 불가
      </div>
    );
  if (task.error)
    return (
      <div className="task-card" role="status">
        <p>업무를 조회하지 못했어요.</p>
        <Button onClick={() => void task.refetch()}>업무 다시 조회</Button>
      </div>
    );
  return (
    <button className="task-card" onClick={onOpen} disabled={!task.data}>
      <span className="flex items-center gap-2 text-[10px] text-muted">
        <Icon name="tasks" size={14} />
        연결된 업무
      </span>
      <b className="my-2 block text-[13px] text-primary">
        {task.data?.title ?? "업무를 확인하고 있어요"}
      </b>
      {task.data && (
        <>
          <small className="block text-[10px]">
            담당자{" "}
            {lookups.employees.find((e) => e.id === task.data!.assigneeId)
              ?.name ?? task.data.assigneeId}
          </small>
          <div className="flex justify-between">
            <small className="text-[10px]">기한 {task.data.due}</small>
            <Badge>{task.data.status}</Badge>
          </div>
        </>
      )}
    </button>
  );
}
