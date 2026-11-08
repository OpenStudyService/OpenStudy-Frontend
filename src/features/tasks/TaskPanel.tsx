import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { useApp } from "../../app/context";
import { useUi } from "../../app/store";
import { ApiError } from "../../shared/api/client";
import { isAccessError } from "../../shared/api/read-model";
import { displayDate } from "../../shared/domain/schema";
import type { Task, TaskEvent } from "./api";
import {
  Badge,
  Button,
  ErrorState,
  FieldError,
  Panel,
  State,
} from "../../shared/ui/primitives";
import { canCreateTask, canEditTask, actionLabels, taskActions } from "./model";
import type { TaskAction } from "./model";
import { taskApi } from "./api";
import { useTaskDetail, useTaskWrite, useTaskLeaveGuard } from "./hooks";
import { LatestTask, TaskForm } from "./TaskForm";

export function TaskPanel(props: { id: string; onClose: () => void }) {
  const { session, scope } = useApp();
  // A changed authorization context must discard drafts and cancel pending writes.
  const context = JSON.stringify([
    session.user.id,
    scope,
    session.user.owner,
    session.user.status,
    session.user.memberships,
  ]);
  return <TaskPanelSession key={`${props.id}:${context}`} {...props} />;
}
function TaskPanelSession({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const { session, scope } = useApp(),
    [params, setParams] = useSearchParams();
  const row = useTaskDetail(id),
    toast = useUi((s) => s.toast);
  const editing = params.get("edit") === "1",
    action = params.get("action") as TaskAction | null;
  const task = row.data,
    editable = !!task && canEditTask(session.user, task);
  function mode(key: string, val: string) {
    setParams((p) => {
      if (val) p.set(key, val);
      else p.delete(key);
      return p;
    });
  }
  const isNew = id === "new";
  const title = isNew
    ? "업무 등록"
    : editing
      ? "업무 수정"
      : action && Object.hasOwn(actionLabels, action)
        ? actionLabels[action]
        : (task?.title ?? "업무 상세");
  return (
    <Panel
      open
      title={title}
      description="업무 내용과 처리 이력을 확인해 주세요."
      onClose={onClose}
    >
      {isNew ? (
        (
          scope === "all"
            ? session.branches.some((b) => canCreateTask(session.user, b.id))
            : canCreateTask(session.user, scope)
        ) ? (
          <TaskForm
            onSaved={() => {
              toast("업무 등록을 완료했어요.");
              onClose();
            }}
          />
        ) : (
          <State title="등록 가능한 지점이 없어요" />
        )
      ) : row.isPending ? (
        <State loading />
      ) : row.error && (!task || isAccessError(row.error)) ? (
        <ErrorState error={row.error} retry={() => void row.refetch()} />
      ) : (
        task && (
          <>
            {row.error && (
              <ErrorState error={row.error} retry={() => void row.refetch()} />
            )}
            {editing ? (
              editable ? (
                <TaskForm
                  key={`${id}:edit`}
                  task={task}
                  onSaved={() => {
                    toast("변경 내용을 저장했어요.");
                    mode("edit", "");
                  }}
                />
              ) : (
                <State title="이 업무를 수정할 권한이 없어요" />
              )
            ) : action && Object.hasOwn(actionLabels, action) && editable ? (
              <TaskActionForm
                key={action}
                task={task}
                action={action}
                onSaved={() => mode("action", "")}
              />
            ) : (
              <>
                {action && <FieldError>이 작업을 수행할 수 없어요.</FieldError>}
                <dl className="grid gap-4">
                  {[
                    [
                      "지점",
                      session.branches.find((b) => b.id === task.branchId)
                        ?.name ?? task.branchId,
                    ],
                    ["내용", task.body],
                    ["분류", task.category],
                    [
                      "기한",
                      task.dueAt
                        ? new Date(task.dueAt).toLocaleString("ko-KR")
                        : "미지정",
                    ],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <dt className="text-muted">{label}</dt>
                      <dd className="whitespace-pre-wrap break-words">{val}</dd>
                    </div>
                  ))}
                  <TaskPeople task={task} />
                  <div>
                    <dt className="text-muted">우선순위 · 상태</dt>
                    <dd>
                      <Badge>{task.priority}</Badge>{" "}
                      <Badge>{task.status}</Badge>
                    </dd>
                  </div>
                </dl>
                <TaskChecks
                  key={`${task.id}:${editable}`}
                  task={task}
                  enabled={editable}
                />
                <section className="mt-6 border-t border-line pt-5">
                  <h3>처리 이력</h3>
                  <TaskHistory id={task.id} />
                </section>
                {editable && (
                  <div className="mt-6 flex flex-wrap gap-2">
                    <Button onClick={() => mode("edit", "1")}>수정하기</Button>
                    {[...taskActions(task)].map((key) => (
                      <Button key={key} onClick={() => mode("action", key)}>
                        {actionLabels[key]}
                      </Button>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )
      )}
    </Panel>
  );
}
function TaskPeople({ task }: { task: Task }) {
  return (
    <>
      <div>
        <dt className="text-muted">담당자</dt>
        <dd>{task.assignee.name}</dd>
      </div>
      {task.createdBy && (
        <div>
          <dt className="text-muted">등록자</dt>
          <dd>{task.createdBy.name}</dd>
        </div>
      )}
    </>
  );
}
const eventLabels: Record<TaskEvent["type"], string> = {
  CREATED: "업무 등록",
  CONTENT_CHANGED: "내용 변경",
  ASSIGNEE_CHANGED: "담당자 변경",
  DUE_CHANGED: "기한 변경",
  STATUS_CHANGED: "상태 변경",
  CHECKLIST_ADDED: "체크 항목 추가",
  CHECKLIST_CHANGED: "체크 항목 변경",
  CHECKLIST_REMOVED: "체크 항목 삭제",
};
function TaskHistory({ id }: { id: string }) {
  const { session, scope, lookups } = useApp(),
    [page, setPage] = useState(1);
  const events = useQuery({
    queryKey: ["data", session.user.id, scope, "tasks", "events", id, page],
    queryFn: ({ signal }) => taskApi.events(scope, id, signal, page),
    retry: false,
  });
  if (events.isPending) return <State loading />;
  if (events.error)
    return (
      <ErrorState error={events.error} retry={() => void events.refetch()} />
    );
  return (
    <>
      {events.data.items.length ? (
        events.data.items.map((event) => (
          <div
            key={event.id}
            className="help mt-3 whitespace-pre-wrap break-words"
          >
            <p>
              {displayDate(event.at)} · {event.actor?.name ?? "탈퇴한 직원"} ·{" "}
              {eventLabels[event.type]}
            </p>
            {event.before && eventValues(event.before, lookups.employees) && (
              <p>변경 전: {eventValues(event.before, lookups.employees)}</p>
            )}
            {event.after && eventValues(event.after, lookups.employees) && (
              <p>변경 후: {eventValues(event.after, lookups.employees)}</p>
            )}
          </div>
        ))
      ) : (
        <p className="help">처리 이력이 없습니다.</p>
      )}
      <div className="mt-3 flex gap-2">
        <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>
          이전 이력
        </Button>
        <Button
          disabled={page * events.data.meta.pageSize >= events.data.meta.total}
          onClick={() => setPage(page + 1)}
        >
          다음 이력
        </Button>
      </div>
    </>
  );
}
function eventValues(
  values: Record<string, unknown>,
  employees: { id: string; name: string }[],
) {
  const labels: Record<string, string> = {
    title: "제목",
    body: "내용",
    status: "상태",
    priority: "우선순위",
    category: "분류",
    assigneeId: "담당자",
    assignee: "담당자",
    dueAt: "기한",
    done: "완료",
  };
  return Object.entries(values)
    .filter(([key]) => Object.hasOwn(labels, key))
    .map(
      ([key, value]) =>
        `${labels[key]}: ${value == null ? "없음" : key === "assigneeId" ? (employees.find((employee) => employee.id === value)?.name ?? "담당자 변경") : key === "assignee" && typeof value === "object" && "name" in value ? String(value.name) : key === "dueAt" ? new Date(String(value)).toLocaleString("ko-KR") : typeof value === "boolean" ? (value ? "예" : "아니요") : typeof value === "object" ? "변경됨" : String(value)}`,
    )
    .join(" · ");
}
function TaskActionForm({
  task,
  action,
  onSaved,
}: {
  task: Task;
  action: TaskAction;
  onSaved: () => void;
}) {
  const { scope, session } = useApp(),
    query = useQueryClient(),
    write = useTaskWrite(),
    toast = useUi((s) => s.toast);
  const [base, setBase] = useState(task),
    [error, setError] = useState<Error | null>(null),
    [latest, setLatest] = useState<Task | null>(null);
  const [conflict, setConflict] = useState(false);
  const denied = error instanceof ApiError && [401, 403].includes(error.status);
  const allowed =
    canEditTask(session.user, base) && taskActions(base).includes(action);
  async function refresh() {
    try {
      const value = await write.run(
        "task-latest",
        {},
        (signal) => taskApi.detail(scope, task.id, signal),
        false,
      );
      setBase(value);
      setLatest(value);
      query.setQueryData(
        ["data", session.user.id, scope, "tasks", "detail", task.id],
        value,
      );
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        setError(e as Error);
    }
  }
  async function submit() {
    if (!allowed || write.busy || denied || (conflict && !latest)) return;
    try {
      await write.run(
        `tasks/${task.id}/${action}`,
        { version: base.version },
        (signal) =>
          taskApi.status(
            scope,
            task.id,
            {
              version: base.version,
              status:
                action === "complete"
                  ? "완료"
                  : action === "progress"
                    ? "진행 중"
                    : "할 일",
            },
            signal,
          ),
      );
      toast("처리 결과를 저장했어요.");
      onSaved();
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(e as Error);
        setLatest(null);
        if (e instanceof ApiError && e.status === 409) setConflict(true);
      }
    }
  }
  return (
    <section className="grid gap-4">
      <p className="tip">
        {actionLabels[action]} 작업을 진행합니다. 처리 결과는 관련 목록과 집계에
        함께 반영돼요.
      </p>
      {error && <FieldError>{error.message}</FieldError>}
      {conflict && (
        <>
          <p>최신 내용을 확인한 뒤 작업을 다시 선택해 주세요.</p>
          <Button disabled={write.busy} onClick={() => void refresh()}>
            최신 내용 확인
          </Button>
          {latest && <LatestTask task={latest} />}
        </>
      )}
      {!allowed && (
        <p className="help">
          현재 상태 또는 권한으로는 이 작업을 진행할 수 없어요.
        </p>
      )}
      <Button
        variant="primary"
        disabled={write.busy || !allowed || denied || (conflict && !latest)}
        onClick={() => void submit()}
      >
        {write.busy ? "처리 중…" : actionLabels[action]}
      </Button>
    </section>
  );
}
function TaskChecks({ task, enabled }: { task: Task; enabled: boolean }) {
  const { scope, session } = useApp(),
    query = useQueryClient(),
    write = useTaskWrite();
  const [error, setError] = useState<Error | null>(null),
    [mustRefresh, setMustRefresh] = useState(false);
  const [body, setBody] = useState(""),
    [editing, setEditing] = useState<string | null>(null),
    [editBody, setEditBody] = useState("");
  const denied = error instanceof ApiError && [401, 403].includes(error.status);
  const blocked = !enabled || write.busy || mustRefresh || denied;
  const orphaned =
    editing !== null && !task.checklist.some((item) => item.id === editing);
  const leave = useTaskLeaveGuard(!!body || editing !== null);
  const cache = (value: Task) =>
    query.setQueryData(
      ["data", session.user.id, scope, "tasks", "detail", task.id],
      value,
    );
  async function change(
    kind: "add" | "update" | "delete",
    itemId?: string,
    changes?: { body?: string; done?: boolean },
  ) {
    if (
      blocked ||
      (kind !== "add" && !task.checklist.some((item) => item.id === itemId))
    )
      return;
    const addedBody = (changes?.body ?? body).trim();
    if (
      (kind === "add" && !addedBody) ||
      (kind === "update" && changes?.body !== undefined && !changes.body.trim())
    ) {
      setError(new Error("체크 항목의 내용을 입력해 주세요."));
      return;
    }
    const payload = {
      version: task.version,
      ...(kind === "add" ? { body: addedBody } : changes),
    };
    try {
      const result = await write.run(
        `tasks/${task.id}/checklist/${itemId ?? "new"}/${kind}`,
        payload,
        (signal) =>
          kind === "add"
            ? taskApi.addChecklist(
                scope,
                task.id,
                { version: task.version, body: addedBody },
                signal,
              )
            : kind === "delete"
              ? taskApi.deleteChecklist(
                  scope,
                  task.id,
                  itemId!,
                  task.version,
                  signal,
                )
              : taskApi.updateChecklist(
                  scope,
                  task.id,
                  itemId!,
                  payload,
                  signal,
                ),
      );
      cache(result);
      setError(null);
      if (kind === "add") {
        if (changes?.body !== undefined) setEditing(null);
        else setBody("");
      }
      if (kind === "update" && changes?.body !== undefined) setEditing(null);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e as Error);
      if (e instanceof ApiError && e.status === 409) setMustRefresh(true);
    }
  }
  async function refresh() {
    try {
      const result = await write.run(
        "checklist-latest",
        {},
        (signal) => taskApi.detail(scope, task.id, signal),
        false,
      );
      cache(result);
      setMustRefresh(false);
      setError(null);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        setError(e as Error);
    }
  }
  return (
    <section
      className="mt-6 border-t border-line pt-5"
      aria-label="업무 체크리스트"
    >
      {leave.guard}
      <h3 className="mb-3">체크리스트</h3>
      {task.checklist.length ? (
        task.checklist.map((item) => (
          <div key={item.id} className="my-3 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-[13px] font-normal">
              <input
                type="checkbox"
                checked={item.done}
                disabled={blocked}
                onChange={() =>
                  void change("update", item.id, { done: !item.done })
                }
              />
              <span className={item.done ? "text-muted line-through" : ""}>
                {item.body}
              </span>
            </label>
            {enabled &&
              (editing === item.id ? (
                <>
                  <input
                    aria-label="체크 항목 내용 수정"
                    value={editBody}
                    disabled={blocked}
                    maxLength={500}
                    onChange={(event) => setEditBody(event.target.value)}
                  />
                  <Button
                    disabled={blocked}
                    onClick={() =>
                      void change("update", item.id, { body: editBody.trim() })
                    }
                  >
                    항목 저장
                  </Button>
                  <Button
                    disabled={write.busy}
                    onClick={() => setEditing(null)}
                  >
                    취소
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    disabled={blocked}
                    aria-label={`${item.body} 수정`}
                    onClick={() => {
                      setEditing(item.id);
                      setEditBody(item.body);
                    }}
                  >
                    수정
                  </Button>
                  <Button
                    disabled={blocked}
                    aria-label={`${item.body} 삭제`}
                    onClick={() => void change("delete", item.id)}
                  >
                    삭제
                  </Button>
                </>
              ))}
          </div>
        ))
      ) : (
        <p className="help">등록한 체크 항목이 없습니다.</p>
      )}
      {enabled && orphaned && (
        <section className="tip mt-3" aria-label="삭제된 체크 항목 입력 복구">
          <p>
            수정 중인 항목이 삭제됐어요. 입력 내용을 복사하거나 새 항목으로
            추가할 수 있어요.
          </p>
          <input
            aria-label="체크 항목 내용 수정"
            value={editBody}
            maxLength={500}
            disabled={write.busy}
            onChange={(event) => setEditBody(event.target.value)}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              disabled={blocked || task.checklist.length >= 100}
              onClick={() => void change("add", undefined, { body: editBody })}
            >
              새 항목으로 추가
            </Button>
            <Button disabled={write.busy} onClick={() => setEditing(null)}>
              취소
            </Button>
          </div>
        </section>
      )}
      {enabled && (
        <div className="mt-3 flex gap-2">
          <input
            aria-label="새 체크 항목"
            placeholder="체크 항목을 입력해 주세요"
            value={body}
            maxLength={500}
            disabled={blocked || task.checklist.length >= 100}
            onChange={(event) => setBody(event.target.value)}
          />
          <Button
            disabled={blocked || task.checklist.length >= 100}
            onClick={() => void change("add")}
          >
            항목 추가
          </Button>
        </div>
      )}
      {error && <FieldError>{error.message}</FieldError>}
      {mustRefresh && (
        <>
          <p className="help">
            입력은 유지했어요. 최신 내용을 확인한 후 항목 작업을 다시 선택해
            주세요.
          </p>
          <Button onClick={() => void refresh()} disabled={write.busy}>
            최신 내용 확인
          </Button>
        </>
      )}
    </section>
  );
}
