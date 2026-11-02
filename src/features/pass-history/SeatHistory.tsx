import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { useApp } from "../../app/context";
import {
  Badge,
  Button,
  ErrorState,
  FieldError,
  Heading,
  Panel,
  State,
} from "../../shared/ui/primitives";
import { Field } from "../organization/shared";
import {
  CustomerSelector,
  SalesPager,
  dateTime,
  useSalesSearch,
} from "../payments/shared";
import { seatApi } from "../seats/api";
import { RangeFilter } from "./RangeFilter";
import { timeRange } from "./model";
import type { SessionFilters } from "./model";

export function SeatHistory({ embedded = false }: { embedded?: boolean }) {
  const { session, scope } = useApp();
  return (
    <HistoryWorkspace
      key={JSON.stringify([
        session.user.id,
        scope,
        session.user.status,
        session.user.memberships,
      ])}
      embedded={embedded}
    />
  );
}
function HistoryWorkspace({ embedded }: { embedded: boolean }) {
  const { session, scope } = useApp();
  const { params, page, update } = useSalesSearch();
  const [, setParams] = useSearchParams();
  const branchId =
    scope === "all" ? params.get("historyBranch") || "all" : scope;
  const from = params.get("from") || "",
    to = params.get("to") || "";
  let range = {},
    validation = "";
  try {
    range = timeRange(from, to);
  } catch (cause) {
    validation = (cause as Error).message;
  }
  const filters: SessionFilters = {
    scope: branchId,
    page,
    pageSize: 20,
    sort: "checkedInAt",
    direction: params.get("direction") === "asc" ? "asc" : "desc",
    status:
      params.get("status") === "이용 중"
        ? "이용 중"
        : params.get("status") === "종료"
          ? "종료"
          : undefined,
    seatId: params.get("seatId") || undefined,
    customerId: params.get("customerId") || undefined,
    ...range,
  };
  const rows = useQuery({
    queryKey: [
      "data",
      session.user.id,
      scope,
      "seat-sessions",
      "list",
      filters,
    ],
    queryFn: ({ signal }) => seatApi.history(filters, signal),
    enabled: !validation,
    retry: false,
  });
  const seats = useQuery({
    queryKey: [
      "data",
      session.user.id,
      scope,
      "seats",
      "history-selection",
      branchId,
    ],
    queryFn: ({ signal }) => seatApi.board(branchId, "", signal),
    enabled: branchId !== "all",
    retry: false,
  });
  const branchName = (id: string) =>
    session.branches.find((b) => b.id === id)?.name ?? `지점 ${id}`;
  const selected = params.get("detail") || "";
  const detail = useQuery({
    queryKey: [
      "data",
      session.user.id,
      scope,
      "seat-sessions",
      "detail",
      selected,
    ],
    queryFn: ({ signal }) => seatApi.session(branchId, selected, signal),
    enabled: !!selected,
    retry: false,
  });
  return (
    <section className={embedded ? "" : "page"}>
      {!embedded && (
        <Heading
          title="입퇴실 이력"
          description="입실 시각을 기준으로 이용과 차감 내역을 확인해요."
        />
      )}
      <p className="help">
        입실 시각 기준으로 조회해요. 구매 지점과 이용 지점은 다를 수 있어요.
      </p>
      {scope === "all" && (
        <Field label="이용 지점 필터">
          <select
            value={branchId}
            onChange={(e) =>
              setParams((prev) => {
                const next = new URLSearchParams(prev);
                next.set("historyBranch", e.target.value);
                next.delete("seatId");
                next.delete("detail");
                next.delete("page");
                return next;
              })
            }
          >
            <option value="all">전체 지점</option>
            {session.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="my-4 grid gap-3 sm:grid-cols-3">
        <Field label="이용 상태 필터">
          <select
            value={filters.status || ""}
            onChange={(e) => update("status", e.target.value)}
          >
            <option value="">전체 상태</option>
            <option>이용 중</option>
            <option>종료</option>
          </select>
        </Field>
        <Field label="좌석 필터">
          <select
            value={filters.seatId || ""}
            disabled={branchId === "all" || !seats.data || !!seats.error}
            onChange={(e) => update("seatId", e.target.value)}
          >
            <option value="">
              {branchId === "all"
                ? "이용 지점을 먼저 선택해 주세요"
                : "전체 좌석"}
            </option>
            {seats.data?.zones
              .flatMap((z) => z.seats)
              .map((seat) => (
                <option key={seat.id} value={seat.id}>
                  {seat.zone} · {seat.seatNo}
                </option>
              ))}
          </select>
        </Field>
        <Field label="입실 일시 정렬">
          <select
            value={filters.direction}
            onChange={(e) => update("direction", e.target.value)}
          >
            <option value="desc">최신순</option>
            <option value="asc">오래된 순</option>
          </select>
        </Field>
      </div>
      {seats.error && (
        <ErrorState error={seats.error} retry={() => void seats.refetch()} />
      )}
      <CustomerSelector
        allowAll
        value={filters.customerId || ""}
        onChange={(id) => update("customerId", id)}
      />
      <RangeFilter
        key={`${from}:${to}`}
        from={from}
        to={to}
        onApply={(start, end) =>
          setParams((prev) => {
            const next = new URLSearchParams(prev);
            if (start) next.set("from", start);
            else next.delete("from");
            if (end) next.set("to", end);
            else next.delete("to");
            next.delete("page");
            return next;
          })
        }
      />
      {validation ? (
        <FieldError>{validation}</FieldError>
      ) : rows.error ? (
        <ErrorState error={rows.error} retry={() => void rows.refetch()} />
      ) : rows.isPending ? (
        <State loading />
      ) : (
        rows.data && (
          <>
            <div
              className="data-scroll"
              tabIndex={0}
              role="region"
              aria-label="입퇴실 이력 표"
            >
              <table
                className="data-table min-w-[960px]"
                aria-label="입퇴실 이력"
              >
                <thead>
                  <tr>
                    {[
                      "고객",
                      "이용 지점·좌석",
                      "구매 지점·상품",
                      "입실·퇴실",
                      "상태",
                      "이용·차감·초과",
                      "상세",
                    ].map((label) => (
                      <th key={label}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.data.items.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {row.customer.name}
                        <br />
                        {row.customer.memberNo}
                      </td>
                      <td>
                        {branchName(row.branchId)}
                        <br />
                        {row.seat.zone} · {row.seat.seatNo}
                      </td>
                      <td>
                        {branchName(row.pass.purchaseBranchId)}
                        <br />
                        {row.pass.productName}
                      </td>
                      <td>
                        {dateTime(row.checkedInAt)}
                        <br />
                        {dateTime(row.checkedOutAt)}
                      </td>
                      <td>
                        <Badge>{row.status}</Badge>
                      </td>
                      <td>
                        {row.status === "이용 중" ? (
                          "퇴실 시 확정"
                        ) : (
                          <>
                            {row.usedMinutes}분 이용
                            <br />
                            차감 {row.deductedMinutes}분 ·{" "}
                            {row.deductedKrw.toLocaleString("ko-KR")}원<br />
                            초과 {row.overageMinutes}분 ·{" "}
                            {row.overageKrw.toLocaleString("ko-KR")}원
                          </>
                        )}
                      </td>
                      <td>
                        <Button
                          onClick={() => update("detail", row.id)}
                          aria-label={`${row.customer.name} 이용 상세`}
                        >
                          상세
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!rows.data.items.length && (
              <State title="조건에 맞는 입퇴실 이력이 없어요" />
            )}
            <SalesPager
              page={rows.data.meta.page}
              total={rows.data.meta.total}
              onChange={(value) => update("page", String(value))}
            />
          </>
        )
      )}
      {selected && (
        <Panel
          open
          title="입퇴실 이력 상세"
          onClose={() => update("detail", "")}
        >
          {detail.error ? (
            <ErrorState
              error={detail.error}
              retry={() => void detail.refetch()}
            />
          ) : detail.isPending ? (
            <State loading />
          ) : (
            detail.data && (
              <>
                <p>
                  {detail.data.customer.name} · {detail.data.customer.memberNo}
                </p>
                <p>
                  이용 지점: {branchName(detail.data.branchId)} · 구매 지점:{" "}
                  {branchName(detail.data.pass.purchaseBranchId)}
                </p>
                <dl className="detail-grid mt-4">
                  {[
                    ["상태", detail.data.status],
                    [
                      "좌석",
                      `${detail.data.seat.zone} · ${detail.data.seat.seatNo}`,
                    ],
                    ["상품", detail.data.pass.productName],
                    ["입실 일시", dateTime(detail.data.checkedInAt)],
                    ["퇴실 일시", dateTime(detail.data.checkedOutAt)],
                    [
                      "이용 시간",
                      detail.data.status === "이용 중"
                        ? "퇴실 시 확정"
                        : `${detail.data.usedMinutes}분`,
                    ],
                    [
                      "차감",
                      `${detail.data.deductedMinutes}분 · ${detail.data.deductedKrw.toLocaleString("ko-KR")}원`,
                    ],
                    [
                      "초과량",
                      `${detail.data.overageMinutes}분 · ${detail.data.overageKrw.toLocaleString("ko-KR")}원`,
                    ],
                    ["입실 처리자", detail.data.checkedInBy?.name ?? "—"],
                    ["입실 사유", detail.data.checkInReason ?? "—"],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd className="whitespace-pre-wrap break-words">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
                <h3 className="mt-4">좌석 이동 이력</h3>
                {detail.data.moves.map((move, index) => (
                  <article
                    className="tip my-2"
                    key={`${move.movedAt}:${index}`}
                  >
                    <p>
                      {move.fromSeat.zone} · {move.fromSeat.seatNo} →{" "}
                      {move.toSeat.zone} · {move.toSeat.seatNo}
                    </p>
                    <p>
                      {dateTime(move.movedAt)} · {move.movedBy?.name ?? "—"}
                    </p>
                    <p className="whitespace-pre-wrap break-words">
                      {move.reason || "사유 없음"}
                    </p>
                  </article>
                ))}
                {!detail.data.moves.length && (
                  <p className="help">이동 이력이 없어요.</p>
                )}
              </>
            )
          )}
        </Panel>
      )}
    </section>
  );
}
