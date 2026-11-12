import { hasBlockingReadError } from "../../shared/api/read-model";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { Badge, Button, Heading } from "../../shared/ui/primitives";
import {
  ListCard,
  ListFilters,
  ListFooter,
  ListTable,
} from "../../shared/ui/ListLayout";
import { listPasses } from "./api";
import { passKinds, passStatuses } from "./model";
import type { PassFilters } from "./model";
import { PassPanel, passBalance } from "./PaymentPanels";
import {
  CustomerSelector,
  LIST_CUSTOMER_SELECTOR_CLASS,
  MockPaymentNotice,
  dateTime,
  useSalesSearch,
} from "./shared";

const PASS_FILTER_KEYS = [
  "status",
  "kind",
  "branchId",
  "sort",
  "direction",
  "customerId",
  "page",
];
const PAGE_SIZE = 20;

export function Passes({ embedded = false }: { embedded?: boolean }) {
  const { session, scope } = useApp();
  const { params, page, update, reset } = useSalesSearch();
  const branch = params.get("branchId") || "";
  const requestedScope =
    scope === "all" && session.branches.some((b) => b.id === branch)
      ? branch
      : scope;
  const filters: PassFilters = {
    scope: requestedScope,
    page,
    pageSize: PAGE_SIZE,
    customerId: params.get("customerId") || undefined,
    status: passStatuses.find((s) => s === params.get("status")),
    kind: passKinds.find((k) => k === params.get("kind")),
    sort: params.get("sort") === "expiresAt" ? "expiresAt" : "createdAt",
    direction: params.get("direction") === "asc" ? "asc" : "desc",
  };
  const passes = useQuery({
    queryKey: [
      "data",
      session.user.id,
      requestedScope,
      "passes",
      "list",
      filters,
    ],
    queryFn: ({ signal }) => listPasses(filters, signal),
    retry: false,
  });
  const detail = params.get("detail");
  return (
    <section className={embedded ? "" : "page"}>
      {!embedded && (
        <Heading
          title="보유 이용권"
          description="고객이 구매한 이용권의 잔량과 시작·만료 일시를 확인해요."
        />
      )}
      <MockPaymentNotice />
      <ListCard>
        <ListFilters>
          <select
            aria-label="이용권 상태 필터"
            value={filters.status ?? ""}
            onChange={(e) => update("status", e.target.value)}
          >
            <option value="">전체 상태</option>
            {passStatuses.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            aria-label="이용권 유형 필터"
            value={filters.kind ?? ""}
            onChange={(e) => update("kind", e.target.value)}
          >
            <option value="">전체 유형</option>
            {passKinds.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          {scope === "all" && (
            <select
              aria-label="구매 지점 필터"
              value={branch}
              onChange={(e) => update("branchId", e.target.value)}
            >
              <option value="">전체 지점</option>
              {session.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
          <select
            aria-label="이용권 정렬"
            value={filters.sort}
            onChange={(e) => update("sort", e.target.value)}
          >
            <option value="createdAt">발급일 순</option>
            <option value="expiresAt">만료일 순</option>
          </select>
          <select
            aria-label="이용권 정렬 방향"
            value={filters.direction}
            onChange={(e) => update("direction", e.target.value)}
          >
            <option value="desc">내림차순</option>
            <option value="asc">오름차순</option>
          </select>
          <Button variant="quiet" onClick={() => reset(PASS_FILTER_KEYS)}>
            초기화
          </Button>
        </ListFilters>
        <CustomerSelector
          className={LIST_CUSTOMER_SELECTOR_CLASS}
          value={filters.customerId ?? ""}
          onChange={(id) => update("customerId", id)}
          allowAll
        />
        <ListTable
          label="보유 이용권 목록"
          columns={[
            "고객",
            "이용권",
            "잔량·이용 기간",
            "시작 일시",
            "만료 일시",
            "상태",
          ]}
          loading={passes.isPending}
          error={hasBlockingReadError(passes) ? passes.error : null}
          onRetry={() => void passes.refetch()}
          isEmpty={!passes.data?.items.length}
          empty={{ title: "조건에 맞는 보유 이용권이 없어요" }}
        >
          {passes.data?.items.map((p) => (
            <tr key={p.id}>
              <td>
                <button
                  className="cell-link"
                  onClick={() => update("detail", p.id)}
                >
                  {p.customer.name}
                </button>
                <span className="help block">{p.customer.memberNo}</span>
              </td>
              <td>
                {p.productName}
                <span className="help block">{p.kind}</span>
              </td>
              <td>{passBalance(p)}</td>
              <td>{dateTime(p.startedAt)}</td>
              <td>{p.expiresAt ? dateTime(p.expiresAt) : "만료 없음"}</td>
              <td>
                <Badge>{p.status}</Badge>
              </td>
            </tr>
          ))}
        </ListTable>
        <ListFooter
          page={page}
          pageSize={PAGE_SIZE}
          total={passes.data?.meta.total ?? 0}
          loading={passes.isPending}
          error={!!passes.error}
          onChange={(value) => update("page", String(value))}
        />
      </ListCard>
      {detail && <PassPanel id={detail} onClose={() => update("detail", "")} />}
    </section>
  );
}
