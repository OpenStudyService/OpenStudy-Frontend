import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { can } from "../../shared/domain/schema";
import { Button, ErrorState, Panel, State } from "../../shared/ui/primitives";
import { recordApi, type Detail, type Resource } from "./api";
import { itemTitle, titles } from "./Records";
import { RecordForm } from "./RecordForm";
import { Pager } from "../organization/shared";

export function RecordDetail(props: {
  resource: Resource;
  id: string;
  onClose: () => void;
}) {
  const { session, scope } = useApp();
  const context = JSON.stringify([session.user, session.branches, scope]);
  return (
    <DetailSession
      key={`${props.resource}:${props.id}:${context}`}
      {...props}
    />
  );
}
function DetailSession({
  resource,
  id,
  onClose,
}: {
  resource: Resource;
  id: string;
  onClose: () => void;
}) {
  const { session, scope } = useApp();
  const [mode, setMode] = useState(id === "new" ? "create" : "");
  const row = useQuery({
    queryKey: ["data", session.user.id, scope, resource, "detail", id],
    queryFn: ({ signal }) => recordApi.detail(resource, scope, id, signal),
    enabled: id !== "new",
    retry: false,
  });
  const data = row.error ? undefined : row.data;
  const title =
    id === "new"
      ? `${titles[resource]} 등록`
      : data
        ? itemTitle(data)
        : `${titles[resource]} 상세`;
  const creatable = session.branches.some(
    (b) =>
      (scope === "all" || scope === b.id) &&
      (resource === "inquiries" ||
        can(
          session.user,
          b.id,
          resource === "facilities" ? "facilities:write" : "notices:write",
        )),
  );
  return (
    <Panel open title={title} onClose={onClose}>
      {id === "new" && !creatable ? (
        <State title="등록 권한이 없어요" />
      ) : id === "new" ? (
        <RecordForm resource={resource} mode="create" onSaved={onClose} />
      ) : row.isPending ? (
        <State loading />
      ) : row.error ? (
        <ErrorState error={row.error} retry={() => void row.refetch()} />
      ) : (
        data && (
          <>
            {mode ? (
              <RecordForm
                key={mode}
                resource={resource}
                row={data}
                mode={mode}
                onSaved={() => {
                  setMode("");
                  void row.refetch();
                }}
              />
            ) : (
              <>
                <Details row={data} />
                <div className="mt-6 flex flex-wrap gap-2">
                  {"canEdit" in data && data.canEdit && (
                    <Button onClick={() => setMode("edit")}>수정하기</Button>
                  )}
                  {"canComplete" in data && data.canComplete && (
                    <Button onClick={() => setMode("inspection/complete")}>
                      점검 완료
                    </Button>
                  )}
                  {"customer" in data && (
                    <>
                      <Button onClick={() => setMode("answer")}>
                        답변하기
                      </Button>
                      <Button onClick={() => setMode("status")}>
                        처리 상태 변경
                      </Button>
                      {data.canChangeAssignee && (
                        <Button onClick={() => setMode("assignee")}>
                          담당자 변경
                        </Button>
                      )}
                    </>
                  )}
                  {"pinned" in data && data.canEdit && (
                    <Button onClick={() => setMode("status")}>
                      {data.status === "게시 중" ? "게시 종료" : "게시하기"}
                    </Button>
                  )}
                </div>
                {"customer" in data && <History id={id} />}
              </>
            )}
            {mode && (
              <Button className="mt-3" onClick={() => setMode("")}>
                취소
              </Button>
            )}
          </>
        )
      )}
    </Panel>
  );
}
export function Details({ row }: { row: Detail }) {
  const { session } = useApp();
  const branchName = (id: string) =>
    session.branches.find((b) => b.id === id)?.name ?? id;
  const values =
    "openWork" in row
      ? [
          ["지점", branchName(row.branchId)],
          ["시설명", row.name],
          ["시설 상태", row.status],
          ["처리 상태", row.openWork.status],
          ["담당자", row.openWork.assignee?.name ?? "미지정"],
          ["유형", row.type.name],
          ["위치", row.location],
          ["설명", row.description],
          ["점검 주기", `${row.inspectionIntervalDays}일`],
          ["마지막 점검일", row.lastInspectedOn],
          ["다음 점검일", row.nextInspectionOn],
          ["마지막 점검 결과", row.lastInspection?.result],
        ]
      : "customer" in row
        ? [
            ["지점", branchName(row.branchId)],
            ["고객", `${row.customer.name} · ${row.customer.memberNo}`],
            ["문의 제목", row.subject],
            ["접수 경로", row.source],
            ["상태", row.status],
            ["담당자", row.assignee?.name ?? "미지정"],
            ["내용", row.body],
            ["답변", row.answer],
            ["답변자", row.answeredBy?.name],
            ["답변 시각", row.answeredAt],
          ]
        : [
            ["공지 제목", row.title],
            ["대상 지점", row.branchIds.map(branchName).join(", ") || "전체"],
            ["내용", row.body],
            ["상태", row.status],
            ["대상", row.target],
            ["중요 고정", row.pinned ? "고정" : "일반"],
            ["게시 시각", row.publishedAt],
          ];
  return (
    <dl className="grid gap-4">
      {values.map(([label, v]) => (
        <div key={label}>
          <dt className="text-muted">{label}</dt>
          <dd className="whitespace-pre-wrap break-words">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
function History({ id }: { id: string }) {
  const { session, scope } = useApp(),
    [page, setPage] = useState(1);
  const result = useQuery({
    queryKey: ["data", session.user.id, scope, "inquiries", "events", id, page],
    queryFn: ({ signal }) => recordApi.events(scope, id, page, signal),
    retry: false,
  });
  return (
    <section className="mt-6">
      <h3>처리 이력</h3>
      {result.isPending ? (
        <State loading />
      ) : result.error ? (
        <ErrorState error={result.error} retry={() => void result.refetch()} />
      ) : (
        <>
          {result.data.items.map((e) => (
            <p key={e.id} className="whitespace-pre-wrap">
              {e.at} · {e.actor.name} · {e.oldStatus ?? "등록"} → {e.newStatus}{" "}
              · {e.message}
            </p>
          ))}
          <Pager
            page={page}
            total={result.data.meta.total}
            onChange={setPage}
          />
        </>
      )}
    </section>
  );
}
