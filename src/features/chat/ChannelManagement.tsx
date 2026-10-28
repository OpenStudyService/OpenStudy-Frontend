import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { useApp } from "../../app/context";
import { ApiError } from "../../shared/api/client";
import type { ResourceMap } from "../../shared/domain/schema";
import {
  Button,
  ErrorState,
  FieldError,
  Heading,
  Panel,
  State,
} from "../../shared/ui/primitives";
import {
  useTaskLeaveGuard,
  useTaskWrite as useChannelWrite,
} from "../tasks/hooks";
import { chatApi } from "./api";
import { canManageChannel } from "./model";

type ManagedChannel = ResourceMap["channels"];
export function ChannelManagement({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const { session, scope, lookups } = useApp(),
    [params, setParams] = useSearchParams();
  const allowed =
    canManageChannel(session.user, "all") ||
    session.branches.some(
      (b) =>
        canManageChannel(session.user, b.id) &&
        (scope === "all" || scope === b.id),
    );
  const rows = useQuery({
    queryKey: ["data", session.user.id, scope, "chat", "managed"],
    queryFn: ({ signal }) => chatApi.managed(scope, signal),
    enabled: allowed,
    retry: false,
  });
  const id = params.get("detail"),
    channel = rows.data?.items.find((c) => c.id === id);
  const close = () =>
    setParams((p) => {
      p.delete("detail");
      p.delete("edit");
      p.delete("action");
      return p;
    });
  const show = (id: string) =>
    setParams((p) => {
      p.set("detail", id);
      return p;
    });
  const context = JSON.stringify([
    session.user.id,
    scope,
    session.user.owner,
    session.user.status,
    session.user.memberships,
  ]);
  if (!allowed) return <State title="채널 관리 권한이 없어요" />;
  const create = (
    <Button variant="primary" onClick={() => show("new")}>
      채널 등록
    </Button>
  );
  return (
    <section className={embedded ? "" : "page"}>
      {!embedded ? (
        <Heading
          title="채널 관리"
          description="지점별 업무 대화와 참여 동료를 관리해요."
        >
          {create}
        </Heading>
      ) : (
        <div className="mb-4 flex justify-end">{create}</div>
      )}
      <div className="card data-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {["채널 이름", "지점", "채널 설명", "참여 직원"].map((t) => (
                <th scope="col" key={t}>
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.isPending ? (
              <tr>
                <td colSpan={4}>
                  <State loading />
                </td>
              </tr>
            ) : rows.error ? (
              <tr>
                <td colSpan={4}>
                  <ErrorState
                    error={rows.error}
                    retry={() => void rows.refetch()}
                  />
                </td>
              </tr>
            ) : (
              rows.data?.items
                .filter((c) => canManageChannel(session.user, c.branchId))
                .map((c) => (
                  <tr key={c.id}>
                    <td>
                      <button className="cell-link" onClick={() => show(c.id)}>
                        {c.name}
                      </button>
                    </td>
                    <td>
                      {c.branchId === "all"
                        ? "전체 지점"
                        : (session.branches.find((b) => b.id === c.branchId)
                            ?.name ?? c.branchId)}
                    </td>
                    <td>{c.description}</td>
                    <td>
                      {c.participantIds
                        .map(
                          (id) =>
                            lookups.employees.find((p) => p.id === id)?.name ??
                            (session.user.id === id ? session.user.name : id),
                        )
                        .join(", ")}
                    </td>
                  </tr>
                ))
            )}
            {rows.isSuccess && !rows.data.items.length && (
              <tr>
                <td colSpan={4}>
                  <State title="등록된 채널이 없어요" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {id && (
        <Panel
          open
          title={id === "new" ? "채널 등록" : "채널 수정"}
          description="채널 정보와 참여 직원을 선택해 주세요."
          onClose={close}
        >
          {id === "new" ||
          (channel && canManageChannel(session.user, channel.branchId)) ? (
            <ChannelEditor
              key={`${id}:${context}`}
              channel={channel}
              onSaved={close}
            />
          ) : rows.isPending ? (
            <State loading />
          ) : (
            <State title="채널을 찾을 수 없거나 관리할 권한이 없어요" />
          )}
        </Panel>
      )}
    </section>
  );
}
function ChannelEditor({
  channel,
  onSaved,
}: {
  channel?: ManagedChannel;
  onSaved: () => void;
}) {
  const { session, scope } = useApp(),
    client = useQueryClient(),
    write = useChannelWrite();
  const [base] = useState(channel),
    [initial] = useState(() => ({
      branchId: channel?.branchId ?? (scope === "all" ? "" : scope),
      name: channel?.name ?? "",
      description: channel?.description ?? "",
      participantIds: channel?.participantIds ?? ([] as string[]),
    }));
  const [draft, setDraft] = useState(initial),
    [error, setError] = useState<Error | null>(null),
    [fields, setFields] = useState<Record<string, string>>({}),
    [conflict, setConflict] = useState(false),
    [latest, setLatest] = useState<ManagedChannel | null>(null);
  const candidates = useQuery({
    queryKey: [
      "data",
      session.user.id,
      scope,
      "chat",
      "candidates",
      draft.branchId,
    ],
    queryFn: ({ signal }) => chatApi.candidates(draft.branchId, signal),
    enabled: !!draft.branchId,
    retry: false,
  });
  const leave = useTaskLeaveGuard(
    JSON.stringify(initial) !== JSON.stringify(draft),
  );
  const denied =
    error instanceof ApiError &&
    [401, 403].includes(error.status) &&
    error.detail.code !== "CSRF_INVALID";
  async function refresh() {
    try {
      const value = await write.run(
        "channel-latest",
        {},
        (signal) => chatApi.channel(base!.id, scope, signal),
        false,
      );
      setLatest(value);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        setError(e as Error);
    }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (write.busy || denied || (conflict && !latest)) return;
    const invalid: Record<string, string> = {};
    if (!draft.name.trim()) invalid.name = "채널 이름을 입력해 주세요.";
    if (!canManageChannel(session.user, draft.branchId) || !draft.branchId)
      invalid.branchId = "관리 가능한 지점을 선택해 주세요.";
    if (
      !draft.participantIds.length ||
      draft.participantIds.some(
        (id) => !candidates.data?.some((p) => p.id === id),
      )
    )
      invalid.participantIds = "선택 지점의 활성 직원을 선택해 주세요.";
    setFields(invalid);
    if (Object.keys(invalid).length) return;
    const values = { ...draft, name: draft.name.trim() };
    const payload = base
      ? {
          ...Object.fromEntries(
            Object.entries(values).filter(
              ([key, value]) =>
                key !== "branchId" &&
                JSON.stringify(value) !==
                  JSON.stringify(initial[key as keyof typeof initial]),
            ),
          ),
          version: latest?.version ?? base.version,
        }
      : values;
    try {
      await write.run(`channel/${base?.id ?? "new"}`, payload, (signal, key) =>
        chatApi.saveChannel(base?.id, payload, signal, key),
      );
      leave.saved();
      void client.invalidateQueries({ queryKey: ["data", session.user.id] });
      onSaved();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e as Error);
      setLatest(null);
      if (e instanceof ApiError) {
        setFields(e.detail.fieldErrors ?? {});
        if (e.status === 409) setConflict(true);
      }
    }
  }
  return (
    <form className="form-grid" noValidate onSubmit={save}>
      {leave.guard}
      <label className="field">
        <span>지점</span>
        <select
          aria-label="지점"
          value={draft.branchId}
          disabled={!!base || write.busy}
          onChange={(e) =>
            setDraft((d) => ({
              ...d,
              branchId: e.target.value,
              participantIds: [],
            }))
          }
        >
          <option value="">선택해 주세요</option>
          {session.user.owner && <option value="all">전체 지점</option>}
          {session.branches
            .filter((b) => canManageChannel(session.user, b.id))
            .map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
        </select>
        {fields.branchId && <FieldError>{fields.branchId}</FieldError>}
      </label>
      <label className="field">
        <span>채널 이름</span>
        <input
          aria-label="채널 이름"
          value={draft.name}
          disabled={write.busy}
          aria-invalid={!!fields.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        />
        {fields.name && <FieldError>{fields.name}</FieldError>}
      </label>
      <label className="field">
        <span>채널 설명</span>
        <textarea
          aria-label="채널 설명"
          value={draft.description}
          disabled={write.busy}
          onChange={(e) =>
            setDraft((d) => ({ ...d, description: e.target.value }))
          }
        />
      </label>
      <label className="field">
        <span>참여 직원</span>
        <select
          multiple
          aria-label="참여 직원"
          value={draft.participantIds}
          disabled={
            write.busy ||
            !draft.branchId ||
            candidates.isPending ||
            !!candidates.error
          }
          onChange={(e) =>
            setDraft((d) => ({
              ...d,
              participantIds: [...e.target.selectedOptions].map((o) => o.value),
            }))
          }
        >
          {candidates.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {fields.participantIds && (
          <FieldError>{fields.participantIds}</FieldError>
        )}
      </label>
      {draft.branchId && candidates.isPending && (
        <p role="status">참여 직원을 확인하고 있어요.</p>
      )}
      {candidates.error && (
        <ErrorState
          error={candidates.error}
          retry={() => void candidates.refetch()}
        />
      )}
      {candidates.isSuccess && !candidates.data.length && (
        <p className="help">활성 직원 정보를 확인할 수 없어요.</p>
      )}
      {error && <FieldError>{error.message}</FieldError>}
      {conflict && (
        <>
          <p>입력은 유지했어요. 최신 채널과 비교한 뒤 다시 저장해 주세요.</p>
          <Button
            type="button"
            disabled={write.busy}
            onClick={() => void refresh()}
          >
            최신 내용 확인
          </Button>
          {latest && (
            <section role="status">
              <h3>최신 채널 · 버전 {latest.version}</h3>
              <p>{latest.name}</p>
              <p>{latest.description}</p>
              <p>
                참여 직원:{" "}
                {latest.participantIds
                  .map(
                    (id) =>
                      candidates.data?.find((p) => p.id === id)?.name ?? id,
                  )
                  .join(", ")}
              </p>
            </section>
          )}
        </>
      )}
      <Button
        type="submit"
        variant="primary"
        disabled={
          write.busy ||
          denied ||
          candidates.isPending ||
          !!candidates.error ||
          (conflict && !latest)
        }
      >
        {write.busy
          ? "처리 중…"
          : base
            ? latest
              ? "최신 기준으로 다시 저장"
              : "저장하기"
            : "채널 등록"}
      </Button>
    </form>
  );
}
