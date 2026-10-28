import { useId, useState } from "react";
import { useApp } from "../../app/context";
import { ApiError } from "../../shared/api/client";
import type { Task } from "../../shared/domain/schema";
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
  const candidates = useTaskAssignees(draft.branchId),
    write = useTaskWrite();
  const leave = useTaskLeaveGuard(
    JSON.stringify(initial) !== JSON.stringify(draft),
  );
  const [conflict, setConflict] = useState(false);
  const denied =
    failure instanceof ApiError && [401, 403].includes(failure.status);
  const candidateAvailable = candidates.data?.some(
    (person) => person.id === draft.assigneeId,
  );
  const labels = Object.fromEntries(
    catalog.tasks!.fields.map((f) => [f.key, f.label]),
  );
  function change(key: keyof TaskDraft, value: string) {
    setDraft((d) => ({
      ...d,
      [key]: value,
      ...(key === "branchId" ? { assigneeId: "" } : {}),
    }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }
  async function refresh() {
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
    if (!candidateAvailable)
      checked.assigneeId = "해당 지점의 활성 직원을 선택해 주세요.";
    setErrors(checked);
    if (Object.keys(checked).length) return;
    const payload = base
      ? taskPatch(base, draft, latest?.version ?? base.version)
      : taskBody(draft);
    try {
      await write.run(
        base ? `tasks/${base.id}` : "tasks/new",
        payload,
        (signal, key) =>
          base
            ? taskApi.update(base.id, payload, signal, key)
            : taskApi.create(payload, signal, key),
      );
      leave.saved();
      onSaved();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFailure(error as Error);
      setLatest(null);
      if (error instanceof ApiError) {
        if (error.status === 409) setConflict(true);
        setErrors(error.detail.fieldErrors ?? {});
      }
    }
  }
  return (
    <form className="form-grid" noValidate onSubmit={submit}>
      {leave.guard}
      {taskFields.map((key) => {
        const field = catalog.tasks!.fields.find((f) => f.key === key)!;
        const inputId = `${id}-${key}`,
          errorId = `${inputId}-error`;
        const disabled =
          write.busy || reading || denied || (key === "branchId" && !!base);
        const props = {
          id: inputId,
          "aria-label": field.label,
          "aria-required": key !== "checks",
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
              {key !== "checks" && (
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
                      현재 담당자 (다시 선택해 주세요)
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
            ) : field.options ? (
              <select {...props}>
                {field.options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : ["body", "checks"].includes(key) ? (
              <textarea
                {...props}
                placeholder={
                  key === "checks"
                    ? "한 줄에 한 항목씩 입력해 주세요. [x]로 완료를 표시할 수 있어요."
                    : undefined
                }
              />
            ) : (
              <input
                {...props}
                type={key === "due" ? "date" : "text"}
                maxLength={key === "title" ? 120 : undefined}
              />
            )}
            {errors[key] && <FieldError id={errorId}>{errors[key]}</FieldError>}
          </div>
        );
      })}
      {failure && <FieldError>{failure.message}</FieldError>}
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
  const { lookups } = useApp();
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
                  ? task.checks
                      .map((c) => `${c.done ? "[x]" : "[ ]"} ${c.text}`)
                      .join("\n") || "없음"
                  : f.key === "assigneeId"
                    ? (lookups.employees.find((e) => e.id === task.assigneeId)
                        ?.name ?? task.assigneeId)
                    : String(task[f.key as keyof Task] ?? "—")}
              </dd>
            </div>
          ))}
      </dl>
    </div>
  );
}
