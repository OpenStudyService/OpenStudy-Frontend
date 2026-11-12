import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, queryString } from "../../shared/api/client";
import type { components } from "../../shared/api/foundation.generated";
import { hasBlockingReadError } from "../../shared/api/read-model";
import { useIdempotency } from "../../shared/api/useIdempotency";
import {
  formatBusinessDate,
  formatDateTime,
  formatKrw,
} from "../../shared/domain/format";
import { Button, ErrorState, State } from "../../shared/ui/primitives";
import { Field, SaveError } from "../organization/shared";
import { useSalesClock } from "../payments/shared";

type Schemas = components["schemas"];
type Closing = Schemas["DailyClosing"];

export function DailyClosings({
  userId,
  branches,
  writable,
}: {
  userId: string;
  branches: { id: string; name: string }[];
  writable: string[];
}) {
  const [page, setPage] = useState(1);
  const [id, setId] = useState("");
  const [branch, setBranch] = useState(writable[0] ?? "");
  const [date, setDate] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const validPeriod = (!from && !to) || (!!from && !!to && from <= to);
  const query = useQueryClient();
  const now = useSalesClock();
  const idempotency = useIdempotency();
  const branchIds = branches.map((b) => b.id);
  const key = ["data", userId, "daily-closings", branchIds];
  const list = useQuery({
    queryKey: [...key, "list", page, from, to],
    queryFn: ({ signal }) =>
      api<Schemas["DailyClosingPage"]>(
        `/daily-closings?${queryString({ branchIds, page, pageSize: 20, from, to })}`,
        { signal },
      ),
    enabled: branchIds.length > 0 && validPeriod,
    retry: false,
  });
  const detail = useQuery({
    queryKey: [...key, "detail", id],
    queryFn: ({ signal }) =>
      api<Closing>(`/daily-closings/${encodeURIComponent(id)}`, { signal }),
    enabled: !!id,
    retry: false,
  });
  const create = useMutation({
    mutationFn: (body: Schemas["DailyClosingCreate"]) =>
      api<Closing>("/daily-closings", {
        method: "POST",
        body,
        key: idempotency.key("daily-closings", body),
      }),
    onSuccess: (closing) => {
      idempotency.committed();
      query.setQueryData([...key, "detail", closing.id], closing);
      setId(closing.id);
      setPage(1);
      void query.invalidateQueries({ queryKey: [...key, "list"] });
    },
  });
  const today = formatBusinessDate(new Date(now).toISOString());
  const existingId =
    create.error instanceof ApiError &&
    create.error.detail.code === "CLOSING_EXISTS"
      ? create.error.detail.closingId
      : undefined;
  const yesterday = formatBusinessDate(
    new Date(now - 86_400_000).toISOString(),
  );
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (writable.includes(branch) && date && date < today && !create.isPending)
      create.mutate({ branchId: branch, businessDate: date });
  }
  if (!branchIds.length) return <State title="조회할 지점이 없어요" />;
  return (
    <section className="card mb-5 p-5" aria-label="일별 마감">
      {writable.length > 0 && (
        <form className="filters" onSubmit={submit}>
          <Field label="마감 지점">
            <select
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
            >
              {branches
                .filter((b) => writable.includes(b.id))
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="마감일 (한국 시간)">
            <input
              type="date"
              required
              max={yesterday}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Button
            type="submit"
            disabled={!date || date >= today || create.isPending}
          >
            마감 실행
          </Button>
          {create.error && (
            <SaveError
              error={create.error}
              refresh={async () => {
                await list.refetch();
              }}
            />
          )}
          {existingId && (
            <Button type="button" onClick={() => setId(existingId)}>
              기존 마감 상세
            </Button>
          )}
        </form>
      )}
      <div className="filters">
        <Field label="마감 목록 시작일">
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </Field>
        <Field label="마감 목록 종료일">
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </Field>
      </div>
      {!validPeriod ? (
        <p className="help">시작일과 종료일을 순서대로 선택해 주세요.</p>
      ) : list.isPending ? (
        <State loading />
      ) : hasBlockingReadError(list) ? (
        <ErrorState error={list.error!} retry={() => void list.refetch()} />
      ) : (
        list.data && (
          <>
            {!list.data.items.length && <State title="마감 기록이 없어요" />}
            <ul>
              {list.data.items.map((item) => (
                <li key={item.id}>
                  <Button onClick={() => setId(item.id)}>
                    {item.businessDate}{" "}
                    {branches.find((b) => b.id === item.branchId)?.name ??
                      item.branchId}{" "}
                    상세
                  </Button>{" "}
                  {formatKrw(item.processedDate.netAmountKrw)} · 조정{" "}
                  {item.adjustmentCount}건
                </li>
              ))}
            </ul>
            {list.data.meta.total > 20 && (
              <div>
                <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  이전
                </Button>
                <Button
                  disabled={page * 20 >= list.data.meta.total}
                  onClick={() => setPage(page + 1)}
                >
                  다음
                </Button>
              </div>
            )}
          </>
        )
      )}
      {id &&
        (detail.isPending ? (
          <State loading />
        ) : hasBlockingReadError(detail) ? (
          <ErrorState
            error={detail.error!}
            retry={() => void detail.refetch()}
          />
        ) : (
          detail.data && <ClosingDetails closing={detail.data} />
        ))}
    </section>
  );
}

export function ClosingDetails({ closing }: { closing: Closing }) {
  return (
    <section className="mt-4" aria-label="마감 상세">
      <h3>{closing.businessDate} 마감 상세</h3>
      <p>
        {closing.closedBy.name} · {formatDateTime(closing.closedAt)}
      </p>
      {closing.note && <p>{closing.note}</p>}
      <table className="data-table">
        <thead>
          <tr>
            <th>기준</th>
            <th>승인액</th>
            <th>환불액</th>
            <th>순매출</th>
          </tr>
        </thead>
        <tbody>
          {(
            [
              ["마감 금액 (처리일)", closing.snapshot.processedDate.totals],
              ["마감 금액 (원결제일)", closing.snapshot.paymentDate.totals],
              ["조정 합계 (원결제일)", closing.difference],
              ["현재 금액 (원결제일)", closing.current.paymentDate],
            ] as const
          ).map(([label, totals]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{formatKrw(totals.approvedAmountKrw)}</td>
              <td>{formatKrw(totals.refundAmountKrw)}</td>
              <td>{formatKrw(totals.netAmountKrw)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>조정 이력</h3>
      {!closing.adjustments.length ? (
        <p>조정 이력이 없어요.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>시각</th>
              <th>금액</th>
              <th>사유</th>
              <th>처리자</th>
            </tr>
          </thead>
          <tbody>
            {closing.adjustments.map((entry) => (
              <tr key={entry.id}>
                <td>{formatDateTime(entry.processedAt)}</td>
                <td>{formatKrw(entry.amountKrw)}</td>
                <td>{entry.reason ?? "—"}</td>
                <td>{entry.processedBy.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
