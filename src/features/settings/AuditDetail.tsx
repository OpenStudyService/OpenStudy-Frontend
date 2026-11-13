import { ListColumnHeader } from "../../shared/ui/ListLayout";
import { useLocalTableSort } from "../../shared/ui/table-sort";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../../shared/api/client";
import { formatDateTime } from "../../shared/domain/format";
import { Button, ErrorState, Panel, State } from "../../shared/ui/primitives";
import {
  auditChanges,
  type AuditDetail as Detail,
  type AuditEvent,
} from "./audit-model";

export function auditRef(ref: AuditEvent["actor"], fallback: string) {
  return ref
    ? ref.name
      ? `${ref.name} (${ref.id})`
      : `알 수 없음 (${ref.id})`
    : fallback;
}

export function auditTarget(event: AuditEvent) {
  return event.entityId
    ? `${event.entityType} · ${event.entityId}`
    : event.entityType;
}

export function AuditReadError({
  error,
  retry,
}: {
  error: Error;
  retry: () => void;
}) {
  if (error instanceof ApiError && error.status === 403)
    return (
      <State
        title="변경 이력을 볼 권한이 없어요"
        message="OWNER만 변경 이력을 조회할 수 있습니다."
      />
    );
  if (error instanceof ApiError && error.status === 404)
    return <State title="감사 기록을 찾을 수 없어요" />;
  return <ErrorState error={error} retry={retry} />;
}

export function AuditDetailPanel({
  id,
  ownerId,
  onClose,
  onSameRequest,
}: {
  id: string;
  ownerId: string;
  onClose: () => void;
  onSameRequest: (event: Detail) => void;
}) {
  const detail = useQuery({
    queryKey: ["data", ownerId, "audit-events", "detail", id],
    queryFn: ({ signal }) =>
      api<Detail>(`/audit-events/${encodeURIComponent(id)}`, { signal }),
    enabled: !!id,
    retry: false,
    gcTime: 0,
  });
  return (
    <Panel open={!!id} onClose={onClose} title="변경 이력 상세">
      {detail.error ? (
        <AuditReadError
          error={detail.error}
          retry={() => void detail.refetch()}
        />
      ) : detail.data ? (
        <AuditEventDetail event={detail.data} onSameRequest={onSameRequest} />
      ) : (
        <State loading />
      )}
    </Panel>
  );
}

const changeLabels = {
  added: "추가",
  removed: "삭제",
  changed: "변경",
  same: "동일",
};
const changeStyles = {
  added: "font-semibold text-primary",
  removed: "font-semibold text-danger",
  changed: "font-semibold text-primary",
  same: "text-muted",
};

function SnapshotValue({ value }: { value: unknown }) {
  if (value === undefined) return <span aria-label="값 없음">—</span>;
  if (typeof value === "string")
    return (
      <span className="whitespace-pre-wrap break-all">{value || '""'}</span>
    );
  return (
    <pre className="whitespace-pre-wrap break-all">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function AuditEventDetail({
  event,
  onSameRequest,
}: {
  event: Detail;
  onSameRequest: (event: Detail) => void;
}) {
  const fields = [
    ["시각", formatDateTime(event.occurredAt)],
    ["행위", event.action],
    ["결과", event.result],
    ["대상", auditTarget(event)],
    ["작업자", auditRef(event.actor, "시스템 / 알 수 없음")],
    ["지점", auditRef(event.branch, "지점 없음 / 알 수 없음")],
    ["사유", event.reason ?? "—"],
    ["요청 ID", event.requestId ?? "—"],
  ];
  const changes = auditChanges(event.before, event.after);
  const sorting = useLocalTableSort<(typeof changes)[number]>([
    { label: "항목", value: (change) => change.path.join(" › ") },
    { label: "구분", value: (change) => changeLabels[change.kind] },
  ]);
  return (
    <div className="grid gap-4">
      <dl className="grid gap-2">
        {fields.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[6rem_minmax(0,1fr)]">
            <dt className="font-semibold">{label}</dt>
            <dd className="break-all">{value}</dd>
          </div>
        ))}
      </dl>
      {event.requestId && (
        <Button type="button" onClick={() => onSameRequest(event)}>
          같은 요청 보기
        </Button>
      )}
      <h3>변경 전후</h3>
      {changes.length ? (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                {sorting.columns.map((column) => (
                  <ListColumnHeader key={column.label} column={column} />
                ))}
                {event.before !== null && <th scope="col">변경 전</th>}
                {event.after !== null && <th scope="col">변경 후</th>}
              </tr>
            </thead>
            <tbody>
              {sorting.order(changes).map(({ path, kind, before, after }) => (
                <tr key={JSON.stringify(path)}>
                  <th scope="row" className="break-all">
                    {path.join(" › ") || "전체"}
                  </th>
                  <td className={changeStyles[kind]}>{changeLabels[kind]}</td>
                  {event.before !== null && (
                    <td>
                      <SnapshotValue value={before} />
                    </td>
                  )}
                  {event.after !== null && (
                    <td>
                      <SnapshotValue value={after} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="help">변경 전후 값이 없는 기록입니다.</p>
      )}
    </div>
  );
}
