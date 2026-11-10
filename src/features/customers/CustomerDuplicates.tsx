import { useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { useUi } from "../../app/store";
import { ApiError } from "../../shared/api/client";
import { invalidateReads } from "../../shared/api/invalidateReads";
import { formatDateTime, formatKrw } from "../../shared/domain/format";
import {
  Button,
  ErrorState,
  FieldError,
  Panel,
  State,
} from "../../shared/ui/primitives";
import { Field, Pager } from "../organization/shared";
import { getCustomerHistory } from "../pass-history/api";
import { listPayments } from "../payments/api";
import { customerApi } from "./api";
import { CustomerMergeErrorLink } from "./CustomerMergeErrorLink";
import { useCustomerLeaveGuard, useCustomerWrite } from "./hooks";
import type { CustomerDuplicatePage } from "./model";

type Group = CustomerDuplicatePage["items"][number];

export function CustomerDuplicates({
  onClose,
  onMerged,
}: {
  onClose: () => void;
  onMerged: (id: string) => void;
}) {
  const { session } = useApp();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Group | null>(null);
  const rows = useQuery({
    queryKey: ["data", session.user.id, "all", "customers", "duplicates", page],
    queryFn: ({ signal }) => customerApi.duplicates(page, signal),
    retry: false,
  });

  return (
    <Panel open wide title="중복 고객 확인" onClose={onClose}>
      {selected ? (
        <CompareCustomers
          group={selected}
          onBack={() => setSelected(null)}
          onMerged={onMerged}
        />
      ) : rows.isPending ? (
        <State loading />
      ) : rows.error ? (
        <ErrorState error={rows.error} retry={() => void rows.refetch()} />
      ) : (
        <>
          <p className="help">같은 연락처가 등록된 고객을 비교할 수 있어요.</p>
          {rows.data.items.length === 0 && (
            <State title="중복 의심 고객이 없어요" />
          )}
          {rows.data.items.map((group) => (
            <section key={group.phone} className="tip my-3">
              <h3>{group.phone}</h3>
              <ul className="mb-2">
                {group.customers.map((customer) => (
                  <li key={customer.id}>
                    {customer.name} ({customer.memberNo}) · {customer.status} ·
                    결제 {customer.paymentCount}건 ·{" "}
                    {customer.lastActivityAt
                      ? formatDateTime(customer.lastActivityAt)
                      : "활동 없음"}
                  </li>
                ))}
              </ul>
              <Button onClick={() => setSelected(group)}>
                고객 비교: {group.phone}
              </Button>
            </section>
          ))}
          <Pager page={page} total={rows.data.meta.total} onChange={setPage} />
        </>
      )}
    </Panel>
  );
}

function CompareCustomers({
  group,
  onBack,
  onMerged,
}: {
  group: Group;
  onBack: () => void;
  onMerged: (id: string) => void;
}) {
  const { session } = useApp();
  const query = useQueryClient();
  const toast = useUi((s) => s.toast);
  const write = useCustomerWrite();
  const [target, setTarget] = useState("");
  const [absorbed, setAbsorbed] = useState("");
  const [reason, setReason] = useState("");
  const [paymentPages, setPaymentPages] = useState([1, 1]);
  const setPaymentPage = (side: number, page: number) =>
    setPaymentPages((current) =>
      current.map((value, index) => (index === side ? page : value)),
    );
  const [failure, setFailure] = useState<Error | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const leave = useCustomerLeaveGuard(!!reason);
  const histories = useQueries({
    queries: [target, absorbed].map((id, side) => ({
      queryKey: [
        "data",
        session.user.id,
        "all",
        "customers",
        "merge-preview",
        side,
        id,
        paymentPages[side],
      ],
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const [customer, payments, passes] = await Promise.all([
          customerApi.detail("all", id, signal),
          listPayments(
            {
              scope: "all",
              customerId: id,
              page: paymentPages[side],
              pageSize: 20,
            },
            signal,
          ),
          getCustomerHistory(id, "all", {}, signal),
        ]);
        return { customer, payments, passes };
      },
      enabled: !!id,
      staleTime: 0,
      retry: false,
    })),
  });
  const ready =
    target !== absorbed &&
    histories.every(
      (history) =>
        history.data &&
        !history.isFetching &&
        !history.error &&
        history.data.customer.status !== "병합됨",
    );
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || !reason.trim() || needsRefresh || write.busy) return;
    const body = {
      version: histories[0].data!.customer.version,
      absorbedCustomerId: absorbed,
      absorbedVersion: histories[1].data!.customer.version,
      reason: reason.trim(),
    };
    setFailure(null);
    try {
      const result = await write.run("customer-merge", body, (signal) =>
        customerApi.merge(target, body, signal),
      );
      leave.saved();
      void invalidateReads(
        query,
        session.user.id,
        "payments",
        "passes",
        "room-reservations",
        "locker-assignments",
        "seats",
        "seat-sessions",
        "customer-space-history",
      );
      toast("고객을 병합했어요.");
      onMerged(result.id);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFailure(error as Error);
      if (
        error instanceof ApiError &&
        ["VERSION_CONFLICT", "CUSTOMER_ALREADY_MERGED"].includes(
          error.detail.code,
        )
      )
        setNeedsRefresh(true);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
      {leave.guard}
      <p className="tip" role="note">
        병합은 되돌릴 수 없어요. 남는 고객과 흡수할 고객의 결제·이용권 이력을
        확인해 주세요.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {(
          [
            ["남는 고객", target, absorbed, setTarget],
            ["흡수할 고객", absorbed, target, setAbsorbed],
          ] as const
        ).map(([label, id, other, select], index) => (
          <section key={label} className="rounded-xl border border-line p-3">
            <Field label={label}>
              <select
                value={id}
                disabled={write.busy}
                onChange={(event) => {
                  select(event.target.value);
                  setPaymentPage(index, 1);
                }}
              >
                <option value="">선택해 주세요</option>
                {group.customers
                  .filter((customer) => customer.id !== other)
                  .map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name} ({customer.memberNo})
                    </option>
                  ))}
              </select>
            </Field>
            {id && histories[index].isFetching && <State loading />}
            {histories[index].error && (
              <ErrorState
                error={histories[index].error!}
                retry={() => void histories[index].refetch()}
              />
            )}
            {id &&
              histories[index].data &&
              (() => {
                const { customer, payments, passes } = histories[index].data;
                return (
                  <>
                    <p>
                      {customer.status} · {customer.phone}
                    </p>
                    <h4>결제 이력 · 총 {payments.meta.total}건</h4>
                    <ul>
                      {payments.items.map((payment) => (
                        <li key={payment.id}>
                          {formatDateTime(payment.createdAt)} ·{" "}
                          {payment.productName ?? payment.purpose} ·{" "}
                          {payment.status} · {formatKrw(payment.amountKrw)}
                        </li>
                      ))}
                    </ul>
                    {payments.meta.total > payments.meta.pageSize && (
                      <Pager
                        page={paymentPages[index]}
                        total={payments.meta.total}
                        onChange={(page) => setPaymentPage(index, page)}
                      />
                    )}
                    <h4>이용권 이력</h4>
                    <ul>
                      {passes.passes.map((pass) => (
                        <li key={pass.passId}>
                          {pass.productName} · {pass.status}
                        </li>
                      ))}
                      {passes.events.map((event, eventIndex) => (
                        <li key={`${event.passId}:${eventIndex}`}>
                          {formatDateTime(event.at)} · {event.productName} ·{" "}
                          {event.type}
                        </li>
                      ))}
                    </ul>
                    {!passes.passes.length && (
                      <p className="help">이용권 이력이 없어요.</p>
                    )}
                  </>
                );
              })()}
          </section>
        ))}
      </div>
      <Field label="병합 사유">
        <textarea
          required
          maxLength={500}
          value={reason}
          disabled={write.busy}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      {failure && <FieldError>{failure.message}</FieldError>}
      <CustomerMergeErrorLink error={failure} />
      {needsRefresh && (
        <Button
          type="button"
          disabled={
            !target ||
            !absorbed ||
            histories.some((history) => history.isFetching)
          }
          onClick={async () => {
            const results = await Promise.all(
              histories.map((history) => history.refetch()),
            );
            if (results.every((result) => result.isSuccess)) {
              setNeedsRefresh(false);
              setFailure(null);
            }
          }}
        >
          최신 고객 정보와 이력 다시 확인
        </Button>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          disabled={write.busy}
          onClick={() => {
            if (!reason || window.confirm("입력한 병합 사유를 지울까요?"))
              onBack();
          }}
        >
          후보 목록으로
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={!ready || !reason.trim() || needsRefresh || write.busy}
        >
          고객 병합
        </Button>
      </div>
    </form>
  );
}
