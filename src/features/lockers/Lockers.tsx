import { useTableSort } from "../../shared/ui/table-sort";
import { readListPage } from "../../shared/api/read-sorted-pages";
import {
  ListCard,
  ListFilters,
  ListFooter,
  ListTable,
} from "../../shared/ui/ListLayout";
import { Icon } from "../../shared/ui/Icon";
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
      />
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
      <ListCard>
        <ListFilters
          actions={
            management && (
              <>
                <Button onClick={() => change("detail", "rate")}>
                  지점 요금 일괄 적용
                </Button>
                <Button
                  variant="primary"
                  onClick={() => change("detail", "new")}
                >
                  <Icon name="plus" size={16} />
                  사물함 등록
                </Button>
              </>
            )
          }
        >
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
        </ListFilters>
        <ListTable
          label="사물함 목록"
          columns={[
            sorting.column("사물함 번호", "lockerNo"),
            sorting.column("지점", "branch"),
            sorting.column("4주 요금", "rate"),
            sorting.column("운영 상태", "status"),
            sorting.column("점유 상태", "assignment"),
            sorting.column("현재 이용", "customer"),
          ]}
          loading={list.isPending}
          error={!list.data || hasBlockingReadError(list) ? list.error : null}
          onRetry={() => void list.refetch()}
          isEmpty={!list.data?.items.length}
          empty={{ title: "등록된 사물함이 없어요" }}
        >
          {list.data?.items.map((r) => (
            <tr
              key={r.id}
              className="cursor-pointer hover:bg-canvas"
              onClick={(event) => {
                event.currentTarget.cells[0]
                  .querySelector("button")
                  ?.focus({ preventScroll: true });
                change("detail", r.id);
              }}
            >
              <td>
                <button type="button" className="cell-link">
                  {r.lockerNo}
                </button>
              </td>
              <td>
                {session.branches.find((b) => b.id === r.branchId)?.name ??
                  r.branchId}
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
        </ListTable>
        <ListFooter
          page={list.data?.meta.page ?? page}
          pageSize={list.data?.meta.pageSize ?? 20}
          total={list.data?.meta.total ?? 0}
          loading={list.isPending}
          error={!!list.error}
          onChange={(p) => change("page", String(p))}
        />
      </ListCard>
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
