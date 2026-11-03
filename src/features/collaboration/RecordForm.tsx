import { FacilityTypeCreate } from "./FacilityTypeCreate";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { ApiError } from "../../shared/api/client";
import { can, businessDate } from "../../shared/domain/schema";
import { Button, ErrorState, FieldError } from "../../shared/ui/primitives";
import { Field } from "../organization/shared";
import { InquiryCustomer } from "./InquiryCustomer";
import { taskApi } from "../tasks/api";
import { recordApi, type Detail, type Resource } from "./api";
import { Details } from "./RecordDetail";
import { statuses } from "./Records";
import { useRecordLeaveGuard, useRecordWrite } from "./hooks";

type Draft = Record<string, string>;
function initial(row?: Detail): Draft {
  if (!row) return {};
  if ("openWork" in row)
    return {
      name: row.name,
      typeId: row.type.id,
      location: row.location ?? "",
      description: row.description ?? "",
      status: row.status,
      inspectionIntervalDays: String(row.inspectionIntervalDays),
      assigneeId: row.openWork.assignee?.id ?? "",
      workStatus: row.openWork.status,
    };
  if ("customer" in row)
    return {
      assigneeId: row.assignee?.id ?? "",
      answer: row.answer ?? "",
      status: row.status,
    };
  return {
    title: row.title,
    body: row.body,
    target: row.target,
    branchIds: row.branchIds.join(","),
    pinned: String(row.pinned),
  };
}
export function RecordForm({
  resource,
  row,
  mode,
  onSaved,
}: {
  resource: Resource;
  row?: Detail;
  mode: string;
  onSaved: () => void;
}) {
  const { session, scope } = useApp();
  const creating = mode === "create",
    editing = mode === "edit";
  const branches = session.branches.filter(
    (b) =>
      (scope === "all" || b.id === scope) &&
      (resource === "inquiries" ||
        can(
          session.user,
          b.id,
          resource === "facilities" ? "facilities:write" : "notices:write",
        )),
  );
  const [original] = useState(row);
  const [base] = useState(() => initial(row));
  const [draft, setDraft] = useState<Draft>(() => ({
    branchId: branches.length === 1 ? branches[0].id : "",
    status:
      resource === "facilities"
        ? "정상"
        : resource === "inquiries"
          ? "접수"
          : "게시 중",
    source: "방문",
    target: "선택 지점",
    branchIds: branches.length === 1 ? branches[0].id : "",
    pinned: "false",
    completedOn: businessDate(session.asOf),
    facilityStatus: "정상",
    ...base,
    ...(mode === "status"
      ? {
          status:
            resource === "notices"
              ? row?.status === "게시 중"
                ? "게시 종료"
                : "게시 중"
              : "처리 중",
        }
      : {}),
  }));
  const [latest, setLatest] = useState<Detail>();
  const [error, setError] = useState<Error | null>(null),
    [blocked, setBlocked] = useState(false);
  const write = useRecordWrite();
  const branchId = row && "branchId" in row ? row.branchId : draft.branchId;
  const types = useQuery({
    queryKey: ["data", session.user.id, scope, "facilities", "types"],
    queryFn: ({ signal }) => recordApi.types(signal),
    enabled: resource === "facilities" && (creating || editing),
    retry: false,
  });
  const people = useQuery({
    queryKey: ["data", session.user.id, scope, resource, "assignees", branchId],
    queryFn: ({ signal }) => taskApi.assignees(branchId, signal),
    enabled: !!branchId && resource !== "notices",
    retry: false,
  });
  const [dirty, setDirty] = useState(false),
    leave = useRecordLeaveGuard(dirty);
  function change(key: string, v: string) {
    setDirty(true);
    setDraft((d) => ({
      ...d,
      [key]: v,
      ...(key === "branchId" ? { assigneeId: "", customerId: "" } : {}),
    }));
  }
  function field(
    label: string,
    key: string,
    required = false,
    type = "text",
    maxLength?: number,
  ) {
    return (
      <Field key={key} label={label}>
        {type === "textarea" ? (
          <textarea
            aria-label={label}
            value={draft[key] ?? ""}
            required={required}
            maxLength={maxLength}
            onChange={(e) => change(key, e.target.value)}
          />
        ) : (
          <input
            aria-label={label}
            type={type}
            min={type === "number" ? 1 : undefined}
            value={draft[key] ?? ""}
            required={required}
            maxLength={maxLength}
            onChange={(e) => change(key, e.target.value)}
          />
        )}
      </Field>
    );
  }
  function select(label: string, key: string, options: string[]) {
    return (
      <Field label={label}>
        <select
          aria-label={label}
          value={draft[key] ?? ""}
          required
          onChange={(e) => change(key, e.target.value)}
        >
          {options.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </Field>
    );
  }
  function assignee() {
    return (
      <>
        <Field label="담당자">
          <select
            aria-label="담당자"
            value={draft.assigneeId ?? ""}
            disabled={people.isPending || !!people.error}
            onChange={(e) => change("assigneeId", e.target.value)}
          >
            <option value="">미지정</option>
            {draft.assigneeId &&
              !people.data?.some((p) => p.id === draft.assigneeId) && (
                <option value={draft.assigneeId}>현재 담당자</option>
              )}
            {people.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        {people.error && (
          <ErrorState
            error={people.error}
            retry={() => void people.refetch()}
          />
        )}
      </>
    );
  }
  function body() {
    const patch: Record<string, unknown> = {};
    const add = (key: string, value: unknown = draft[key]) => {
      if (creating || draft[key] !== base[key]) patch[key] = value;
    };
    if (creating) patch.branchId = draft.branchId;
    else patch.version = (latest ?? original)!.version;
    if (mode === "inspection/complete")
      return {
        version: patch.version,
        result: draft.result,
        completedOn: draft.completedOn,
        facilityStatus: draft.facilityStatus,
      };
    if (mode === "answer")
      return { version: patch.version, answer: draft.answer };
    if (mode === "assignee")
      return { version: patch.version, assigneeId: draft.assigneeId || null };
    if (mode === "status")
      return { version: patch.version, status: draft.status };
    if (resource === "facilities") {
      for (const k of ["name", "typeId", "status"]) add(k);
      for (const k of ["location", "description", "assigneeId"])
        add(k, draft[k] || null);
      if (draft.inspectionIntervalDays)
        add("inspectionIntervalDays", Number(draft.inspectionIntervalDays));
      if (editing) add("workStatus");
      if (creating && draft.lastInspectedOn) {
        patch.lastInspectedOn = draft.lastInspectedOn;
        if (draft.lastInspectionResult)
          patch.lastInspectionResult = draft.lastInspectionResult;
      }
    } else if (resource === "inquiries") {
      for (const k of ["customerId", "subject", "body", "source", "status"])
        add(k);
      add("assigneeId", draft.assigneeId || null);
    } else {
      delete patch.branchId;
      for (const k of ["title", "body"]) add(k);
      add("pinned", draft.pinned === "true");
      if (
        creating ||
        draft.target !== base.target ||
        draft.branchIds !== base.branchIds
      ) {
        patch.target = draft.target;
        if (draft.target === "선택 지점")
          patch.branchIds = draft.branchIds.split(",").filter(Boolean);
      }
      if (creating) patch.status = draft.status;
    }
    return patch;
  }
  const permission = creating
    ? branches.length > 0
    : row &&
      ("openWork" in row
        ? mode === "inspection/complete"
          ? row.canComplete
          : row.canEdit
        : "customer" in row
          ? mode !== "assignee" || row.canChangeAssignee
          : row.canEdit);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (write.busy || blocked || !permission) return;
    setError(null);
    const payload = body();
    if (!creating && Object.keys(payload).length === 1) {
      setError(new Error("변경할 내용을 입력해 주세요."));
      return;
    }
    try {
      await write.run(
        `${resource}:${row?.id ?? "new"}:${mode}`,
        payload,
        (signal, key) =>
          recordApi.write(
            resource,
            scope,
            row?.id,
            creating || editing ? "" : mode,
            payload,
            signal,
            key,
          ),
        true,
        row
          ? ["data", session.user.id, scope, resource, "detail", row.id]
          : undefined,
      );
      leave.saved();
      onSaved();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e : new Error(String(e)));
      if (e instanceof ApiError && e.status === 409) setLatest(undefined);
      if (e instanceof ApiError && [401, 403, 404].includes(e.status))
        setBlocked(true);
    }
  }
  async function refresh() {
    if (!row || write.busy) return;
    try {
      const current = await write.run(
        "compare",
        {},
        (signal) => recordApi.detail(resource, scope, row.id, signal),
        false,
      );
      setLatest(current);
      if (
        ("canEdit" in current &&
          !current.canEdit &&
          mode !== "inspection/complete") ||
        ("canComplete" in current &&
          mode === "inspection/complete" &&
          !current.canComplete) ||
        ("canChangeAssignee" in current &&
          mode === "assignee" &&
          !current.canChangeAssignee)
      )
        setBlocked(true);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(e as Error);
        if (e instanceof ApiError && [401, 403, 404].includes(e.status))
          setBlocked(true);
      }
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)}>
      {leave.guard}
      <fieldset
        disabled={write.busy || blocked || !permission}
        className="grid gap-4"
      >
        {creating && resource !== "notices" && (
          <Field label="지점">
            <select
              aria-label="지점"
              value={draft.branchId}
              required
              onChange={(e) => change("branchId", e.target.value)}
            >
              <option value="">지점을 선택하세요</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {(creating || editing) && resource === "facilities" && (
          <>
            {field("시설명", "name", true, "text", 120)}
            <Field label="시설 유형">
              <select
                aria-label="시설 유형"
                required
                value={draft.typeId ?? ""}
                disabled={!!types.error || types.isPending}
                onChange={(e) => change("typeId", e.target.value)}
              >
                <option value="">유형 선택</option>
                {types.data?.items.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · 기본 {t.defaultInspectionDays}일
                  </option>
                ))}
              </select>
            </Field>
            {session.user.owner && (
              <FacilityTypeCreate onCreated={() => void types.refetch()} />
            )}
            {types.error && (
              <ErrorState
                error={types.error}
                retry={() => void types.refetch()}
              />
            )}
            {field("위치", "location", false, "text", 200)}
            {field("설명", "description", false, "textarea", 20000)}
            {field(
              "점검 주기 (일)",
              "inspectionIntervalDays",
              editing,
              "number",
            )}
            {select("시설 상태", "status", statuses.facilities)}
            {assignee()}
            {editing ? (
              select("처리 상태", "workStatus", ["대기", "진행 중"])
            ) : (
              <>
                {field("마지막 점검일", "lastInspectedOn", false, "date")}
                {draft.lastInspectedOn &&
                  field(
                    "마지막 점검 결과",
                    "lastInspectionResult",
                    false,
                    "textarea",
                    5000,
                  )}
              </>
            )}
          </>
        )}
        {creating && resource === "inquiries" && (
          <>
            <InquiryCustomer
              key={branchId}
              branchId={branchId}
              value={draft.customerId ?? ""}
              onChange={(id) => change("customerId", id)}
            />
            {field("문의 제목", "subject", true, "text", 200)}
            {field("문의 내용", "body", true, "textarea", 20000)}
            {select("접수 경로", "source", ["방문", "전화", "기타"])}
            {select("상태", "status", ["접수", "처리 중"])}
            {assignee()}
          </>
        )}
        {(creating || editing) && resource === "notices" && (
          <>
            {field("공지 제목", "title", true, "text", 200)}
            {field("공지 내용", "body", true, "textarea", 20000)}
            {select(
              "공지 대상",
              "target",
              session.user.owner ? ["선택 지점", "전체"] : ["선택 지점"],
            )}
            {draft.target === "선택 지점" && (
              <fieldset>
                <legend>대상 지점</legend>
                {session.branches
                  .filter((b) => can(session.user, b.id, "notices:write"))
                  .map((b) => (
                    <label key={b.id} className="flex gap-2">
                      <input
                        type="checkbox"
                        checked={draft.branchIds.split(",").includes(b.id)}
                        onChange={(e) => {
                          const ids = new Set(
                            draft.branchIds.split(",").filter(Boolean),
                          );
                          if (e.target.checked) ids.add(b.id);
                          else ids.delete(b.id);
                          change("branchIds", [...ids].join(","));
                        }}
                      />
                      {b.name}
                    </label>
                  ))}
              </fieldset>
            )}
            <Field label="중요 고정">
              <input
                type="checkbox"
                checked={draft.pinned === "true"}
                onChange={(e) => change("pinned", String(e.target.checked))}
              />
            </Field>
            {creating &&
              select("게시 상태", "status", ["임시 저장", "게시 중"])}
          </>
        )}
        {mode === "inspection/complete" && (
          <>
            {field("점검 결과", "result", true, "textarea", 5000)}
            {field("실제 완료일", "completedOn", true, "date")}
            {select("점검 후 시설 상태", "facilityStatus", statuses.facilities)}
          </>
        )}
        {mode === "answer" &&
          field("답변 내용", "answer", true, "textarea", 20000)}
        {mode === "assignee" && assignee()}
        {mode === "status" &&
          select(
            "변경할 상태",
            "status",
            resource === "notices"
              ? [row?.status === "게시 중" ? "게시 종료" : "게시 중"]
              : ["접수", "처리 중"],
          )}
      </fieldset>
      {error && (
        <FieldError>
          {error.message}
          {error instanceof ApiError &&
            Object.entries(error.detail.fieldErrors ?? {}).map(([k, v]) => (
              <span className="block" key={k}>
                {k}: {v}
              </span>
            ))}
        </FieldError>
      )}
      {error instanceof ApiError && error.status === 409 && (
        <div className="my-4">
          <p>입력을 유지했습니다. 최신값과 비교한 뒤 다시 저장하세요.</p>
          <Button
            type="button"
            disabled={write.busy || blocked}
            onClick={() => void refresh()}
          >
            최신 내용 확인
          </Button>
        </div>
      )}
      {latest && (
        <section className="card p-4 my-4">
          <h3>최신 서버 내용 · 버전 {latest.version}</h3>
          <Details row={latest} />
        </section>
      )}
      {blocked && (
        <FieldError>
          접근 권한이 변경되었습니다. 화면을 새로고침해 주세요.
        </FieldError>
      )}
      <Button
        type="submit"
        variant="primary"
        className="mt-5"
        disabled={
          write.busy ||
          blocked ||
          !permission ||
          (error instanceof ApiError && error.status === 409 && !latest)
        }
      >
        {write.busy
          ? "저장 중…"
          : latest
            ? "최신 기준으로 다시 저장"
            : "저장하기"}
      </Button>
    </form>
  );
}
