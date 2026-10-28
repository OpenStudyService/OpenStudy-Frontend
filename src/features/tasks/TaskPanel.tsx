import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { useApp } from "../../app/context";
import { useUi } from "../../app/store";
import { ApiError, MOCK } from "../../shared/api/client";
import { displayDate } from "../../shared/domain/schema";
import type { Task } from "../../shared/domain/schema";
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
import { useTaskDetail, useTaskWrite } from "./hooks";
import { LatestTask, TaskForm } from "./TaskForm";
import { TaskShare } from "../chat/TaskShare";

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
      ) : row.error ? (
        <ErrorState error={row.error} retry={() => void row.refetch()} />
      ) : (
        task && (
          <>
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
            ) : action === "share" && MOCK ? (
              <TaskShare
                task={task}
                onSaved={() => {
                  toast("업무를 공유했어요.");
                  mode("action", "");
                }}
              />
            ) : action &&
              Object.hasOwn(actionLabels, action) &&
              editable &&
              (action !== "share" || MOCK) ? (
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
                    ["기한", task.due],
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
                <TaskChecks task={task} enabled={editable} />
                <section className="mt-6 border-t border-line pt-5">
                  <h3>처리 이력</h3>
                  <TaskHistory task={task} />
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
                {MOCK && (
                  <div className="mt-3">
                    <Button onClick={() => mode("action", "share")}>
                      운영 채널에 공유
                    </Button>
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
  const { lookups } = useApp();
  const person = (id: string) =>
    lookups.employees.find((p) => p.id === id)?.name ?? id;
  return (
    <>
      <div>
        <dt className="text-muted">담당자</dt>
        <dd>{person(task.assigneeId)}</dd>
      </div>
      {task.createdById && (
        <div>
          <dt className="text-muted">등록자</dt>
          <dd>{person(task.createdById)}</dd>
        </div>
      )}
    </>
  );
}
function TaskHistory({ task }: { task: Task }) {
  const { lookups } = useApp();
  return task.history.length ? (
    task.history.map((h, i) => (
      <p key={i} className="help mt-2 whitespace-pre-wrap break-words">
        {displayDate(h.at)} ·{" "}
        {lookups.employees.find((p) => p.id === h.actorId)?.name ?? h.actorId} ·{" "}
        {h.text}
      </p>
    ))
  ) : (
    <p className="help">처리 이력이 없습니다.</p>
  );
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
    canEditTask(session.user, base) &&
    (action === "share" ? MOCK : taskActions(base).includes(action));
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
        (signal, key) =>
          taskApi.action(scope, task.id, action, base.version, signal, key),
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
  const row = useTaskDetail(task.id),
    write = useTaskWrite();
  const [error, setError] = useState<Error | null>(null),
    [mustRefresh, setMustRefresh] = useState(false);
  async function toggle(index: number) {
    if (!enabled || write.busy || mustRefresh) return;
    const body = {
      version: task.version,
      checks: task.checks.map((c, i) =>
        i === index ? { ...c, done: !c.done } : c,
      ),
    };
    try {
      await write.run(`tasks/${task.id}/checks`, body, (signal, key) =>
        taskApi.update(task.id, body, signal, key),
      );
      setError(null);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e as Error);
      if (e instanceof ApiError && e.status === 409) setMustRefresh(true);
    }
  }
  async function refresh() {
    const result = await row.refetch();
    if (result.error) setError(result.error);
    else {
      setMustRefresh(false);
      setError(null);
    }
  }
  return (
    <section
      className="mt-6 border-t border-line pt-5"
      aria-label="업무 체크리스트"
    >
      <h3 className="mb-3">체크리스트</h3>
      {task.checks.length ? (
        task.checks.map((c, i) => (
          <label
            key={i}
            className="my-3 flex items-start gap-2 text-[13px] font-normal"
          >
            <input
              type="checkbox"
              checked={c.done}
              disabled={!enabled || write.busy || mustRefresh}
              onChange={() => void toggle(i)}
            />
            <span className={c.done ? "text-muted line-through" : ""}>
              {c.text}
            </span>
          </label>
        ))
      ) : (
        <p className="help">등록한 체크 항목이 없습니다.</p>
      )}
      {error && <FieldError>{error.message}</FieldError>}
      {mustRefresh && (
        <>
          <p className="help">
            최신 내용을 확인한 후 체크 항목을 다시 선택해 주세요.
          </p>
          <Button onClick={() => void refresh()} disabled={row.isFetching}>
            최신 내용 확인
          </Button>
        </>
      )}
    </section>
  );
}
