import { hasBlockingReadError } from "../../shared/api/read-model";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { useApp } from "../../app/context";
import { can } from "../../shared/domain/schema";
import {
  Badge,
  Button,
  ErrorState,
  FieldError,
  State,
} from "../../shared/ui/primitives";
import { dateTime } from "../payments/shared";
import { getCustomerHistory } from "./api";
import { timeRange } from "./model";
import type { Ledger } from "./model";
import { RangeFilter } from "./RangeFilter";

const number = (value: number) =>
  value.toLocaleString("ko-KR", { signDisplay: "exceptZero" });
function LedgerRow({ pass }: { pass: Ledger }) {
  const time = pass.kind === "시간권",
    period = pass.kind === "기간권";
  const issued = time ? pass.issuedMinutes : pass.issuedCreditKrw;
  const ledger = time ? pass.ledgerMinutes : pass.ledgerKrw;
  const remaining = time ? pass.remainingMinutes : pass.remainingCreditKrw;
  return (
    <tr>
      <td>
        {pass.productName}
        <br />
        <Badge>{pass.kind}</Badge>
      </td>
      <td>{pass.status}</td>
      {period ? (
        <td colSpan={4}>기간권 · 잔량 대조 대상 아님</td>
      ) : (
        <>
          <td>
            {issued?.toLocaleString("ko-KR")} {time ? "분" : "원"}
          </td>
          <td>
            {number(ledger)} {time ? "분" : "원"}
          </td>
          <td>
            {remaining?.toLocaleString("ko-KR")} {time ? "분" : "원"}
          </td>
          <td>
            {issued !== null &&
            remaining !== null &&
            issued + ledger === remaining
              ? "일치"
              : "확인 필요"}
          </td>
        </>
      )}
    </tr>
  );
}

export function CustomerHistory({ customerId }: { customerId: string }) {
  const { session, scope } = useApp();
  const [params, setParams] = useSearchParams();
  const from = params.get("historyFrom") || "",
    to = params.get("historyTo") || "";
  const [visible, setVisible] = useState(false);
  let range = {},
    validation = "";
  try {
    range = timeRange(from, to);
  } catch (cause) {
    validation = (cause as Error).message;
  }
  const query = useQuery({
    queryKey: [
      "data",
      session.user.id,
      scope,
      "passes",
      "history",
      customerId,
      range,
    ],
    queryFn: ({ signal }) =>
      getCustomerHistory(customerId, scope, range, signal),
    enabled: visible && !validation,
    retry: false,
  });
  const branchName = (id: string) =>
    session.branches.find((b) => b.id === id)?.name ?? `지점 ${id}`;
  return (
    <section className="mt-6" aria-label="고객 구매·사용 내역">
      <Button
        onClick={() => setVisible((value) => !value)}
        aria-expanded={visible}
      >
        구매·사용 내역 {visible ? "접기" : "보기"}
      </Button>
      {visible && (
        <>
          <h3 className="mt-4">구매·사용·조정 내역</h3>
          <p className="help">
            기간은 사건 발생 시각 기준이에요. 원장 대조는 선택 기간과 무관한
            전체 변경량입니다.
          </p>
          <RangeFilter
            key={`${from}:${to}`}
            from={from}
            to={to}
            onApply={(start, end) =>
              setParams((prev) => {
                const next = new URLSearchParams(prev);
                if (start) next.set("historyFrom", start);
                else next.delete("historyFrom");
                if (end) next.set("historyTo", end);
                else next.delete("historyTo");
                return next;
              })
            }
          />
          {validation ? (
            <FieldError>{validation}</FieldError>
          ) : hasBlockingReadError(query) ? (
            <ErrorState
              error={query.error!}
              retry={() => void query.refetch()}
            />
          ) : query.isPending ? (
            <State loading />
          ) : (
            query.data && (
              <>
                <h4>전체 원장 대조</h4>
                <div
                  className="data-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label="이용권 원장 표"
                >
                  <table
                    className="data-table min-w-[640px]"
                    aria-label="이용권 전체 원장 대조"
                  >
                    <thead>
                      <tr>
                        {[
                          "상품",
                          "상태",
                          "발급량",
                          "전체 변경량",
                          "현재 잔량",
                          "대조",
                        ].map((label) => (
                          <th key={label}>{label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {query.data.passes.map((pass) => (
                        <LedgerRow key={pass.passId} pass={pass} />
                      ))}
                    </tbody>
                  </table>
                </div>
                {!query.data.passes.length && (
                  <p className="help">이 범위에서 구매한 이용권이 없어요.</p>
                )}
                <div className="grid gap-3 mt-4">
                  {query.data.events.map((event, index) => {
                    const inScope =
                      (scope === "all" || event.branchId === scope) &&
                      can(session.user, event.branchId);
                    const paymentBranch = query.data.passes.find(
                      (p) => p.passId === event.passId,
                    )?.purchaseBranchId;
                    return (
                      <article
                        className="tip"
                        key={`${event.at}:${event.passId}:${event.type}:${index}`}
                      >
                        <p>
                          <Badge>{event.type}</Badge> {event.productName}
                        </p>
                        <p>
                          {dateTime(event.at)} · {branchName(event.branchId)}
                        </p>
                        <p>
                          증감: {number(event.deltaMinutes)}분 ·{" "}
                          {number(event.deltaKrw)}원
                        </p>
                        {inScope && event.usedMinutes !== null && (
                          <p>
                            이용 시간:{" "}
                            {event.usedMinutes.toLocaleString("ko-KR")}분
                          </p>
                        )}
                        {inScope && event.actor && (
                          <p>처리자: {event.actor.name}</p>
                        )}
                        {inScope && event.reason && (
                          <p className="whitespace-pre-wrap break-words">
                            사유: {event.reason}
                          </p>
                        )}
                        {!inScope && (
                          <p className="help">
                            다른 지점 이용은 지점·일시·증감량만 표시해요.
                          </p>
                        )}
                        {event.paymentId &&
                          paymentBranch &&
                          can(session.user, paymentBranch, "payments:read") && (
                            <Link
                              className="btn mt-2"
                              to={`/app/${scope}/payments?detail=${encodeURIComponent(event.paymentId)}`}
                            >
                              관련 결제 상세
                            </Link>
                          )}
                      </article>
                    );
                  })}
                </div>
                {!query.data.events.length && (
                  <State title="선택한 기간의 내역이 없어요" />
                )}
              </>
            )
          )}
        </>
      )}
    </section>
  );
}
