import { useQuery } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import {
  Badge,
  Button,
  ErrorState,
  Heading,
  State,
} from "../../shared/ui/primitives";
import { Field } from "../organization/shared";
import { listPasses } from "./api";
import { passKinds, passStatuses } from "./model";
import type { PassFilters } from "./model";
import { PassPanel, passBalance } from "./PaymentPanels";
import {
  CustomerSelector,
  MockPaymentNotice,
  SalesPager,
  dateTime,
  useSalesSearch,
} from "./shared";

export function Passes({ embedded = false }: { embedded?: boolean }) {
  const { session, scope } = useApp();
  const { params, page, update } = useSalesSearch();
  const branch = params.get("branchId") || "";
  const requestedScope =
    scope === "all" && session.branches.some((b) => b.id === branch)
      ? branch
      : scope;
  const filters: PassFilters = {
    scope: requestedScope,
    page,
    pageSize: 20,
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
      <CustomerSelector
        value={filters.customerId ?? ""}
        onChange={(id) => update("customerId", id)}
        allowAll
      />
      <div className="grid gap-3 sm:grid-cols-4 my-4">
        <Field label="이용권 상태 필터">
          <select
            value={filters.status ?? ""}
            onChange={(e) => update("status", e.target.value)}
          >
            <option value="">전체 상태</option>
            {passStatuses.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="이용권 유형 필터">
          <select
            value={filters.kind ?? ""}
            onChange={(e) => update("kind", e.target.value)}
          >
            <option value="">전체 유형</option>
            {passKinds.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        {scope === "all" && (
          <Field label="구매 지점 필터">
            <select
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
          </Field>
        )}
        <Field label="이용권 정렬">
          <select
            value={filters.sort}
            onChange={(e) => update("sort", e.target.value)}
          >
            <option value="createdAt">발급일</option>
            <option value="expiresAt">만료일</option>
          </select>
        </Field>
        <Field label="이용권 정렬 방향">
          <select
            value={filters.direction}
            onChange={(e) => update("direction", e.target.value)}
          >
            <option value="desc">내림차순</option>
            <option value="asc">오름차순</option>
          </select>
        </Field>
      </div>
      {passes.isPending ? (
        <State loading />
      ) : passes.error ? (
        <ErrorState error={passes.error} retry={() => void passes.refetch()} />
      ) : (
        passes.data && (
          <>
            {!passes.data.items.length ? (
              <State title="조건에 맞는 보유 이용권이 없어요" />
            ) : (
              <div className="data-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>고객</th>
                      <th>이용권</th>
                      <th>잔량·이용 기간</th>
                      <th>시작 일시</th>
                      <th>만료 일시</th>
                      <th>상태</th>
                      <th>상세</th>
                    </tr>
                  </thead>
                  <tbody>
                    {passes.data.items.map((p) => (
                      <tr key={p.id}>
                        <td>
                          {p.customer.name}
                          <span className="help block">
                            {p.customer.memberNo}
                          </span>
                        </td>
                        <td>
                          {p.productName}
                          <span className="help block">{p.kind}</span>
                        </td>
                        <td>{passBalance(p)}</td>
                        <td>{dateTime(p.startedAt)}</td>
                        <td>
                          {p.expiresAt ? dateTime(p.expiresAt) : "만료 없음"}
                        </td>
                        <td>
                          <Badge>{p.status}</Badge>
                        </td>
                        <td>
                          <Button onClick={() => update("detail", p.id)}>
                            이용권 상세: {p.id}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <SalesPager
              page={page}
              total={passes.data.meta.total}
              onChange={(value) => update("page", String(value))}
            />
          </>
        )
      )}
      {detail && <PassPanel id={detail} onClose={() => update("detail", "")} />}
    </section>
  );
}
