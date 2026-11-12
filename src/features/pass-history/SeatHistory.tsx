import { formatKrw } from "../../shared/domain/format";
import { hasBlockingReadError } from "../../shared/api/read-model";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { useApp } from "../../app/context";
import {
  Badge,
  Button,
  ErrorState,
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
import {
  CustomerSelector,
  LIST_CUSTOMER_SELECTOR_CLASS,
  dateTime,
  useSalesSearch,
} from "../payments/shared";
import { seatApi } from "../seats/api";
import { RangeFilter } from "./RangeFilter";
import { timeRange } from "./model";
import type { SessionFilters } from "./model";

const PAGE_SIZE = 20;
// 초기화 대상: 목록 필터와 페이지. tab·detail은 남긴다.
const HISTORY_FILTER_KEYS = [
  "status",
  "seatId",
  "direction",
  "customerId",
  "from",
  "to",
  "page",
];

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
  const { params, page, update, reset } = useSalesSearch();
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
    pageSize: PAGE_SIZE,
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
      <ListCard>
        <ListFilters>
          {scope === "all" && (
            <select
              aria-label="이용 지점 필터"
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
          )}
          <select
            aria-label="이용 상태 필터"
            value={filters.status || ""}
            onChange={(e) => update("status", e.target.value)}
          >
            <option value="">전체 상태</option>
            <option>이용 중</option>
            <option>종료</option>
          </select>
          <select
            aria-label="좌석 필터"
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
          <select
            aria-label="입실 일시 정렬"
            value={filters.direction}
            onChange={(e) => update("direction", e.target.value)}
          >
            <option value="desc">최신순</option>
            <option value="asc">오래된 순</option>
          </select>
          <Button
            variant="quiet"
            onClick={() =>
              // 지점 필터가 지워지면 지점을 바꿀 때처럼 그 지점 기준 상세도 닫는다.
              reset(
                params.has("historyBranch")
                  ? [...HISTORY_FILTER_KEYS, "historyBranch", "detail"]
                  : HISTORY_FILTER_KEYS,
              )
            }
          >
            초기화
          </Button>
        </ListFilters>
        <RangeFilter
          inline
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
        <CustomerSelector
          className={LIST_CUSTOMER_SELECTOR_CLASS}
          allowAll
          value={filters.customerId || ""}
          onChange={(id) => update("customerId", id)}
        />
        {seats.error && (
          <div className="border-b border-line px-4 py-3">
            <ErrorState
              error={seats.error}
              retry={() => void seats.refetch()}
            />
          </div>
        )}
        <p className="px-5 py-3 text-xs text-muted">
          입실 시각 기준으로 조회해요. 구매 지점과 이용 지점은 다를 수 있어요.
        </p>
        <ListTable
          label="입퇴실 이력"
          columns={[
            "고객",
            "이용 지점·좌석",
            "구매 지점·상품",
            "입실·퇴실",
            "상태",
            "이용·차감·초과",
          ]}
          state={validation && <State title={validation} />}
          loading={rows.isPending}
          error={hasBlockingReadError(rows) ? rows.error : null}
          onRetry={() => void rows.refetch()}
          isEmpty={!rows.data?.items.length}
          empty={{ title: "조건에 맞는 입퇴실 이력이 없어요" }}
        >
          {rows.data?.items.map((row) => (
            <tr key={row.id}>
              <td>
                <button
                  className="cell-link"
                  onClick={() => update("detail", row.id)}
                >
                  {row.customer.name}
                </button>
                <span className="help block">{row.customer.memberNo}</span>
              </td>
              <td>
                {branchName(row.branchId)}
                <span className="help block">
                  {row.seat.zone} · {row.seat.seatNo}
                </span>
              </td>
              <td>
                {branchName(row.pass.purchaseBranchId)}
                <span className="help block">{row.pass.productName}</span>
              </td>
              <td>
                {dateTime(row.checkedInAt)}
                <span className="help block">{dateTime(row.checkedOutAt)}</span>
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
                    <span className="help block">
                      차감 {row.deductedMinutes}분 ·{" "}
                      {formatKrw(row.deductedKrw)}
                    </span>
                    <span className="help block">
                      초과 {row.overageMinutes}분 · {formatKrw(row.overageKrw)}
                    </span>
                  </>
                )}
              </td>
            </tr>
          ))}
        </ListTable>
        <ListFooter
          page={rows.data?.meta.page ?? page}
          pageSize={PAGE_SIZE}
          total={rows.data?.meta.total ?? 0}
          loading={!validation && rows.isPending}
          error={!!validation || !!rows.error}
          onChange={(value) => update("page", String(value))}
        />
      </ListCard>
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
                      `${detail.data.deductedMinutes}분 · ${formatKrw(detail.data.deductedKrw)}`,
                    ],
                    [
                      "초과량",
                      `${detail.data.overageMinutes}분 · ${formatKrw(detail.data.overageKrw)}`,
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
