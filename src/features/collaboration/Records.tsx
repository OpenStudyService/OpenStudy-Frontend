import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { useApp } from "../../app/context";
import { can } from "../../shared/domain/schema";
import {
  Badge,
  Button,
  ErrorState,
  Heading,
  State,
} from "../../shared/ui/primitives";
import { DataNotice } from "../../shared/ui/DataNotice";
import { Pager } from "../organization/shared";
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
  const [refresh, setRefresh] = useState(0);
  const search = new URLSearchParams();
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
      refresh,
    ],
    queryFn: ({ signal }) =>
      recordApi.list(resource, scope, search.toString(), signal),
    retry: false,
  });
  const summary = useQuery({
    queryKey: ["data", session.user.id, scope, resource, "summary", q, refresh],
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
      >
        <Button onClick={() => setRefresh((v) => v + 1)}>새로고침</Button>
        {creatable && (
          <Button variant="primary" onClick={() => change("detail", "new")}>
            {titles[resource]} 등록
          </Button>
        )}
      </Heading>
      {resource !== "notices" && (
        <div className="mb-4" aria-label={`${titles[resource]} 집계`}>
          {summary.data && !summary.error ? (
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
              error={summary.error}
              retry={() => void summary.refetch()}
            />
          )}
        </div>
      )}
      <div className="card overflow-hidden">
        <div className="filters">
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
        </div>
        {rows.isPending ? (
          <State loading />
        ) : rows.error ? (
          <ErrorState error={rows.error} retry={() => void rows.refetch()} />
        ) : rows.data?.items.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-[640px]">
              <thead>
                <tr>
                  <th>제목</th>
                  <th>상태</th>
                  <th>
                    {resource === "facilities"
                      ? "처리 상태 · 담당자"
                      : resource === "inquiries"
                        ? "고객 · 담당자"
                        : "대상"}
                  </th>
                  <th>
                    {resource === "facilities" ? "다음 점검일" : "등록일"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.data.items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Button onClick={() => change("detail", row.id)}>
                        {"pinned" in row && row.pinned ? "중요 · " : ""}
                        {itemTitle(row)}
                      </Button>
                    </td>
                    <td>
                      <Badge>{row.status}</Badge>
                    </td>
                    <td>
                      {"openWork" in row
                        ? `${row.openWork.status} · ${row.openWork.assignee?.name ?? "미지정"}`
                        : "customer" in row
                          ? `${row.customer.name} · ${row.assignee?.name ?? "미지정"}`
                          : row.target === "전체"
                            ? "전체"
                            : row.branchIds
                                .map(
                                  (id) =>
                                    session.branches.find((b) => b.id === id)
                                      ?.name ?? id,
                                )
                                .join(", ")}
                    </td>
                    <td>
                      {"nextInspectionOn" in row
                        ? row.nextInspectionOn
                        : row.createdAt.slice(0, 10)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <State title="조회 결과가 없어요" />
        )}
        {rows.data && !rows.error && (
          <Pager
            page={rows.data.meta.page}
            total={rows.data.meta.total}
            onChange={(page) => change("page", String(page))}
          />
        )}
      </div>
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
