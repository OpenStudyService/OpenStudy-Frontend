import { useTableSort } from "../../shared/ui/table-sort";
import { hasBlockingReadError } from "../../shared/api/read-model";
import { invalidateReads } from "../../shared/api/invalidateReads";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import {
  formatBusinessDate,
  formatDateTime,
  formatKrw,
} from "../../shared/domain/format";
import { can } from "../../shared/domain/schema";
import {
  Badge,
  Button,
  Heading,
  Panel,
  State,
} from "../../shared/ui/primitives";
import {
  ListCard,
  ListFilters,
  ListFooter,
  ListTable,
} from "../../shared/ui/ListLayout";
import { listPayments } from "./api";
import {
  AdvancedFilters,
  AppliedAdvancedFilters,
  readAdvancedFilters,
} from "./AdvancedFilters";
import { paymentStatuses } from "./model";
import type { Payment, PaymentFilters } from "./model";
import { PaymentCreate, PaymentResult } from "./PaymentCreate";
import { PaymentPanel } from "./PaymentPanels";
import {
  CustomerSelector,
  LIST_CUSTOMER_SELECTOR_CLASS,
  MockPaymentNotice,
  dateTime,
  useSalesSearch,
} from "./shared";

const PAGE_SIZE = 20;
const PAYMENT_FILTER_KEYS = [
  "status",
  "branchId",
  "from",
  "to",
  "sort",
  "direction",
  "customerId",
  "methods",
  "productKinds",
  "categoryCode",
  "operatorIds",
  "processingBranchIds",
  "page",
];

function calendarDayStart(input: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return undefined;
  const timestamp = Date.parse(`${input}T00:00:00+09:00`);
  if (
    !Number.isFinite(timestamp) ||
    formatBusinessDate(new Date(timestamp).toISOString()) !== input
  )
    return undefined;
  return timestamp;
}

export function Payments({ embedded = false }: { embedded?: boolean }) {
  const { session, scope } = useApp();
  return (
    <PaymentsSession
      key={`${session.user.id}:${scope}:${session.user.status}:${session.user.owner}:${JSON.stringify(session.user.memberships)}`}
      embedded={embedded}
    />
  );
}
function PaymentsSession({ embedded }: { embedded: boolean }) {
  const { session, scope } = useApp();
  const query = useQueryClient();
  const { params, page, update, reset } = useSalesSearch();
  const [, setParams] = useSearchParams();
  const sorting = useTableSort({ sort: "createdAt", direction: "desc" });
  const advanced = readAdvancedFilters(params);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Payment>();
  const branch = params.get("branchId") ?? "";
  const requestedScope =
    scope === "all" && session.branches.some((b) => b.id === branch)
      ? branch
      : scope;
  const status = paymentStatuses.find((s) => s === params.get("status"));
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const fromStart = calendarDayStart(from);
  const toStart = calendarDayStart(to);
  const invalidDate =
    (!!from && fromStart === undefined) || (!!to && toStart === undefined);
  const invalidRange = invalidDate || (!!from && !!to && from > to);
  const filters: PaymentFilters = {
    ...advanced,
    categoryCode: advanced.categoryCode ?? undefined,
    scope: requestedScope,
    page,
    pageSize: PAGE_SIZE,
    status,
    from:
      fromStart === undefined ? undefined : new Date(fromStart).toISOString(),
    to:
      toStart === undefined
        ? undefined
        : new Date(toStart + 86400000).toISOString(),
    customerId: params.get("customerId") || undefined,
    sort: params.get("sort") === "amountKrw" ? "amountKrw" : "createdAt",
    direction: params.get("direction") === "asc" ? "asc" : "desc",
  };
  const readable = can(session.user, requestedScope, "payments:read");
  const writable = session.branches.some(
    (b) =>
      b.status === "운영 중" &&
      (scope === "all" || b.id === scope) &&
      can(session.user, b.id, "payments:write"),
  );
  const payments = useQuery({
    queryKey: [
      "data",
      session.user.id,
      requestedScope,
      "payments",
      "list",
      filters,
    ],
    queryFn: ({ signal }) => listPayments(filters, signal),
    enabled: readable && !invalidRange,
    retry: false,
  });
  const detail = params.get("detail") || "";
  const creating = detail === "new";
  function close() {
    if (!busy) {
      update("detail", "");
      setResult(undefined);
    }
  }
  const createButton = writable && (
    <Button
      variant="primary"
      onClick={() => {
        setResult(undefined);
        update("detail", "new");
      }}
    >
      Mock 결제
    </Button>
  );
  const data = invalidRange ? undefined : payments.data;
  return (
    <section className={embedded ? "" : "page"}>
      <Heading
        title="결제 관리"
        description="Mock 결제 내역과 이용권 발급·환불을 확인해요."
      >
        {!readable && createButton}
      </Heading>
      <MockPaymentNotice />
      {readable ? (
        <ListCard>
          <ListFilters actions={createButton}>
            <select
              aria-label="결제 상태 필터"
              value={status ?? ""}
              onChange={(e) => update("status", e.target.value)}
            >
              <option value="">전체 상태</option>
              {paymentStatuses.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            {scope === "all" && (
              <select
                aria-label="결제 지점 필터"
                value={branch}
                onChange={(e) => update("branchId", e.target.value)}
              >
                <option value="">전체 지점</option>
                {session.branches
                  .filter((b) => can(session.user, b.id, "payments:read"))
                  .map((b) => (
                    <option value={b.id} key={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
            )}
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">결제 기간</span>
              <input
                type="date"
                aria-label="결제 기간 시작"
                value={from}
                onChange={(e) => update("from", e.target.value)}
              />
              <span aria-hidden="true">~</span>
              <input
                type="date"
                aria-label="결제 기간 종료"
                value={to}
                onChange={(e) => update("to", e.target.value)}
              />
            </span>
            <Button variant="quiet" onClick={() => reset(PAYMENT_FILTER_KEYS)}>
              초기화
            </Button>
          </ListFilters>
          <AdvancedFilters
            className="border-b border-line [&_.filters]:border-b-0 [&>summary]:cursor-pointer [&>summary]:px-4 [&>summary]:py-3 [&>summary]:text-xs [&>summary]:text-muted"
            values={advanced}
            branches={session.branches.filter((b) => can(session.user, b.id))}
            change={(key, values) =>
              setParams((previous) => {
                const next = new URLSearchParams(previous);
                next.delete(key);
                values.forEach((value) => next.append(key, value));
                next.delete("page");
                return next;
              })
            }
          />
          <CustomerSelector
            className={LIST_CUSTOMER_SELECTOR_CLASS}
            value={filters.customerId ?? ""}
            onChange={(id) => update("customerId", id)}
            allowAll
          />
          {data && (
            <section
              aria-label="결제 목록 적용 조건과 합계"
              className="grid gap-1 border-b border-line px-5 py-3"
            >
              <AppliedAdvancedFilters values={data.filter} />
              <p className="help">
                적용 지점{" "}
                {data.filter.branchIds
                  .map(
                    (id) =>
                      session.branches.find((b) => b.id === id)?.name ?? id,
                  )
                  .join(", ")}{" "}
                · {data.filter.status ?? "전체 상태"}
                {data.filter.customerId &&
                  ` · 고객 ID ${data.filter.customerId}`}
              </p>
              <p className="help">
                결제 생성 시각{" "}
                {data.filter.from
                  ? formatDateTime(data.filter.from)
                  : "제한 없음"}
                {" ~ "}
                {data.filter.to
                  ? `${formatDateTime(data.filter.to)} 미만`
                  : "제한 없음"}
              </p>
              <dl className="grid gap-2 text-xs sm:grid-cols-3">
                {(
                  [
                    ["승인", data.summary.approved],
                    ["실패", data.summary.failed],
                    ["환불", data.summary.refunded],
                  ] as const
                ).map(([label, total]) => (
                  <div key={label}>
                    <dt className="text-muted">{label}</dt>
                    <dd className="font-semibold">
                      {total.count}건 · {formatKrw(total.amountKrw)}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          <ListTable
            label="결제 목록"
            columns={[
              "고객",
              "구매 상품",
              "결제 지점",
              sorting.column("서버 산정 금액", "amountKrw"),
              "상태",
              sorting.column("결제 일시", "createdAt", "desc"),
            ]}
            state={
              invalidRange && (
                <State
                  title={
                    invalidDate
                      ? "올바른 결제 기간을 입력해 주세요"
                      : "시작일은 종료일보다 늦을 수 없어요"
                  }
                />
              )
            }
            loading={payments.isPending}
            error={hasBlockingReadError(payments) ? payments.error : null}
            onRetry={() => void payments.refetch()}
            isEmpty={!data?.items.length}
            empty={{ title: "조건에 맞는 결제가 없어요" }}
          >
            {data?.items.map((p) => (
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
                <td>{p.productName ?? p.purpose}</td>
                <td>
                  {session.branches.find((b) => b.id === p.branchId)?.name ??
                    p.branchId}
                </td>
                <td>{formatKrw(p.amountKrw)}</td>
                <td>
                  <Badge>{p.status}</Badge>
                </td>
                <td>{dateTime(p.createdAt)}</td>
              </tr>
            ))}
          </ListTable>
          <ListFooter
            page={page}
            pageSize={PAGE_SIZE}
            total={data?.meta.total ?? 0}
            loading={!invalidRange && payments.isPending}
            error={invalidRange || !!payments.error}
            onChange={(value) => update("page", String(value))}
          />
        </ListCard>
      ) : (
        <State
          title="결제 목록 조회 권한이 없어요"
          message={
            writable
              ? "결제 등록과 보유 이용권에서의 환불은 결제 권한으로 처리할 수 있어요."
              : "지점의 결제 조회 권한을 확인해 주세요."
          }
          action={
            <Link className="btn" to={`/app/${scope}/members?tab=passes`}>
              보유 이용권
            </Link>
          }
        />
      )}
      {creating && (
        <Panel
          closeDisabled={busy}
          open
          title="Mock 결제"
          onClose={close}
          description="고객·지점·상품을 선택하면 서버가 결제 금액을 정합니다."
        >
          {result ? (
            <>
              <PaymentResult payment={result} />
              <Button className="mt-4" onClick={close}>
                확인
              </Button>
            </>
          ) : (
            <PaymentCreate
              onBusyChange={setBusy}
              onSaved={async (value) => {
                setResult(value);
                await invalidateReads(
                  query,
                  session.user.id,
                  "payments",
                  "passes",
                  "customers",
                  "sales",
                  "products",
                  "lookups",
                );
              }}
            />
          )}
        </Panel>
      )}
      {detail && !creating && readable && (
        <PaymentPanel id={detail} onClose={close} />
      )}
    </section>
  );
}
