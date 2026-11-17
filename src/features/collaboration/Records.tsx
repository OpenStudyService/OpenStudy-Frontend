import { readListPage } from "../../shared/api/read-sorted-pages";
import {
  ListCard,
  ListFilters,
  ListFooter,
  ListTable,
} from "../../shared/ui/ListLayout";
import { Icon } from "../../shared/ui/Icon";
import { useTableSort } from "../../shared/ui/table-sort";
import { hasBlockingReadError } from "../../shared/api/read-model";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { useApp } from "../../app/context";
import { can } from "../../shared/domain/schema";
import { Badge, Button, Heading } from "../../shared/ui/primitives";
import { DataNotice } from "../../shared/ui/DataNotice";
import { recordApi, type Resource, type Item } from "./api";
import { RecordDetail } from "./RecordDetail";

export const titles = {
  facilities: "시설 점검",
  inquiries: "고객 문의",
  notices: "공지",
};
export const statuses = {
  facilities: ["정상", "점검 필요", "고장", "사용 중지"],
  inquiries: ["접수", "처리 중", "답변 완료"],
  notices: ["임시 저장", "게시 중", "게시 종료"],
};
export function itemTitle(row: Item) {
  return "name" in row ? row.name : "subject" in row ? row.subject : row.title;
}
export function Records({
  resource,
  embedded = false,
}: {
  resource: Resource;
  embedded?: boolean;
}) {
  const { session, scope } = useApp(),
    [params, setParams] = useSearchParams();
  const sorting = useTableSort(
    {
      sort: resource === "facilities" ? "nextInspectionOn" : "createdAt",
      direction: resource === "facilities" ? "asc" : "desc",
    },
    resource,
    "page",
  );
  const assigneeOrTarget = (row: Item) =>
    "openWork" in row
      ? `${row.openWork.status} · ${row.openWork.assignee?.name ?? "미지정"}`
      : "customer" in row
        ? `${row.customer.name} · ${row.assignee?.name ?? "미지정"}`
        : row.target === "전체"
          ? "전체"
          : row.branchIds
              .map(
                (id) => session.branches.find((b) => b.id === id)?.name ?? id,
              )
              .join(", ");
  const clientSort = sorting.fallback({
    title: itemTitle,
    status: (row: Item) => row.status,
    target: assigneeOrTarget,
    noticeDate: (row: Item) => Date.parse(row.createdAt),
  });
  const search = new URLSearchParams();
  if (resource !== "notices" && !clientSort) {
    search.set("sort", sorting.value.sort);
    search.set("direction", sorting.value.direction);
  }
  for (const key of ["q", "status", "page"])
    if (params.get(key)) search.set(key, params.get(key)!);
  const q = params.get("q") ?? "",
    status = params.get("status") ?? "";
  const rows = useQuery({
    queryKey: [
      "data",
      session.user.id,
      scope,
      resource,
      "list",
      search.toString(),
      sorting.value,
    ],
    queryFn: ({ signal }) =>
      readListPage<Awaited<ReturnType<typeof recordApi.list>>>(
        (page, pageSize) => {
          if (!clientSort)
            return recordApi.list(resource, scope, search.toString(), signal);
          const batch = new URLSearchParams(search);
          batch.set("page", String(page));
          batch.set("pageSize", String(pageSize));
          return recordApi.list(resource, scope, batch.toString(), signal);
        },
        Number(search.get("page") || 1),
        20,
        sorting.value.direction,
        clientSort,
      ),
    retry: false,
  });
  const summary = useQuery({
    queryKey: ["data", session.user.id, scope, resource, "summary", q],
    queryFn: ({ signal }) =>
      recordApi.summary(
        resource as "facilities" | "inquiries",
        scope,
        q,
        signal,
      ),
    enabled: resource !== "notices",
    retry: false,
  });
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
  const change = (key: string, v: string) =>
    setParams((p) => {
      if (v) p.set(key, v);
      else p.delete(key);
      if (key !== "page") p.delete("page");
      return p;
    });
  const close = () =>
    setParams((p) => {
      p.delete("detail");
      p.delete("edit");
      p.delete("action");
      return p;
    });
  return (
    <section className={embedded ? "" : "page"}>
      <Heading
        title={resource === "facilities" ? "시설 관리" : titles[resource]}
        description="지점의 운영 정보를 확인하고 처리하세요."
      />
      {resource !== "notices" && (
        <div className="mb-4" aria-label={`${titles[resource]} 집계`}>
          {summary.data && !hasBlockingReadError(summary) ? (
            <>
              <span>전체 {summary.data.totals.total}건 · </span>
              <span>
                {resource === "facilities"
                  ? `점검 필요 ${summary.data.totals.inspectionDue}`
                  : `미처리 ${summary.data.totals.unresolved}`}
                건
              </span>
            </>
          ) : (
            <DataNotice
              label="집계"
              loading={summary.isPending}
              error={summary.error!}
              retry={() => void summary.refetch()}
            />
          )}
        </div>
      )}
      <ListCard>
        <ListFilters
          actions={
            creatable && (
              <Button variant="primary" onClick={() => change("detail", "new")}>
                <Icon name="plus" size={16} />
                {titles[resource]} 등록
              </Button>
            )
          }
        >
          <input
            type="search"
            aria-label={`${titles[resource]} 검색`}
            placeholder="검색"
            value={q}
            onChange={(e) => change("q", e.target.value)}
          />
          <select
            aria-label="상태 필터"
            value={status}
            onChange={(e) => change("status", e.target.value)}
          >
            <option value="">전체 상태</option>
            {statuses[resource].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </ListFilters>
        <ListTable
          label={`${titles[resource]} 목록`}
          columns={[
            resource === "facilities"
              ? sorting.column("제목", "name")
              : sorting.column("제목", "title"),
            sorting.column("상태", "status"),
            sorting.column(
              resource === "facilities"
                ? "처리 상태 · 담당자"
                : resource === "inquiries"
                  ? "고객 · 담당자"
                  : "대상",
              "target",
            ),
            resource === "facilities"
              ? sorting.column("다음 점검일", "nextInspectionOn")
              : resource === "inquiries"
                ? sorting.column("등록일", "createdAt", "desc")
                : sorting.column("등록일", "noticeDate", "desc"),
          ]}
          loading={rows.isPending}
          error={hasBlockingReadError(rows) ? rows.error : null}
          onRetry={() => void rows.refetch()}
          isEmpty={!rows.data?.items.length}
          empty={{ title: "조회 결과가 없어요" }}
        >
          {rows.data?.items.map((row) => (
            <tr key={row.id}>
              <td>
                <button
                  type="button"
                  className="cell-link"
                  onClick={() => change("detail", row.id)}
                >
                  {"pinned" in row && row.pinned ? "중요 · " : ""}
                  {itemTitle(row)}
                </button>
              </td>
              <td>
                <Badge>{row.status}</Badge>
              </td>
              <td>{assigneeOrTarget(row)}</td>
              <td>
                {"nextInspectionOn" in row
                  ? row.nextInspectionOn
                  : row.createdAt.slice(0, 10)}
              </td>
            </tr>
          ))}
        </ListTable>
        <ListFooter
          page={rows.data?.meta.page ?? Number(search.get("page") || 1)}
          pageSize={rows.data?.meta.pageSize ?? 20}
          total={rows.data?.meta.total ?? 0}
          loading={rows.isPending}
          error={hasBlockingReadError(rows)}
          onChange={(page) => change("page", String(page))}
        />
      </ListCard>
      {params.get("detail") && (
        <RecordDetail
          resource={resource}
          id={params.get("detail")!}
          onClose={close}
        />
      )}
    </section>
  );
}
