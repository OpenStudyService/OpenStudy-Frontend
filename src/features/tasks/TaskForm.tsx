import { useId, useState } from "react";
import { useApp } from "../../app/context";
import { ApiError } from "../../shared/api/client";
import type { Task } from "./api";
import { catalog } from "../../shared/domain/catalog";
import { Button, FieldError } from "../../shared/ui/primitives";
import { taskApi } from "./api";
import {
  canCreateTask,
  draftFromTask,
  taskBody,
  taskFields,
  taskPatch,
  validateTask,
} from "./model";
import type { TaskDraft } from "./model";
import { useTaskAssignees, useTaskLeaveGuard, useTaskWrite } from "./hooks";

export function TaskForm({
  task,
  onSaved,
}: {
  task?: Task;
  onSaved: () => void;
}) {
  const { session, scope } = useApp(),
    id = useId();
  const [base] = useState(task),
    [initial] = useState(() => draftFromTask(task, scope));
  const [draft, setDraft] = useState(initial),
    [errors, setErrors] = useState<Partial<Record<keyof TaskDraft, string>>>(
      {},
    );
  const [failure, setFailure] = useState<Error | null>(null),
    [latest, setLatest] = useState<Task | null>(null),
    [reading, setReading] = useState(false);
  const [conflictEdits, setConflictEdits] = useState<(keyof TaskDraft)[]>([]);
  const candidates = useTaskAssignees(draft.branchId),
    write = useTaskWrite();
  const leave = useTaskLeaveGuard(
    JSON.stringify(initial) !== JSON.stringify(draft) ||
      conflictEdits.length > 0,
  );
  const [conflict, setConflict] = useState(false);
  const denied =
    (failure instanceof ApiError && [401, 403].includes(failure.status)) ||
    latest?.canEdit === false;
  const candidateAvailable = candidates.data?.some(
    (person) => person.id === draft.assigneeId,
  );
  const labels = Object.fromEntries(
    catalog.tasks!.fields.map((f) => [f.key, f.label]),
  );
  function change(key: keyof TaskDraft, value: string) {
    if (conflict)
      setConflictEdits((fields) =>
        fields.includes(key) ? fields : [...fields, key],
      );
    setDraft((d) => ({
      ...d,
      [key]: value,
      ...(key === "branchId" ? { assigneeId: "" } : {}),
    }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }
  async function refresh() {
    setLatest(null);
    setReading(true);
    try {
      const current = await write.run(
        "read-latest",
        {},
        (signal) => taskApi.detail(scope, base!.id, signal),
        false,
      );
      setLatest(current);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        setFailure(error as Error);
    } finally {
      setReading(false);
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (write.busy || reading || denied || (conflict && !latest)) return;
    const checked = validateTask(draft);
    if (!canCreateTask(session.user, draft.branchId))
      checked.branchId = "접근 가능한 지점을 선택해 주세요.";
    if (!candidateAvailable && (!base || draft.assigneeId !== base.assignee.id))
      checked.assigneeId = "해당 지점의 활성 직원을 선택해 주세요.";
    setErrors(checked);
    if (Object.keys(checked).length) return;
    const payload = base
      ? taskPatch(base, draft, latest?.version ?? base.version, conflictEdits)
      : taskBody(draft);
    try {
      await write.run(
        base ? `tasks/${base.id}` : "tasks/new",
        payload,
        (signal, key) =>
          base
            ? taskApi.update(
                base.id,
                taskPatch(
                  base,
                  draft,
                  latest?.version ?? base.version,
                  conflictEdits,
                ),
                signal,
                scope,
              )
            : taskApi.create(taskBody(draft), signal, key, scope),
      );
      leave.saved();
      onSaved();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFailure(error as Error);
      setLatest(null);
      if (error instanceof ApiError) {
        if (error.status === 409) setConflict(true);
        const fields = error.detail.fieldErrors ?? {};
        setErrors({
          ...fields,
          due: fields.dueAt ?? fields.due,
          checks: fields.checklist ?? fields.checks,
        });
      }
    }
  }
  return (
    <form className="form-grid" noValidate onSubmit={submit}>
      {leave.guard}
      {taskFields
        .filter((key) => !base || !["status", "checks"].includes(key))
        .map((key) => {
          const field = catalog.tasks!.fields.find((f) => f.key === key)!;
          const inputId = `${id}-${key}`,
            errorId = `${inputId}-error`;
          const disabled =
            write.busy || reading || denied || (key === "branchId" && !!base);
          const props = {
            id: inputId,
            "aria-label": field.label,
            "aria-required": !["checks", "body", "due"].includes(key),
            "aria-invalid": !!errors[key],
            "aria-describedby": errors[key] ? errorId : undefined,
            disabled,
            value: draft[key],
            onChange: (
              e: React.ChangeEvent<
                HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
              >,
            ) => change(key, e.target.value),
          };
          return (
            <div className="field" key={key}>
              <label htmlFor={inputId}>
                {labels[key]}
                {!["checks", "body", "due"].includes(key) && (
                  <span className="ml-1 text-primary" aria-hidden="true">
                    *
                  </span>
                )}
              </label>
              {key === "branchId" ? (
                <select {...props}>
                  <option value="">선택해 주세요</option>
                  {session.branches
                    .filter((b) => canCreateTask(session.user, b.id))
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                </select>
              ) : key === "assigneeId" ? (
                <>
                  <select
                    {...props}
                    disabled={
                      disabled ||
                      !draft.branchId ||
                      candidates.isPending ||
                      !!candidates.error
                    }
                  >
                    <option value="">선택해 주세요</option>
                    {draft.assigneeId && !candidateAvailable && (
                      <option value={draft.assigneeId} disabled>
                        현재 담당자 (후보에서 제외됨)
                      </option>
                    )}
                    {candidates.data?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {draft.branchId && candidates.isPending && (
                    <p className="help" role="status">
                      담당자를 확인하고 있어요.
                    </p>
                  )}
                  {draft.branchId &&
                    !candidates.isPending &&
                    !candidates.data?.length && (
                      <p className="help">
                        선택 가능한 활성 직원 정보를 확인할 수 없어요.
                      </p>
                    )}
                  {candidates.error && (
                    <>
                      <FieldError>{candidates.error.message}</FieldError>
                      <Button
                        type="button"
                        onClick={() => void candidates.refetch()}
                      >
                        담당자 다시 조회
                      </Button>
                    </>
                  )}
                </>
              ) : field.options && key !== "category" ? (
                <select {...props}>
                  {(key === "priority"
                    ? ["낮음", "보통", "높음", "긴급"]
                    : field.options
                  ).map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : ["body", "checks"].includes(key) ? (
                <textarea
                  {...props}
                  placeholder={
                    key === "checks"
                      ? "한 줄에 한 항목씩 입력해 주세요. 완료 여부는 등록 후 변경할 수 있어요."
                      : undefined
                  }
                />
              ) : (
                <input
                  {...props}
                  type={key === "due" ? "datetime-local" : "text"}
                  maxLength={
                    key === "title" ? 200 : key === "category" ? 60 : undefined
                  }
                />
              )}
              {errors[key] && (
                <FieldError id={errorId}>{errors[key]}</FieldError>
              )}
            </div>
          );
        })}
      {failure && <FieldError>{failure.message}</FieldError>}
      {latest?.canEdit === false && (
        <FieldError>이 업무를 수정할 권한이 없어요.</FieldError>
      )}
      {conflict && (
        <section className="tip" aria-label="버전 충돌 확인">
          <p>
            입력 내용은 유지했어요. 최신 내용을 확인하고 비교한 뒤 다시 저장해
            주세요.
          </p>
          <Button
            type="button"
            onClick={() => void refresh()}
            disabled={reading || write.busy}
          >
            최신 내용 확인
          </Button>
          {latest && <LatestTask task={latest} />}
        </section>
      )}
      <div className="sticky bottom-0 flex justify-end border-t border-line bg-surface pt-4">
        <Button
          type="submit"
          variant="primary"
          disabled={
            write.busy ||
            reading ||
            denied ||
            (conflict && !latest) ||
            candidates.isPending ||
            !!candidates.error
          }
        >
          {write.busy
            ? "처리 중…"
            : base
              ? latest
                ? "최신 기준으로 다시 저장"
                : "저장하기"
              : "업무 등록"}
        </Button>
      </div>
    </form>
  );
}

export function LatestTask({ task }: { task: Task }) {
  return (
    <div className="mt-3" role="status">
      <h3>최신 업무 · 버전 {task.version}</h3>
      <dl className="grid gap-2">
        {catalog
          .tasks!.fields.filter((f) => f.key !== "branchId")
          .map((f) => (
            <div key={f.key}>
              <dt>{f.label}</dt>
              <dd className="whitespace-pre-wrap break-words">
                {f.key === "checks"
                  ? task.checklist
                      .map((c) => `${c.done ? "[x]" : "[ ]"} ${c.body}`)
                      .join("\n") || "없음"
                  : f.key === "assigneeId"
                    ? task.assignee.name
                    : f.key === "due"
                      ? task.dueAt
                        ? new Date(task.dueAt).toLocaleString("ko-KR")
                        : "—"
                      : String(task[f.key as keyof Task] ?? "—")}
              </dd>
            </div>
          ))}
      </dl>
    </div>
  );
}
