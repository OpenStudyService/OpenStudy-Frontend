import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { Tabs } from "radix-ui";
import { api, MOCK, queryString } from "../../shared/api/client";
import { useIdempotency } from "../../shared/api/useIdempotency";
import { asPage, isAccessError } from "../../shared/api/read-model";
import { DataNotice } from "../../shared/ui/DataNotice";
import {
  admin,
  businessDate,
  can,
  displayDate,
  text,
  value,
  won,
} from "../../shared/domain/schema";
import type {
  Employee,
  Entity,
  LookupData,
  Membership,
  Resource,
  ResourceMap,
} from "../../shared/domain/schema";
import { catalog, labels } from "../../shared/domain/catalog";
import { commandFields } from "../../shared/domain/commands";
import { useApp } from "../../app/context";
import { useUi } from "../../app/store";
import {
  Badge,
  Button,
  ErrorState,
  FieldError,
  Heading,
  Panel,
  State,
} from "../../shared/ui/primitives";
import { Icon } from "../../shared/ui/Icon";
import { ResourceForm } from "./ResourceForm";
import { WeekSchedule } from "../attendance/WeekSchedule";
import { Tasks } from "../tasks/Tasks";
import { TaskPanel } from "../tasks/TaskPanel";
import { ChannelManagement } from "../chat/ChannelManagement";
import { Customers } from "../customers/Customers";
import { CustomerPanel } from "../customers/CustomerPanel";

export function format(
  row: Entity,
  key: string,
  lookups: LookupData,
  asOf: string,
): string {
  const raw = value(row, key);
  if (raw === undefined || raw === null || raw === "") return "—";
  const refs: Record<string, keyof LookupData> = {
    branchId: "branches",
    employeeId: "employees",
    assigneeId: "employees",
    authorId: "employees",
    actorId: "employees",
    substituteId: "employees",
    memberId: "members",
    roomId: "rooms",
    seatId: "seats",
    productId: "products",
    passId: "passes",
  };
  if (refs[key]) {
    if (raw === "all") return "전체 지점";
    const target = (lookups[refs[key]] as Entity[]).find((x) => x.id === raw);
    return target ? text(target, "name") || text(target, "title") : String(raw);
  }
  if (key === "memberships")
    return (raw as Membership[])
      .map(
        (m) =>
          `${lookups.branches.find((b) => b.id === m.branchId)?.name || m.branchId} · ${m.role === "admin" ? "관리자" : "직원"}`,
      )
      .join(" / ");
  if (key === "pinned") return raw ? "중요" : "일반";
  if (key === "participantIds")
    return (raw as string[])
      .map((id) => lookups.employees.find((e) => e.id === id)?.name || id)
      .join(", ");
  if (key === "remaining") {
    const kind = text(row, "kind");
    return kind === "시간권"
      ? `${Math.floor(Number(raw) / 60)}시간 ${Number(raw) % 60}분`
      : kind === "기간권"
        ? `${Math.max(0, Math.ceil((Date.parse(text(row, "expiresAt")) - Date.parse(asOf)) / 86400000))}일`
        : won(Number(raw));
  }
  if (["hourlyRate", "amount"].includes(key) && !("employeeId" in row))
    return won(Number(raw));
  if (
    [
      "createdAt",
      "updatedAt",
      "startsAt",
      "endsAt",
      "startedAt",
      "endedAt",
      "expiresAt",
      "approvedAt",
    ].includes(key)
  )
    return displayDate(String(raw));
  if (Array.isArray(raw)) return JSON.stringify(raw);
  return String(raw);
}
function editable(user: Employee, resource: Resource, branch: string) {
  const def = catalog[resource];
  if (!def) return false;
  if (resource === "branches" && !user.owner) return false;
  if (def.admin && !admin(user, branch)) return false;
  return !def.permission || can(user, branch, def.permission);
}
function availableActions(
  resource: Resource,
  row: Entity,
  user: Employee,
): string[] {
  const status = text(row, "status"),
    isAdmin =
      resource === "employees"
        ? user.owner ||
          (row as Employee).memberships.some((m) => admin(user, m.branchId))
        : admin(user, row.branchId),
    own = text(row, "employeeId") === user.id;
  if (resource === "payments")
    return isAdmin && status === "승인" ? ["refund"] : [];
  if (resource === "passes")
    return isAdmin && status !== "환불" ? ["adjust"] : [];
  if (resource === "members") return ["history"];
  if (resource === "seats")
    return editable(user, resource, row.branchId)
      ? status === "이용 가능"
        ? ["assign"]
        : status === "이용 중"
          ? ["move", "checkout"]
          : []
      : [];
  if (resource === "lockers")
    return editable(user, resource, row.branchId)
      ? status === "이용 가능"
        ? ["assign"]
        : ["사용 중", "기간 만료"].includes(status)
          ? ["extend", "return"]
          : []
      : [];
  if (resource === "reservations")
    return editable(user, resource, row.branchId)
      ? status === "예약 확정"
        ? ["start", "cancel", "reschedule"]
        : status === "이용 중"
          ? ["finish"]
          : []
      : [];
  if (resource === "facilities")
    return editable(user, resource, row.branchId) ? ["inspect"] : [];
  if (resource === "attendance")
    return own
      ? status === "근무 중"
        ? ["break", "clockout"]
        : status === "휴게 중"
          ? ["resume"]
          : []
      : [];
  if (["corrections", "leaveRequests", "substitutions"].includes(resource))
    return [
      ...(isAdmin && status === "신청" ? ["approve", "reject"] : []),
      ...((own && status === "신청") ||
      (isAdmin &&
        ["신청", "승인"].includes(status) &&
        resource !== "corrections")
        ? ["cancel"]
        : []),
    ];
  if (resource === "invitations")
    return isAdmin
      ? status === "초대 대기"
        ? ["reissue", "cancel"]
        : status === "승인 대기"
          ? ["approve", "reject"]
          : []
      : [];
  if (resource === "employees") return isAdmin ? ["permissions"] : [];
  return [];
}
export function ResourcePage(props: {
  resource: Resource;
  embedded?: boolean;
}) {
  return props.resource === "members" ? (
    <Customers embedded={props.embedded} />
  ) : props.resource === "channels" ? (
    <ChannelManagement embedded={props.embedded} />
  ) : props.resource === "tasks" ? (
    <Tasks />
  ) : (
    <GenericResourcePage {...props} />
  );
}
function GenericResourcePage({
  resource,
  embedded = false,
}: {
  resource: Resource;
  embedded?: boolean;
}) {
  const { session, scope, lookups } = useApp(),
    user = session.user,
    query = useQueryClient(),
    toast = useUi((s) => s.toast),
    [params, setParams] = useSearchParams();
  const view =
    params.get("view") ||
    (resource === "seats"
      ? "map"
      : resource === "shifts"
        ? "week"
        : resource === "reservations"
          ? "calendar"
          : "list");
  const setView = (next: string) =>
    setParams((p) => {
      p.set("view", next);
      p.delete("page");
      return p;
    });
  const def = catalog[resource]!;
  const idempotency = useIdempotency();
  const detail = params.get("detail") || "",
    formOpen = detail === "new",
    rowId = formOpen ? "" : detail;
  const requestParams = new URLSearchParams(params);
  ["detail", "edit", "action", "thread", "tab"].forEach((k) =>
    requestParams.delete(k),
  );
  requestParams.set("scope", scope);
  const data = useQuery({
    queryKey: ["data", user.id, scope, resource, requestParams.toString()],
    queryFn: async ({ signal }) =>
      asPage<Entity>(
        await api<unknown>(`/${resource}?${requestParams}`, { signal }),
      ),
    retry: false,
  });
  const selection = useQuery({
    queryKey: ["data", user.id, scope, resource, "detail", rowId],
    queryFn: ({ signal }) =>
      api<Entity>(`/${resource}/${rowId}?scope=${scope}`, { signal }),
    enabled: !!rowId,
    retry: false,
  });
  function search(key: string, v: string) {
    setParams(
      (p) => {
        if (v) p.set(key, v);
        else p.delete(key);
        p.delete("page");
        return p;
      },
      { replace: true },
    );
  }
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
  const page = data.data?.page || 1,
    total = data.data?.total || 0;
  async function save(values: Record<string, unknown>) {
    const payload = {
      ...values,
      ...(!formOpen ? { version: selection.data?.version } : {}),
    };
    const result = await api<Entity>(
      `/${resource}${formOpen ? "" : `/${rowId}`}`,
      {
        method: formOpen ? "POST" : "PATCH",
        body: payload,
        key: idempotency.key(`${resource}/${rowId}`, payload),
      },
    );
    idempotency.committed();
    await query.invalidateQueries({ queryKey: ["data"] });
    if (resource === "employees" || resource === "branches")
      await query.invalidateQueries({ queryKey: ["session"] });
    toast(
      text(result, "status") === "실패"
        ? "결제 승인이 실패했어요. 조건을 확인한 뒤 새 결제를 등록해 주세요."
        : `${def.singular} ${formOpen ? "등록" : "수정"}을 완료했어요.`,
    );
    close();
  }
  const fields = def.fields
    .filter((f) => f.key !== "simulateFailure" || MOCK)
    .map((f) =>
      ["notices"].includes(resource) && f.key === "branchId" && user.owner
        ? { ...f, options: ["all"] }
        : f,
    );
  return (
    <section className={embedded ? "" : "page"}>
      {!embedded && (
        <Heading title={def.title} description={def.description}>
          {def.create && editable(user, resource, scope) && (
            <Button variant="primary" onClick={() => show("new")}>
              <Icon name="plus" size={16} />
              {def.singular} 등록
            </Button>
          )}
        </Heading>
      )}
      {embedded && def.create && editable(user, resource, scope) && (
        <div className="mb-4 flex justify-end">
          <Button variant="primary" onClick={() => show("new")}>
            <Icon name="plus" size={16} />
            {def.singular} 등록
          </Button>
        </div>
      )}
      <div className="card">
        <div className="filters">
          <div className="relative">
            <Icon
              name="search"
              className="absolute top-3 left-3 text-muted"
              size={16}
            />
            <input
              type="search"
              aria-label={`${def.singular} 검색`}
              placeholder="검색어를 입력해 주세요"
              className="pl-9"
              value={params.get("q") || ""}
              onChange={(e) => search("q", e.target.value)}
            />
          </div>
          <select
            aria-label="상태 필터"
            value={params.get("status") || ""}
            onChange={(e) => search("status", e.target.value)}
          >
            <option value="">전체 상태</option>
            {(
              def.fields.find((f) => f.key === "status")?.options || [
                ...new Set(
                  data.data?.items
                    .map((r) => text(r, "status"))
                    .filter(Boolean),
                ),
              ]
            ).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          {["reservations", "attendance", "shifts"].includes(resource) && (
            <input
              type="date"
              aria-label="날짜 필터"
              value={params.get("date") || ""}
              onChange={(e) => search("date", e.target.value)}
            />
          )}
          <select
            aria-label="정렬"
            value={params.get("sort") || "createdAt"}
            onChange={(e) => search("sort", e.target.value)}
          >
            <option value="createdAt">등록일 순</option>
            <option value="name">이름 순</option>
            <option value="status">상태 순</option>
          </select>
          <Button
            variant="quiet"
            onClick={() => {
              setParams((p) => {
                [
                  "q",
                  "status",
                  "date",
                  "sort",
                  "assigneeId",
                  "mine",
                  "page",
                ].forEach((k) => p.delete(k));
                return p;
              });
            }}
          >
            초기화
          </Button>
          {resource === "reservations" && (
            <div className="ml-auto flex gap-1">
              <Button
                onClick={() => setView("calendar")}
                aria-pressed={view === "calendar"}
              >
                달력
              </Button>
              <Button
                onClick={() => setView("list")}
                aria-pressed={view === "list"}
              >
                목록
              </Button>
            </div>
          )}
          {resource === "seats" && (
            <div className="ml-auto flex gap-1">
              <Button
                onClick={() => setView("map")}
                aria-pressed={view === "map"}
              >
                배치도
              </Button>
              <Button
                onClick={() => setView("list")}
                aria-pressed={view === "list"}
              >
                목록
              </Button>
            </div>
          )}
          {resource === "shifts" && (
            <div className="ml-auto flex gap-1">
              <Button
                onClick={() => setView("week")}
                aria-pressed={view === "week"}
              >
                주간 근무표
              </Button>
              <Button
                onClick={() => setView("list")}
                aria-pressed={view === "list"}
              >
                목록
              </Button>
            </div>
          )}
        </div>
        {resource === "seats" && view === "map" ? (
          <SeatMap scope={scope} onSelect={show} />
        ) : resource === "reservations" && view === "calendar" ? (
          <ReservationCalendar onSelect={show} />
        ) : resource === "shifts" && view === "week" ? (
          <WeekSchedule onSelect={show} />
        ) : (
          <div className="data-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  {def.columns.map((c) => (
                    <th key={c} scope="col">
                      {labels[c] || c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.isPending || data.error || !data.data?.items.length ? (
                  <tr>
                    <td colSpan={def.columns.length}>
                      {isAccessError(data.error) ? (
                        <ErrorState error={data.error!} />
                      ) : (
                        <>
                          <DataNotice
                            label={`${def.title} 데이터`}
                            loading={data.isPending}
                            error={data.error}
                            retry={() => void data.refetch()}
                          />
                          {!data.isPending && !data.error && (
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
                  data.data.items.map((row) => (
                    <tr key={row.id}>
                      {def.columns.map((c, i) => (
                        <td key={c}>
                          {i === 0 ? (
                            <button
                              className="cell-link"
                              onClick={() => show(row.id)}
                            >
                              {format(row, c, lookups, session.asOf)}
                            </button>
                          ) : ["status", "priority", "condition"].includes(
                              c,
                            ) ? (
                            <Badge>
                              {format(row, c, lookups, session.asOf)}
                            </Badge>
                          ) : (
                            format(row, c, lookups, session.asOf)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-xs text-muted">
          <span>
            {data.error
              ? "항목 수 확인 불가"
              : data.isPending
                ? "항목 수 확인 중"
                : `총 ${total}건 · ${page}페이지`}
          </span>
          <div className="flex gap-2">
            <Button
              onClick={() =>
                setParams((p) => {
                  p.set("page", String(page - 1));
                  return p;
                })
              }
              disabled={page <= 1}
            >
              이전
            </Button>
            <Button
              onClick={() =>
                setParams((p) => {
                  p.set("page", String(page + 1));
                  return p;
                })
              }
              disabled={page * 10 >= total}
            >
              다음
            </Button>
          </div>
        </footer>
      </div>
      <Panel
        open={formOpen}
        onClose={close}
        title={`${def.singular} 등록`}
        description={def.description}
      >
        {formOpen && (
          <ResourceForm
            fields={fields}
            scope={scope}
            lookups={lookups}
            label={`${def.singular} 등록`}
            onSubmit={save}
          />
        )}
      </Panel>
      {!!rowId && (
        <RecordPanel
          resource={resource}
          id={rowId}
          onClose={close}
          onReschedule={() => show("new")}
        />
      )}
    </section>
  );
}

export function RecordPanel(props: {
  resource: Resource;
  id: string;
  onClose: () => void;
  onReschedule?: () => void;
}) {
  return props.resource === "members" ? (
    <CustomerPanel id={props.id} onClose={props.onClose} />
  ) : props.resource === "tasks" ? (
    <TaskPanel id={props.id} onClose={props.onClose} />
  ) : (
    <GenericRecordPanel {...props} />
  );
}
function GenericRecordPanel({
  resource,
  id,
  onClose,
  onReschedule,
}: {
  resource: Resource;
  id: string;
  onClose: () => void;
  onReschedule?: () => void;
}) {
  const { session, scope, lookups } = useApp(),
    user = session.user,
    query = useQueryClient(),
    toast = useUi((s) => s.toast),
    [params, setParams] = useSearchParams();
  const row = useQuery({
    queryKey: ["data", user.id, scope, resource, "detail", id],
    queryFn: ({ signal }) =>
      api<Entity>(`/${resource}/${id}?scope=${scope}`, { signal }),
    retry: false,
  });
  const [error, setError] = useState(""),
    [history, setHistory] = useState<Record<string, Entity[]> | null>(null);
  const idempotency = useIdempotency();
  const def = catalog[resource]!,
    editing = params.get("edit") === "1",
    action = params.get("action") || "";
  const mutation = useMutation({
    mutationFn: ({
      key,
      body,
    }: {
      key: string;
      body: Record<string, unknown>;
    }) =>
      api<unknown>(`/${resource}/${id}/${key}?scope=${scope}`, {
        method: "POST",
        body: { ...body, version: row.data?.version },
        key: idempotency.key(`${resource}/${id}/${key}`, {
          ...body,
          version: row.data?.version,
        }),
      }),
    onSuccess: async () => {
      idempotency.committed();
      await query.invalidateQueries({ queryKey: ["data"] });
      if (resource === "employees" || resource === "invitations")
        await query.invalidateQueries({ queryKey: ["session"] });
      toast("처리 결과를 저장했어요.");
    },
    onError: (e) => setError(e.message),
  });
  function setMode(key: string, v: string) {
    setError("");
    setParams((p) => {
      if (v) p.set(key, v);
      else p.delete(key);
      return p;
    });
  }
  async function perform(key: string, body: Record<string, unknown>) {
    setError("");
    if (key === "history") {
      try {
        setHistory(
          await api<Record<string, Entity[]>>(`/members/${id}/history`),
        );
      } catch (e) {
        setError((e as Error).message);
      }
      return;
    }
    if (key === "reschedule") {
      await mutation.mutateAsync({ key: "cancel", body });
      onReschedule?.();
      return;
    }
    await mutation.mutateAsync({ key, body });
    setMode("action", "");
  }
  async function save(body: Record<string, unknown>) {
    await api(`/${resource}/${id}`, {
      method: "PATCH",
      body: { ...body, version: row.data!.version },
      key: crypto.randomUUID(),
    });
    await query.invalidateQueries({ queryKey: ["data"] });
    if (resource === "employees")
      await query.invalidateQueries({ queryKey: ["session"] });
    toast("변경 내용을 저장했어요.");
    setMode("edit", "");
  }
  const r = row.data,
    allowed = r ? availableActions(resource, r, user) : [];
  const actionLabel =
    def.actions?.find((a) => a.key === action)?.label ||
    (action === "permissions" ? "지점·권한 설정" : "작업 확인");
  const commandForm = r ? commandFields(resource, action, r) : [];
  const fields = def.fields.filter(
    (f) => f.key !== "simulateFailure" && f.key !== "branchId",
  );
  return (
    <Panel
      open
      onClose={onClose}
      title={
        editing
          ? `${def.singular} 수정`
          : action
            ? actionLabel
            : r
              ? text(r, "title") || text(r, "name") || `${def.singular} 상세`
              : `${def.singular} 상세`
      }
      description={def.description}
    >
      {row.isPending ? (
        <State loading />
      ) : row.error ? (
        <ErrorState error={row.error} retry={() => void row.refetch()} />
      ) : (
        r && (
          <>
            {error && (
              <div className="mb-4">
                <FieldError>{error}</FieldError>
              </div>
            )}
            {editing ? (
              <ResourceForm
                key={`edit-${id}`}
                fields={fields}
                row={r}
                scope={r.branchId}
                lookups={lookups}
                onSubmit={save}
              />
            ) : action && allowed.includes(action) ? (
              action === "permissions" ? (
                <PermissionsEditor
                  row={r as ResourceMap["employees"]}
                  onSubmit={(memberships) => perform(action, { memberships })}
                />
              ) : (
                <>
                  <p className="tip mb-5">
                    {actionLabel} 작업을 진행합니다. 처리 결과는 관련 목록과
                    집계에 함께 반영돼요.
                  </p>
                  <ResourceForm
                    key={`${id}-${action}`}
                    fields={commandForm}
                    scope={r.branchId}
                    lookups={lookups}
                    defaults={{
                      remaining: value(r, "remaining"),
                      expiresAt: value(r, "expiresAt"),
                      refundBranchId: r.branchId,
                      condition: value(r, "condition"),
                    }}
                    label={actionLabel}
                    onSubmit={(data) => perform(action, data)}
                  />
                </>
              )
            ) : (
              <>
                <div className="mb-5 flex flex-wrap items-center gap-2">
                  {"status" in r && <Badge>{text(r, "status")}</Badge>}
                  <span className="ml-auto text-[10px] text-muted">
                    버전 {r.version} · {displayDate(r.updatedAt)}
                  </span>
                </div>
                <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-4 gap-y-4 text-xs">
                  {[
                    ...new Set([
                      ...def.columns,
                      ...def.fields.map((f) => f.key),
                    ]),
                  ]
                    .filter(
                      (k) =>
                        !["checks", "simulateFailure", "memberships"].includes(
                          k,
                        ),
                    )
                    .map((k) => (
                      <div className="contents" key={k}>
                        <dt className="text-muted">
                          {labels[k] ||
                            def.fields.find((f) => f.key === k)?.label ||
                            k}
                        </dt>
                        <dd className="m-0 min-w-0 whitespace-pre-wrap break-words leading-6">
                          {format(r, k, lookups, session.asOf)}
                        </dd>
                      </div>
                    ))}
                </dl>
                {resource === "lockers" &&
                  (r as ResourceMap["lockers"]).history.map((h, i) => (
                    <p className="help mt-3" key={i}>
                      {h}
                    </p>
                  ))}
                {resource === "corrections" && (
                  <div className="tip mt-4">
                    <b>정정 전 원본</b>
                    <pre className="overflow-auto text-[10px]">
                      {JSON.stringify(
                        JSON.parse(text(r, "original") || "{}"),
                        null,
                        2,
                      )}
                    </pre>
                  </div>
                )}
                {resource === "invitations" &&
                  MOCK &&
                  text(r, "status") === "초대 대기" && (
                    <div className="tip mt-5">
                      <b>이메일 발송 시뮬레이션</b>
                      <p>
                        실제 이메일은 전송되지 않습니다. 초대 수락 화면을 이
                        링크로 확인할 수 있어요.
                      </p>
                      <a
                        className="mt-2 block break-all underline"
                        href={`/invitations/accept?token=${encodeURIComponent(text(r, "token"))}`}
                      >
                        초대 수락 화면 열기
                      </a>
                    </div>
                  )}
                {resource === "employees" && (
                  <div className="mt-5 grid gap-2">
                    {(r as ResourceMap["employees"]).memberships.map((m) => (
                      <div className="tip" key={m.branchId}>
                        <b>
                          {
                            lookups.branches.find((b) => b.id === m.branchId)
                              ?.name
                          }{" "}
                          · {m.role === "admin" ? "관리자" : "직원"}
                        </b>
                        <p>
                          {m.permissions.join(", ") || "기본 협업·조회 권한"}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                {history && (
                  <div className="mt-6 border-t border-line pt-5">
                    <h3>해당 고객의 전 지점 이용 이력</h3>
                    <p className="help">
                      응대 고객에 한정한 조회이며 접근 이력이 기록됩니다.
                    </p>
                    {Object.entries(history).map(([kind, items]) => (
                      <div key={kind} className="mt-4">
                        <b className="text-xs">
                          {catalog[kind as Resource]?.title || kind}
                        </b>
                        {items.length ? (
                          items.map((item) => (
                            <div
                              key={item.id}
                              className="help border-b border-line py-2"
                            >
                              {format(item, "branchId", lookups, session.asOf)}{" "}
                              · {text(item, "name") || text(item, "status")} ·{" "}
                              {displayDate(item.createdAt)}
                            </div>
                          ))
                        ) : (
                          <p className="help">표시할 이력이 없습니다.</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-7 flex flex-wrap gap-2 border-t border-line pt-5">
                  {def.edit && editable(user, resource, r.branchId) && (
                    <Button onClick={() => setMode("edit", "1")}>
                      수정하기
                    </Button>
                  )}
                  {allowed.map((key) => {
                    const a = def.actions?.find((a) => a.key === key) || {
                      key,
                      label: key === "permissions" ? "지점·권한 설정" : key,
                    };
                    return (
                      <Button
                        key={key}
                        variant={a.danger ? "danger" : ""}
                        disabled={mutation.isPending}
                        onClick={() => {
                          if (key === "history") void perform(key, {});
                          else setMode("action", key);
                        }}
                      >
                        {a.label}
                      </Button>
                    );
                  })}
                </div>
              </>
            )}
            {(editing || action) && (
              <Button
                variant="quiet"
                className="mt-3"
                onClick={() =>
                  setParams((p) => {
                    p.delete("edit");
                    p.delete("action");
                    return p;
                  })
                }
              >
                상세로 돌아가기
              </Button>
            )}
          </>
        )
      )}
    </Panel>
  );
}
function PermissionsEditor({
  row,
  onSubmit,
}: {
  row: ResourceMap["employees"];
  onSubmit: (m: Membership[]) => Promise<void>;
}) {
  const { lookups, session } = useApp(),
    [memberships, setMemberships] = useState<Membership[]>(row.memberships),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const permissionLabels: Record<string, string> = {
    "members:write": "회원 변경",
    "operations:write": "운영 데이터 변경",
    "payments:read": "결제 조회",
    "payments:write": "결제 등록",
    "sales:read": "매출 조회",
    "facilities:write": "시설 처리",
    "notices:write": "공지 작성",
    "people:manage": "인력 관리",
    "ai:read": "AI 조회",
  };
  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        void onSubmit(memberships)
          .catch((e) => setError(e.message))
          .finally(() => setBusy(false));
      }}
    >
      <p className="tip">
        환불·초대·권한 변경·승인은 관리자 전용입니다. 일반 직원의 협업 기능은
        기본 허용됩니다.
      </p>
      {lookups.branches
        .filter((b) => admin(session.user, b.id))
        .map((b) => {
          const m = memberships.find((m) => m.branchId === b.id);
          return (
            <section className="card p-4" key={b.id}>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!m}
                  onChange={(e) =>
                    setMemberships((old) =>
                      e.target.checked
                        ? [
                            ...old,
                            { branchId: b.id, role: "staff", permissions: [] },
                          ]
                        : old.filter((m) => m.branchId !== b.id),
                    )
                  }
                />
                {b.name} 소속
              </label>
              {m && (
                <>
                  <label className="field mt-4">
                    역할
                    <select
                      value={m.role}
                      onChange={(e) =>
                        setMemberships((old) =>
                          old.map((x) =>
                            x.branchId === b.id
                              ? {
                                  ...x,
                                  role: e.target.value as Membership["role"],
                                }
                              : x,
                          ),
                        )
                      }
                    >
                      <option value="staff">일반 직원</option>
                      <option value="admin">지점 관리자</option>
                    </select>
                  </label>
                  {m.role === "staff" && (
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      {Object.entries(permissionLabels).map(([key, label]) => (
                        <label
                          key={key}
                          className="flex items-center gap-2 font-normal"
                        >
                          <input
                            type="checkbox"
                            checked={m.permissions.includes(
                              key as Membership["permissions"][number],
                            )}
                            onChange={(e) =>
                              setMemberships((old) =>
                                old.map((x) =>
                                  x.branchId === b.id
                                    ? {
                                        ...x,
                                        permissions: e.target.checked
                                          ? [
                                              ...x.permissions,
                                              key as Membership["permissions"][number],
                                            ]
                                          : x.permissions.filter(
                                              (p) => p !== key,
                                            ),
                                      }
                                    : x,
                                ),
                              )
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  )}
                </>
              )}
            </section>
          );
        })}
      {error && <FieldError>{error}</FieldError>}
      <Button variant="primary" disabled={busy}>
        권한 저장
      </Button>
    </form>
  );
}
function SeatMap({
  scope,
  onSelect,
}: {
  scope: string;
  onSelect: (id: string) => void;
}) {
  const { session, lookups } = useApp(),
    [zone, setZone] = useState("전체");
  const data = useQuery({
    queryKey: ["data", session.user.id, scope, "seats", "map"],
    queryFn: async ({ signal }) =>
      asPage<ResourceMap["seats"]>(
        await api<unknown>(`/seats?${queryString({ scope, pageSize: 100 })}`, {
          signal,
        }),
      ),
    retry: false,
  });
  if (isAccessError(data.error)) return <ErrorState error={data.error!} />;
  const seats = data.data?.items || [];
  return (
    <>
      <DataNotice
        label="좌석 정보"
        loading={data.isPending}
        error={data.error}
        retry={() => void data.refetch()}
      />
      <div className="flex gap-2 px-5 pt-4">
        {["전체", "집중존", "라운지"].map((z) => (
          <Button
            key={z}
            variant={z === zone ? "primary" : ""}
            onClick={() => setZone(z)}
          >
            {z}
          </Button>
        ))}
      </div>
      {!data.isPending && !data.error && !seats.length && (
        <State title="등록된 좌석이 없어요" />
      )}
      {lookups.branches
        .filter((b) => scope === "all" || b.id === scope)
        .map((b) => (
          <div key={b.id}>
            <h3 className="px-5 pt-5">{b.name}</h3>
            <div className="data-scroll">
              <div className="seat-grid">
                {seats
                  .filter(
                    (s) =>
                      s.branchId === b.id &&
                      (zone === "전체" || s.zone === zone),
                  )
                  .map((s) => (
                    <button
                      key={s.id}
                      className={`seat ${s.status === "이용 중" ? "occupied" : s.status === "사용 불가" ? "unavailable" : ""}`}
                      onClick={() => onSelect(s.id)}
                    >
                      <b>{s.name}</b>
                      <small className="text-inherit">{s.status}</small>
                    </button>
                  ))}
              </div>
            </div>
          </div>
        ))}
    </>
  );
}
function ReservationCalendar({ onSelect }: { onSelect: (id: string) => void }) {
  const { session, scope, lookups } = useApp(),
    [params, setParams] = useSearchParams();
  const month = params.get("month") || businessDate(session.asOf).slice(0, 7);
  const data = useQuery({
    queryKey: [
      "data",
      session.user.id,
      scope,
      "reservations",
      "calendar",
      month,
    ],
    queryFn: async ({ signal }) =>
      asPage<ResourceMap["reservations"]>(
        await api<unknown>(
          `/reservations?${queryString({ scope, pageSize: 100, from: month + "-01", to: month + "-31" })}`,
          { signal },
        ),
      ),
    retry: false,
  });
  const [year, mon] = month.split("-").map(Number),
    offset = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay(),
    days = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return (
    <>
      <div className="flex items-center gap-3 p-4">
        <label htmlFor="calendar-month">표시 월</label>
        <input
          id="calendar-month"
          type="month"
          value={month}
          onChange={(e) => {
            if (e.target.value)
              setParams((p) => {
                p.set("month", e.target.value);
                return p;
              });
          }}
        />
        <small>스터디룸만 사전 예약</small>
      </div>
      <div className="data-scroll">
        <div className="calendar">
          {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
            <div
              className="border-b border-line p-3 text-center text-xs text-muted"
              key={d}
            >
              {d}
            </div>
          ))}
          {Array.from({ length: offset + days }, (_, i) => {
            const d = i - offset + 1,
              date = `${month}-${String(d).padStart(2, "0")}`;
            return (
              <div className="calendar-day" key={i}>
                {d > 0 && (
                  <>
                    <small>{d}</small>
                    {data.data?.items
                      .filter((r) => businessDate(r.startsAt) === date)
                      .map((r) => (
                        <button
                          className="calendar-item"
                          onClick={() => onSelect(r.id)}
                          key={r.id}
                        >
                          {displayDate(r.startsAt).split(" ").slice(-1)}{" "}
                          {lookups.rooms.find((x) => x.id === r.roomId)?.name} ·{" "}
                          {r.status}
                        </button>
                      ))}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <DataNotice
        label="예약 정보"
        loading={data.isPending}
        error={data.error}
        retry={() => void data.refetch()}
      />
      {!data.isPending && !data.error && !data.data?.items.length && (
        <State title="등록된 예약이 없어요" />
      )}
    </>
  );
}
export function ResourceGroup({
  title,
  description,
  tabs,
  intro,
}: {
  title: string;
  description: string;
  tabs: { resource: Resource; label: string; admin?: boolean }[];
  intro?: ReactNode;
}) {
  const { session, scope } = useApp(),
    [params, setParams] = useSearchParams();
  const visible = tabs.filter((t) => !t.admin || admin(session.user, scope)),
    selected =
      visible.find((t) => t.resource === params.get("tab")) || visible[0];
  useEffect(() => {
    if (
      params.get("tab") &&
      !visible.some((t) => t.resource === params.get("tab"))
    )
      setParams(
        (p) => {
          p.delete("tab");
          p.delete("detail");
          return p;
        },
        { replace: true },
      );
  }, [params, setParams, visible]);
  if (!selected)
    return (
      <State
        title="이 메뉴에 접근할 권한이 없어요"
        message="관리자에게 현재 지점의 권한을 확인해 주세요."
      />
    );
  return (
    <div className="page">
      <Heading title={title} description={description} />
      {intro}
      <Tabs.Root
        value={selected.resource}
        onValueChange={(value) => setParams({ tab: value })}
      >
        <Tabs.List className="tabs" aria-label={title}>
          {visible.map((t) => (
            <Tabs.Trigger
              key={t.resource}
              value={t.resource}
              className={`tab ${selected.resource === t.resource ? "active" : ""}`}
            >
              {t.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value={selected.resource}>
          <ResourcePage
            key={selected.resource}
            resource={selected.resource}
            embedded
          />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
