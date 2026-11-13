import { useTableSort } from "../../shared/ui/table-sort";
import { readListPage } from "../../shared/api/read-sorted-pages";
import { ListColumnHeader } from "../../shared/ui/ListLayout";
import { hasBlockingReadError } from "../../shared/api/read-model";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { useApp } from "../../app/context";
import { can, won } from "../../shared/domain/schema";
import {
  Badge,
  Button,
  ErrorState,
  Heading,
  State,
} from "../../shared/ui/primitives";
import { Pager } from "../organization/shared";
import { lockerApi } from "./api";
import type { Locker } from "./model";
import { LockerPanel } from "./LockerPanel";
import { AssignmentPanel } from "./AssignmentPanel";

export function Lockers({ embedded = false }: { embedded?: boolean }) {
  const { session, scope } = useApp();
  return (
    <LockerWorkspace
      key={JSON.stringify([session.user, scope])}
      embedded={embedded}
    />
  );
}
function LockerWorkspace({ embedded }: { embedded: boolean }) {
  const { session, scope } = useApp(),
    [params, setParams] = useSearchParams();
  const raw = Number(params.get("page") || 1),
    page = Number.isSafeInteger(raw) && raw > 0 ? raw : 1;
  const sorting = useTableSort({ sort: "lockerNo", direction: "asc" });
  const assignmentState = params.get("assignmentState") || "";
  const change = (name: string, value: string) =>
    setParams((p) => {
      if (value) p.set(name, value);
      else p.delete(name);
      if (!["page", "detail", "assignment"].includes(name)) p.delete("page");
      return p;
    });
  const list = useQuery({
    queryKey: [
      "data",
      session.user.id,
      scope,
      "lockers",
      "list",
      page,
      assignmentState,
      params.get("sort"),
      sorting.value.direction,
    ],
    queryFn: ({ signal }) => {
      const value = params.has("sort")
        ? sorting.fallback({
            lockerNo: (r: Locker) => r.lockerNo,
            branch: (r: Locker) =>
              session.branches.find((b) => b.id === r.branchId)?.name ??
              r.branchId,
            rate: (r: Locker) => r.ratePer4WeeksKrw,
            status: (r: Locker) => r.status,
            assignment: (r: Locker) => r.assignmentState,
            customer: (r: Locker) => r.activeAssignment?.customer.name,
          })
        : undefined;
      return readListPage<Awaited<ReturnType<typeof lockerApi.lockers>>>(
        (page, pageSize) =>
          lockerApi.lockers(
            scope,
            {
              page,
              pageSize,
              assignmentState: assignmentState as Locker["assignmentState"],
            },
            signal,
          ),
        page,
        20,
        sorting.value.direction,
        value,
      );
    },
    retry: false,
  });
  const occupancy = useQuery({
    queryKey: ["data", session.user.id, scope, "lockers", "occupancy"],
    queryFn: ({ signal }) => lockerApi.occupancy(scope, signal),
    retry: false,
  });
  const management = session.branches.some(
    (b) =>
      (scope === "all" || scope === b.id) &&
      can(session.user, b.id, "operations:write"),
  );
  const close = () =>
    setParams((p) => {
      p.delete("detail");
      p.delete("assignment");
      return p;
    });
  return (
    <section className={embedded ? "" : "page"}>
      <Heading
        title="사물함 관리"
        description="사물함 운영과 4주 단위 유료 배정·연장·반납을 관리하세요."
      >
        {management && (
          <>
            <Button variant="primary" onClick={() => change("detail", "new")}>
              사물함 등록
            </Button>
            <Button onClick={() => change("detail", "rate")}>
              지점 요금 일괄 적용
            </Button>
          </>
        )}
      </Heading>
      {occupancy.isPending ? (
        <State loading title="점유 현황을 불러오고 있어요" />
      ) : !occupancy.data || hasBlockingReadError(occupancy) ? (
        <ErrorState
          error={occupancy.error!}
          retry={() => void occupancy.refetch()}
        />
      ) : (
        <div className="grid gap-3 mb-4" aria-label="사물함 점유 현황">
          {occupancy.data.items.map((b) => (
            <div className="card p-4" key={b.branchId}>
              <strong>
                {session.branches.find((x) => x.id === b.branchId)?.name ??
                  b.branchId}
              </strong>
              <p>
                전체 {b.total} · 사용 중 {b.inUse} · 사용 가능 {b.available} ·
                운영 중단 {b.blocked} · 미반납 만료 {b.overdue}
              </p>
            </div>
          ))}
        </div>
      )}
      <div className="card overflow-hidden">
        <div className="filters">
          <select
            aria-label="사물함 점유 상태 필터"
            value={assignmentState}
            onChange={(e) => change("assignmentState", e.target.value)}
          >
            <option value="">전체 점유 상태</option>
            <option>사용 가능</option>
            <option>사용 중</option>
            <option>운영 중단</option>
          </select>
        </div>
        {list.isPending ? (
          <State loading />
        ) : !list.data || hasBlockingReadError(list) ? (
          <ErrorState error={list.error!} retry={() => void list.refetch()} />
        ) : !list.data.items.length ? (
          <State title="등록된 사물함이 없어요" />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[650px]">
              <thead>
                <tr>
                  <ListColumnHeader
                    column={sorting.column("사물함 번호", "lockerNo")}
                  />
                  <ListColumnHeader column={sorting.column("지점", "branch")} />
                  <ListColumnHeader
                    column={sorting.column("4주 요금", "rate")}
                  />
                  <ListColumnHeader
                    column={sorting.column("운영 상태", "status")}
                  />
                  <ListColumnHeader
                    column={sorting.column("점유 상태", "assignment")}
                  />
                  <ListColumnHeader
                    column={sorting.column("현재 이용", "customer")}
                  />
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Button onClick={() => change("detail", r.id)}>
                        {r.lockerNo}
                      </Button>
                    </td>
                    <td>
                      {session.branches.find((b) => b.id === r.branchId)
                        ?.name ?? r.branchId}
                    </td>
                    <td>{won(r.ratePer4WeeksKrw)}</td>
                    <td>
                      <Badge>{r.status}</Badge>
                    </td>
                    <td>
                      <Badge>{r.assignmentState}</Badge>
                    </td>
                    <td>
                      {r.activeAssignment ? (
                        <>
                          {r.activeAssignment.customer.name} ·{" "}
                          {r.activeAssignment.startDate} ~{" "}
                          {r.activeAssignment.endDate}
                          {r.activeAssignment.overdue && (
                            <Badge>기간 만료·미반납</Badge>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.data && !hasBlockingReadError(list) && (
          <Pager
            page={list.data.meta.page}
            total={list.data.meta.total}
            onChange={(p) => change("page", String(p))}
          />
        )}
      </div>
      {params.get("assignment") ? (
        <AssignmentPanel
          key={params.get("assignment")}
          id={params.get("assignment")!}
          lockerId={params.get("detail") || ""}
          onClose={() => change("assignment", "")}
        />
      ) : (
        params.get("detail") && (
          <LockerPanel
            key={params.get("detail")}
            id={params.get("detail")!}
            onClose={close}
            onAssignment={(id) => change("assignment", id)}
          />
        )
      )}
    </section>
  );
}
