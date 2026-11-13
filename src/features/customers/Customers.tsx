import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { useApp } from "../../app/context";
import { formatPhone } from "../../shared/domain/format";
import { displayDate } from "../../shared/domain/schema";
import {
  hasBlockingReadError,
  isAccessError,
} from "../../shared/api/read-model";
import { MOCK } from "../../shared/api/client";
import { Button, Heading } from "../../shared/ui/primitives";
import {
  ListCard,
  ListFilters,
  ListFooter,
  ListTable,
} from "../../shared/ui/ListLayout";
import { Icon } from "../../shared/ui/Icon";
import { customerApi } from "./api";
import {
  canCreateCustomer,
  customerKeys,
  customerListStatuses,
  parseCustomerFilters,
} from "./model";
import type { CustomerFilters } from "./model";
import { CustomerPanel } from "./CustomerPanel";
import { CustomerDuplicates } from "./CustomerDuplicates";
import { CustomerStatusBadge } from "./CustomerStatusBadge";

export function Customers({ embedded = false }: { embedded?: boolean }) {
  const { session, scope } = useApp(),
    [params, setParams] = useSearchParams();
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const canMerge = session.user.owner && session.user.status === "활성";
  const duplicates = useQuery({
    queryKey: customerKeys.duplicates(session.user.id, 1),
    queryFn: ({ signal }) => customerApi.duplicates(1, signal),
    enabled: canMerge,
    retry: false,
  });
  const duplicateTotal =
    canMerge && duplicates.isSuccess && !duplicates.isFetching
      ? duplicates.data.meta.total
      : 0;
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
  function sortableColumn(label: string, sort: CustomerFilters["sort"]) {
    const direction = filters.sort === sort ? filters.direction : undefined;
    return {
      label,
      direction,
      onSort: () => {
        const nextDirection =
          direction === undefined
            ? sort === "registeredAt"
              ? "desc"
              : "asc"
            : direction === "asc"
              ? "desc"
              : "asc";
        setParams(
          (previous) => {
            const next = new URLSearchParams(previous);
            next.set("sort", sort);
            next.set("direction", nextDirection);
            next.delete("page");
            return next;
          },
          { replace: true },
        );
      },
    };
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
  return (
    <section className={embedded ? "" : "page"}>
      {!embedded && (
        <Heading
          title="회원 관리"
          description="회원 정보와 응대 내용을 확인하고 관리해요."
        />
      )}
      {MOCK && (
        <p className="help mb-4">
          데모 환경의 회원 정보 변경은 새로고침 후 초기화돼요.
        </p>
      )}
      <ListCard>
        <ListFilters
          actions={
            (duplicateTotal > 0 || creatable) && (
              <>
                {duplicateTotal > 0 && (
                  <Button
                    variant="quiet"
                    onClick={() => setDuplicatesOpen(true)}
                  >
                    중복 의심 {duplicateTotal}건
                  </Button>
                )}
                {creatable && (
                  <Button variant="primary" onClick={() => show("new")}>
                    <Icon name="plus" size={16} />
                    회원 등록
                  </Button>
                )}
              </>
            )
          }
        >
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
            {customerListStatuses.map((status) => (
              <option key={status}>{status}</option>
            ))}
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
        </ListFilters>
        <p className="px-5 pb-3 text-xs text-muted">
          이름은 일부 일치, 회원번호는 정확히 일치하며 연락처는 숫자 4자리
          이상으로 검색해 주세요.
        </p>
        <ListTable
          label="회원 목록"
          columns={[
            sortableColumn("회원번호", "memberNo"),
            sortableColumn("회원 이름", "name"),
            sortableColumn("연락처", "phone"),
            sortableColumn("상태", "status"),
            sortableColumn("등록 지점", "registeredBranch"),
            sortableColumn("등록일", "registeredAt"),
          ]}
          loading={rows.isPending}
          error={hasBlockingReadError(rows) ? rows.error : null}
          onRetry={
            isAccessError(rows.error) ? undefined : () => void rows.refetch()
          }
          isEmpty={!rows.data?.items.length}
          empty={{
            title: "등록된 항목이 없어요",
            message: "검색 조건을 바꾸거나 새로운 회원을 등록해 주세요.",
          }}
        >
          {rows.data?.items.map((customer) => (
            <tr key={customer.id}>
              <td>{customer.memberNo}</td>
              <td>
                <button className="cell-link" onClick={() => show(customer.id)}>
                  {customer.name}
                </button>
              </td>
              <td>{formatPhone(customer.phone)}</td>
              <td>
                <CustomerStatusBadge status={customer.status} />
              </td>
              <td>
                {customer.registeredBranchId
                  ? (session.branches.find(
                      (branch) => branch.id === customer.registeredBranchId,
                    )?.name ?? customer.registeredBranchId)
                  : "등록 지점 미지정"}
              </td>
              <td>{displayDate(customer.registeredAt)}</td>
            </tr>
          ))}
        </ListTable>
        <ListFooter
          page={page}
          pageSize={pageSize}
          total={total}
          loading={rows.isPending}
          error={!!rows.error}
          onChange={filterPage}
        />
      </ListCard>
      {canMerge && duplicatesOpen && (
        <CustomerDuplicates
          key={session.user.id}
          onClose={() => setDuplicatesOpen(false)}
          onMerged={(id) => {
            setDuplicatesOpen(false);
            show(id);
          }}
        />
      )}
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
