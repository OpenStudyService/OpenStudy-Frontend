import { useState } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { can, won } from "../../shared/domain/schema";
import {
  Badge,
  Button,
  ErrorState,
  Heading,
  Panel,
  State,
} from "../../shared/ui/primitives";
import { Field } from "../organization/shared";
import { listPayments } from "./api";
import { paymentStatuses } from "./model";
import type { Payment, PaymentFilters } from "./model";
import { PaymentCreate, PaymentResult } from "./PaymentCreate";
import { PaymentPanel } from "./PaymentPanels";
import {
  CustomerSelector,
  MockPaymentNotice,
  SalesPager,
  dateTime,
  useSalesSearch,
} from "./shared";

function calendarDayStart(input: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return undefined;
  const timestamp = Date.parse(`${input}T00:00:00+09:00`);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp + 9 * 3600000).toISOString().slice(0, 10) !== input
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
  const { params, page, update } = useSalesSearch();
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
    scope: requestedScope,
    page,
    pageSize: 20,
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
  return (
    <section className={embedded ? "" : "page"}>
      <Heading
        title="결제"
        description="Mock 결제 내역과 이용권 발급·환불을 확인해요."
      >
        {writable && (
          <Button
            variant="primary"
            onClick={() => {
              setResult(undefined);
              update("detail", "new");
            }}
          >
            Mock 결제
          </Button>
        )}
      </Heading>
      <MockPaymentNotice />
      {readable ? (
        <>
          <div className="grid gap-3 sm:grid-cols-4 my-4">
            <Field label="결제 상태 필터">
              <select
                value={status ?? ""}
                onChange={(e) => update("status", e.target.value)}
              >
                <option value="">전체 상태</option>
                {paymentStatuses.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            {scope === "all" && (
              <Field label="결제 지점 필터">
                <select
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
              </Field>
            )}
            <Field label="결제 기간 시작">
              <input
                type="date"
                value={from}
                onChange={(e) => update("from", e.target.value)}
              />
            </Field>
            <Field label="결제 기간 종료">
              <input
                type="date"
                value={to}
                onChange={(e) => update("to", e.target.value)}
              />
            </Field>
            <Field label="결제 정렬">
              <select
                value={filters.sort}
                onChange={(e) => update("sort", e.target.value)}
              >
                <option value="createdAt">결제일</option>
                <option value="amountKrw">금액</option>
              </select>
            </Field>
            <Field label="결제 정렬 방향">
              <select
                value={filters.direction}
                onChange={(e) => update("direction", e.target.value)}
              >
                <option value="desc">내림차순</option>
                <option value="asc">오름차순</option>
              </select>
            </Field>
          </div>
          <CustomerSelector
            value={filters.customerId ?? ""}
            onChange={(id) => update("customerId", id)}
            allowAll
          />
          {invalidRange ? (
            <State
              title={
                invalidDate
                  ? "올바른 결제 기간을 입력해 주세요"
                  : "시작일은 종료일보다 늦을 수 없어요"
              }
            />
          ) : payments.isPending ? (
            <State loading />
          ) : payments.error ? (
            <ErrorState
              error={payments.error}
              retry={() => void payments.refetch()}
            />
          ) : (
            payments.data && (
              <>
                {!payments.data.items.length ? (
                  <State title="조건에 맞는 결제가 없어요" />
                ) : (
                  <div className="data-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>고객</th>
                          <th>구매 상품</th>
                          <th>결제 지점</th>
                          <th>서버 산정 금액</th>
                          <th>상태</th>
                          <th>결제 일시</th>
                          <th>상세</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payments.data.items.map((p) => (
                          <tr key={p.id}>
                            <td>
                              {p.customer.name}
                              <span className="help block">
                                {p.customer.memberNo}
                              </span>
                            </td>
                            <td>{p.productName}</td>
                            <td>
                              {session.branches.find((b) => b.id === p.branchId)
                                ?.name ?? p.branchId}
                            </td>
                            <td>{won(p.amountKrw)}</td>
                            <td>
                              <Badge>{p.status}</Badge>
                            </td>
                            <td>{dateTime(p.createdAt)}</td>
                            <td>
                              <Button onClick={() => update("detail", p.id)}>
                                결제 상세: {p.id}
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
                  total={payments.data.meta.total}
                  onChange={(value) => update("page", String(value))}
                />
              </>
            )
          )}
        </>
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
                await query.invalidateQueries({
                  queryKey: ["data", session.user.id],
                });
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
