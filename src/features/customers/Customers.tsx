import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { useApp } from "../../app/context";
import { displayDate } from "../../shared/domain/schema";
import { isAccessError } from "../../shared/api/read-model";
import { MOCK } from "../../shared/api/client";
import {
  Badge,
  Button,
  ErrorState,
  Heading,
  State,
} from "../../shared/ui/primitives";
import { Icon } from "../../shared/ui/Icon";
import { customerApi } from "./api";
import {
  canCreateCustomer,
  customerStatuses,
  parseCustomerFilters,
} from "./model";
import { CustomerPanel } from "./CustomerPanel";

export function Customers({ embedded = false }: { embedded?: boolean }) {
  const { session, scope } = useApp(),
    [params, setParams] = useSearchParams();
  const filters = parseCustomerFilters(params);
  const rows = useQuery({
    queryKey: ["data", session.user.id, scope, "customers", "list", filters],
    queryFn: ({ signal }) => customerApi.list(scope, filters, signal),
    retry: false,
  });
  const creatable = session.branches.some(
    (branch) =>
      branch.status === "운영 중" &&
      (scope === "all" || scope === branch.id) &&
      canCreateCustomer(session.user, branch.id),
  );
  const page = rows.data?.meta.page ?? filters.page,
    pageSize = rows.data?.meta.pageSize ?? filters.pageSize,
    total = rows.data?.meta.total ?? 0;
  function filter(key: string, value: string) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value) next.set(key, value);
        else next.delete(key);
        next.delete("page");
        return next;
      },
      { replace: true },
    );
  }
  function show(id: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("detail", id);
      next.delete("edit");
      next.delete("action");
      return next;
    });
  }
  function close() {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete("detail");
      next.delete("edit");
      next.delete("action");
      return next;
    });
  }
  const create = creatable && (
    <Button variant="primary" onClick={() => show("new")}>
      <Icon name="plus" size={16} />
      회원 등록
    </Button>
  );
  return (
    <section className={embedded ? "" : "page"}>
      {embedded ? (
        <div className="mb-4 flex justify-end">{create}</div>
      ) : (
        <Heading
          title="회원 관리"
          description="회원 정보와 응대 내용을 확인하고 관리해요."
        >
          {create}
        </Heading>
      )}
      {MOCK && (
        <p className="help mb-4">
          데모 환경의 회원 정보 변경은 새로고침 후 초기화돼요.
        </p>
      )}
      <div className="card overflow-hidden">
        <div className="filters">
          <input
            type="search"
            aria-label="회원 검색"
            placeholder="이름·연락처·회원번호 검색"
            maxLength={100}
            value={filters.q}
            onChange={(event) => filter("q", event.target.value)}
          />
          <select
            aria-label="회원 상태 필터"
            value={filters.status}
            onChange={(event) => filter("status", event.target.value)}
          >
            <option value="">전체 상태</option>
            {customerStatuses.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
          <select
            aria-label="회원 정렬"
            value={filters.sort}
            onChange={(event) => filter("sort", event.target.value)}
          >
            <option value="registeredAt">등록일 순</option>
            <option value="name">이름 순</option>
          </select>
          <select
            aria-label="정렬 방향"
            value={filters.direction}
            onChange={(event) => filter("direction", event.target.value)}
          >
            <option value="desc">내림차순</option>
            <option value="asc">오름차순</option>
          </select>
          <select
            aria-label="페이지당 항목 수"
            value={filters.pageSize}
            onChange={(event) => filter("pageSize", event.target.value)}
          >
            {![10, 20, 50, 100].includes(filters.pageSize) && (
              <option value={filters.pageSize}>{filters.pageSize}개씩</option>
            )}
            {[10, 20, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}개씩
              </option>
            ))}
          </select>
          <Button
            variant="quiet"
            onClick={() =>
              setParams((previous) => {
                const next = new URLSearchParams(previous);
                [
                  "q",
                  "status",
                  "sort",
                  "direction",
                  "page",
                  "pageSize",
                ].forEach((key) => next.delete(key));
                return next;
              })
            }
          >
            초기화
          </Button>
        </div>
        <p className="px-5 pb-3 text-xs text-muted">
          이름은 일부 일치, 회원번호는 정확히 일치하며 연락처는 숫자 4자리
          이상으로 검색해 주세요.
        </p>
        <div className="data-scroll">
          <table className="data-table" aria-label="회원 목록">
            <thead>
              <tr>
                {[
                  "회원번호",
                  "회원 이름",
                  "연락처",
                  "상태",
                  "등록 지점",
                  "등록일",
                ].map((label) => (
                  <th key={label} scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.isPending || rows.error || !rows.data?.items.length ? (
                <tr>
                  <td colSpan={6}>
                    {rows.isPending ? (
                      <State loading />
                    ) : rows.error ? (
                      <ErrorState
                        error={rows.error}
                        retry={
                          isAccessError(rows.error)
                            ? undefined
                            : () => void rows.refetch()
                        }
                      />
                    ) : (
                      <State
                        title="등록된 항목이 없어요"
                        message="검색 조건을 바꾸거나 새로운 회원을 등록해 주세요."
                      />
                    )}
                  </td>
                </tr>
              ) : (
                rows.data.items.map((customer) => (
                  <tr key={customer.id}>
                    <td>{customer.memberNo}</td>
                    <td>
                      <button
                        className="cell-link"
                        onClick={() => show(customer.id)}
                      >
                        {customer.name}
                      </button>
                    </td>
                    <td>{customer.phone}</td>
                    <td>
                      <Badge>{customer.status}</Badge>
                    </td>
                    <td>
                      {customer.registeredBranchId
                        ? (session.branches.find(
                            (branch) =>
                              branch.id === customer.registeredBranchId,
                          )?.name ?? customer.registeredBranchId)
                        : "등록 지점 미지정"}
                    </td>
                    <td>{displayDate(customer.registeredAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-xs text-muted">
          <span>
            {rows.error
              ? "항목 수 확인 불가"
              : rows.isPending
                ? "항목 수 확인 중"
                : `총 ${total}건 · ${page}페이지`}
          </span>
          <div className="flex gap-2">
            <Button
              disabled={rows.isPending || !!rows.error || page <= 1}
              onClick={() => filterPage(page - 1)}
            >
              이전
            </Button>
            <Button
              disabled={
                rows.isPending || !!rows.error || page * pageSize >= total
              }
              onClick={() => filterPage(page + 1)}
            >
              다음
            </Button>
          </div>
        </footer>
      </div>
      {params.get("detail") && (
        <CustomerPanel id={params.get("detail")!} onClose={close} />
      )}
    </section>
  );
  function filterPage(value: number) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("page", String(value));
      return next;
    });
  }
}
