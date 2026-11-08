import type { ReactNode } from "react";
import { ApiError } from "../../shared/api/client";
import { hasBlockingReadError } from "../../shared/api/read-model";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { useApp } from "../../app/context";
import { can } from "../../shared/domain/schema";
import {
  formatDateTime,
  formatBusinessDate,
  formatKrw,
  formatNumber,
} from "../../shared/domain/format";
import { Button, ErrorState, Heading, State } from "../../shared/ui/primitives";
import { salesApi, salesPeriod } from "./sales-api";
import type {
  SalesCondition,
  BranchSort,
  RevenueSummary,
  SalesTrend,
  TrendGranularity,
} from "./sales-api";
import { SalesChart, SalesTrendChart } from "./Charts";

type Meta = RevenueSummary["aggregation"];
type Amounts = RevenueSummary["totals"];

export function Sales() {
  const { session, scope } = useApp();
  return <SalesWorkspace key={JSON.stringify([session.user, scope])} />;
}
function SalesWorkspace() {
  const { session, scope } = useApp();
  const [params, setParams] = useSearchParams();
  const branches = session.branches.filter(
    (b) =>
      (scope === "all" || scope === b.id) &&
      can(session.user, b.id, "sales:read"),
  );
  const selected = params.getAll("branchIds");
  const from = params.get("from") || "",
    to = params.get("to") || "";
  const basis = params.get("refundBasis") || "processedDate",
    purpose = params.get("purpose") || "";
  const sort = params.get("sort") || "netAmount",
    direction = params.get("direction") || "desc";
  const entryType = params.get("entryType") || "",
    ledgerDirection = params.get("ledgerDirection") || "desc";
  const page = Number(params.get("ledgerPage") || "1");
  const productPage = Number(params.get("productPage") || "1");
  const granularity = (params.get("granularity") || "day") as TrendGranularity;
  let condition: SalesCondition = {},
    invalid = "";
  try {
    if (
      selected.some((id) => !branches.some((b) => b.id === id)) ||
      new Set(selected).size !== selected.length
    )
      throw new Error("선택한 지점의 매출 조회 권한을 확인해 주세요.");
    if (
      !["processedDate", "paymentDate"].includes(basis) ||
      !["", "이용권", "스터디룸", "사물함"].includes(purpose) ||
      ![
        "netAmount",
        "approvedAmount",
        "refundAmount",
        "branchId",
        "requested",
      ].includes(sort) ||
      !["asc", "desc"].includes(direction) ||
      !["asc", "desc"].includes(ledgerDirection) ||
      !["", "승인", "환불"].includes(entryType) ||
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(productPage) ||
      productPage < 1 ||
      !["day", "week", "month"].includes(granularity)
    )
      throw new Error("조회 조건을 확인해 주세요.");
    condition = {
      ...salesPeriod(from, to),
      ...(selected.length
        ? { branchIds: selected }
        : scope !== "all"
          ? { branchIds: [scope] }
          : {}),
      refundBasis: basis as SalesCondition["refundBasis"],
      ...(purpose ? { purpose: purpose as SalesCondition["purpose"] } : {}),
    };
  } catch (error) {
    invalid =
      error instanceof Error ? error.message : "조회 조건을 확인해 주세요.";
  }
  const allowed =
    can(session.user, scope, "sales:read") &&
    (branches.length > 0 || (session.user.owner && scope === "all"));
  const enabled = allowed && !invalid;
  const key = [
    "data",
    session.user.id,
    scope,
    "sales",
    JSON.stringify(session.user),
    JSON.stringify(condition),
  ];
  const revenue = useQuery({
    queryKey: [...key, "revenue"],
    queryFn: ({ signal }) => salesApi.revenue(condition, signal),
    enabled,
    retry: false,
  });
  const comparison = useQuery({
    queryKey: [...key, "branches", sort, direction],
    queryFn: ({ signal }) =>
      salesApi.branches(
        condition,
        { sort: sort as BranchSort, direction: direction as "asc" | "desc" },
        signal,
      ),
    enabled,
    retry: false,
  });
  const ledger = useQuery({
    queryKey: [...key, "ledger", page, entryType, ledgerDirection],
    queryFn: ({ signal }) =>
      salesApi.ledger(
        condition,
        {
          page,
          pageSize: 20,
          entryType: entryType ? (entryType as "승인" | "환불") : undefined,
          direction: ledgerDirection as "asc" | "desc",
        },
        signal,
      ),
    enabled,
    retry: false,
  });
  const passApplicable = !purpose || purpose === "이용권";
  const volume = useQuery({
    queryKey: [...key, "volume"],
    queryFn: ({ signal }) => salesApi.volume(condition, signal),
    enabled: enabled && passApplicable,
  });
  const products = useQuery({
    queryKey: [...key, "products", productPage],
    queryFn: ({ signal }) => salesApi.products(condition, productPage, signal),
    enabled: enabled && passApplicable,
  });
  const trend = useQuery({
    queryKey: [...key, "trend", "revenue", granularity],
    queryFn: ({ signal }) =>
      salesApi.trend(condition, "revenue", granularity, signal),
    enabled,
  });
  const passTrend = useQuery({
    queryKey: [...key, "trend", "passes", granularity],
    queryFn: ({ signal }) =>
      salesApi.trend(condition, "passes", granularity, signal),
    enabled: enabled && passApplicable,
  });
  const reads = [
    revenue,
    comparison,
    ledger,
    trend,
    ...(passApplicable ? [volume, products, passTrend] : []),
  ];
  const forbidden = reads.some(
    ({ error }) => error instanceof ApiError && error.status === 403,
  );
  const defaultPeriod =
    !from && !to && !hasBlockingReadError(revenue)
      ? revenue.data?.aggregation.condition
      : undefined;
  function change(name: string, value: string) {
    setParams((p) => {
      if (value) p.set(name, value);
      else p.delete(name);
      if (
        [
          "from",
          "to",
          "purpose",
          "refundBasis",
          "entryType",
          "ledgerDirection",
        ].includes(name)
      )
        p.delete("ledgerPage");
      if (["from", "to", "purpose", "refundBasis"].includes(name))
        p.delete("productPage");
      return p;
    });
  }
  function changeBranch(id: string, checked: boolean) {
    setParams((p) => {
      const next = checked
        ? [...selected, id]
        : selected.filter((v) => v !== id);
      p.delete("branchIds");
      next.forEach((v) => p.append("branchIds", v));
      p.delete("ledgerPage");
      p.delete("productPage");
      return p;
    });
  }
  if (!allowed) return <State title="매출 조회 권한이 필요해요" />;
  return (
    <div className="page">
      <Heading
        title="매출 조회"
        description="원결제 지점의 승인·환불·순매출과 집계 근거를 확인해요. 이용권 소비 차감은 매출에 더하지 않아요."
      >
        <Button
          onClick={() => {
            reads.forEach((read) => void read.refetch());
          }}
          disabled={!enabled}
        >
          새로고침
        </Button>
      </Heading>
      <section className="card mb-5" aria-label="매출 조회 조건">
        <div className="filters">
          <label className="field">
            시작일
            <input
              type="date"
              value={from}
              onChange={(e) => change("from", e.target.value)}
            />
          </label>
          <label className="field">
            종료일 (미포함)
            <input
              type="date"
              value={to}
              onChange={(e) => change("to", e.target.value)}
            />
          </label>
          <Button
            onClick={() =>
              setParams((p) => {
                p.delete("from");
                p.delete("to");
                p.delete("ledgerPage");
                p.delete("productPage");
                return p;
              })
            }
          >
            이번 달 기본 기간
          </Button>
          <label className="field">
            환불 집계 기준
            <select
              value={basis}
              onChange={(e) => change("refundBasis", e.target.value)}
            >
              <option value="processedDate">환불 처리일 기준</option>
              <option value="paymentDate">원결제일 기준</option>
            </select>
          </label>
          <label className="field">
            결제 용도
            <select
              value={purpose}
              onChange={(e) => change("purpose", e.target.value)}
            >
              <option value="">전체 용도</option>
              {["이용권", "스터디룸", "사물함"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
        </div>
        {scope === "all" && (
          <fieldset className="border-t border-line p-5">
            <legend className="px-2 text-xs">집계 지점</legend>
            <label className="mr-4 inline-flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={!selected.length}
                onChange={() =>
                  setParams((p) => {
                    p.delete("branchIds");
                    p.delete("ledgerPage");
                    p.delete("productPage");
                    return p;
                  })
                }
              />
              매출 조회 가능한 전체 지점
            </label>
            {branches.map((b) => (
              <label
                key={b.id}
                className="mr-4 inline-flex items-center gap-2 text-xs"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(b.id)}
                  onChange={(e) => changeBranch(b.id, e.target.checked)}
                />
                {b.name}
              </label>
            ))}
          </fieldset>
        )}
        {defaultPeriod && !forbidden && (
          <p className="help px-5" aria-label="적용된 기본 날짜">
            {formatBusinessDate(defaultPeriod.from)} ~{" "}
            {formatBusinessDate(defaultPeriod.to)} (종료일 미포함)
          </p>
        )}
        <p className="help px-5 pb-5">
          기간을 비우면 이번 달 1일부터 내일 0시까지 조회합니다. 직접 입력하는
          기간은 최대 366일입니다. 날짜는 한국 시간 기준입니다.
        </p>
      </section>
      {invalid ? (
        <State
          title="조회 조건을 확인해 주세요"
          message={invalid}
          action={<Button onClick={() => setParams({})}>조건 초기화</Button>}
        />
      ) : forbidden ? (
        <State
          title="매출 조회 권한이 필요해요"
          message="선택한 모든 지점의 매출 조회 권한을 확인해 주세요."
        />
      ) : (
        <>
          <section aria-label="매출 요약" className="mb-5">
            {revenue.isPending ? (
              <State loading />
            ) : hasBlockingReadError(revenue) ? (
              <ErrorState
                error={revenue.error!}
                retry={() => void revenue.refetch()}
              />
            ) : (
              revenue.data && (
                <>
                  <AmountCards amounts={revenue.data.totals} />
                  <section className="card mt-5">
                    <header className="card-header">
                      <h2>용도별 매출</h2>
                    </header>
                    <AmountsTable
                      rows={revenue.data.byPurpose.map((r) => ({
                        ...r,
                        label: r.purpose,
                      }))}
                      caption="용도별 매출, 원·건 단위"
                    />
                    <AggregationMeta
                      meta={revenue.data.aggregation}
                      branches={session.branches}
                    />
                  </section>
                </>
              )
            )}
          </section>
          <section className="card mb-5" aria-label="지점별 매출 비교">
            <header className="card-header">
              <h2>지점별 순매출</h2>
              <div className="flex flex-wrap gap-2">
                <label className="field">
                  지점 정렬
                  <select
                    value={sort}
                    onChange={(e) => change("sort", e.target.value)}
                  >
                    <option value="netAmount">순매출</option>
                    <option value="approvedAmount">승인액</option>
                    <option value="refundAmount">환불액</option>
                    <option value="branchId">지점 번호</option>
                    <option value="requested">선택 순서</option>
                  </select>
                </label>
                <label className="field">
                  지점 정렬 방향
                  <select
                    value={direction}
                    onChange={(e) => change("direction", e.target.value)}
                  >
                    <option value="desc">내림차순</option>
                    <option value="asc">오름차순</option>
                  </select>
                </label>
              </div>
            </header>
            {comparison.isPending ? (
              <State loading />
            ) : hasBlockingReadError(comparison) ? (
              <ErrorState
                error={comparison.error!}
                retry={() => void comparison.refetch()}
              />
            ) : (
              comparison.data && (
                <>
                  {comparison.data.aggregation.dataStatus === "hasData" && (
                    <div className="p-5">
                      <SalesChart
                        rows={comparison.data.items.slice(0, 20).map((r) => ({
                          branchId: r.branchId,
                          branch: r.branchName,
                          approved: r.approvedAmountKrw,
                          refunds: r.refundAmountKrw,
                          net: r.netAmountKrw,
                        }))}
                      />
                      {comparison.data.items.length > 20 && (
                        <p className="help">
                          차트는 정렬 순서의 첫 20개 지점입니다. 전체 지점은
                          아래 표에서 확인하세요.
                        </p>
                      )}
                    </div>
                  )}
                  {!comparison.data.items.length && (
                    <State title="집계할 지점이 없어요" />
                  )}
                  <AmountsTable
                    rows={comparison.data.items.map((r) => ({
                      ...r,
                      label: r.branchName,
                    }))}
                    caption="지점별 매출 상세 금액과 건수"
                  />
                  <AggregationMeta
                    meta={comparison.data.aggregation}
                    branches={session.branches}
                  />
                </>
              )
            )}
          </section>
          {passApplicable ? (
            <>
              <SalesSection title="이용권 판매량" read={volume}>
                {({ totals, aggregation }) => (
                  <>
                    <MetricCards
                      values={[
                        ["이용권 결제 건수", totals.paymentCount, "건"],
                        ["판매 수량", totals.soldQuantity, "개"],
                        ["환불 수량", totals.refundedQuantity, "개"],
                        ["순판매량", totals.netSoldQuantity, "개"],
                        ["발급 건수", totals.issuedCount, "개"],
                      ]}
                      noData={totals.dataStatus === "noData"}
                    />
                    <AggregationMeta
                      meta={aggregation}
                      branches={session.branches}
                    />
                  </>
                )}
              </SalesSection>
              <SalesSection title="상품 판매 순위" read={products}>
                {({ items, meta, aggregation }) => (
                  <>
                    {items.length ? (
                      <div className="data-scroll" tabIndex={0}>
                        <table className="data-table">
                          <caption className="sr-only">
                            이용권 상품 판매 순위
                          </caption>
                          <thead>
                            <tr>
                              {[
                                "순위",
                                "판매 당시 상품",
                                "분류",
                                "유형",
                                "결제 건수",
                                "판매 수량",
                                "환불 수량",
                                "순판매량",
                                "발급 건수",
                              ].map((title) => (
                                <th key={title}>{title}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((row) => (
                              <tr
                                key={JSON.stringify([
                                  row.productId,
                                  row.productName,
                                  row.categoryCode,
                                  row.categoryName,
                                ])}
                              >
                                <td>{formatNumber(row.rank)}</td>
                                <th scope="row">{row.productName}</th>
                                <td>{row.categoryName}</td>
                                <td>{row.kind}</td>
                                <td>{formatNumber(row.paymentCount)}건</td>
                                <td>{formatNumber(row.soldQuantity)}개</td>
                                <td>{formatNumber(row.refundedQuantity)}개</td>
                                <td>{formatNumber(row.netSoldQuantity)}개</td>
                                <td>{formatNumber(row.issuedCount)}개</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <State
                        title={
                          meta.total
                            ? "이 페이지에 상품이 없어요"
                            : "조회 조건에 맞는 상품 판매가 없어요"
                        }
                      />
                    )}
                    <nav
                      className="flex items-center justify-between gap-3 p-5"
                      aria-label="상품 순위 페이지"
                    >
                      <Button
                        disabled={productPage <= 1}
                        onClick={() =>
                          change("productPage", String(productPage - 1))
                        }
                      >
                        이전
                      </Button>
                      <span className="text-xs">
                        {formatNumber(meta.total)}개 상품 행 · {productPage} /{" "}
                        {Math.max(1, Math.ceil(meta.total / meta.pageSize))}
                        페이지
                      </span>
                      <Button
                        disabled={productPage * meta.pageSize >= meta.total}
                        onClick={() =>
                          change("productPage", String(productPage + 1))
                        }
                      >
                        다음
                      </Button>
                    </nav>
                    <AggregationMeta
                      meta={aggregation}
                      branches={session.branches}
                    />
                  </>
                )}
              </SalesSection>
            </>
          ) : (
            <State
              title="이용권 판매 지표 · 해당 없음"
              message="선택한 용도에는 이용권 판매량, 상품 순위, 판매량 추세가 적용되지 않아요."
            />
          )}
          <label className="field mb-5">
            추세 집계 단위
            <select
              value={granularity}
              onChange={(e) => change("granularity", e.target.value)}
            >
              <option value="day">일별</option>
              <option value="week">주별</option>
              <option value="month">월별</option>
            </select>
          </label>
          <SalesSection title="매출 추세" read={trend}>
            {(data) => (
              <TrendResults trend={data} branches={session.branches} />
            )}
          </SalesSection>
          {passApplicable && (
            <SalesSection title="이용권 판매량 추세" read={passTrend}>
              {(data) => (
                <TrendResults trend={data} branches={session.branches} />
              )}
            </SalesSection>
          )}
          <section className="card mb-5" aria-label="매출 최소 원장">
            <header className="card-header">
              <h2>최소 원장</h2>
              <div className="flex flex-wrap gap-2">
                <label className="field">
                  원장 항목
                  <select
                    value={entryType}
                    onChange={(e) => change("entryType", e.target.value)}
                  >
                    <option value="">승인·환불 전체</option>
                    <option>승인</option>
                    <option>환불</option>
                  </select>
                </label>
                <label className="field">
                  원장 시간순
                  <select
                    value={ledgerDirection}
                    onChange={(e) => change("ledgerDirection", e.target.value)}
                  >
                    <option value="desc">최신순</option>
                    <option value="asc">오래된순</option>
                  </select>
                </label>
              </div>
            </header>
            {ledger.isPending ? (
              <State loading />
            ) : hasBlockingReadError(ledger) ? (
              <ErrorState
                error={ledger.error!}
                retry={() => void ledger.refetch()}
              />
            ) : (
              ledger.data && (
                <>
                  <div className="p-5">
                    <p className="help">
                      조건 전체의 원장 합계입니다. 현재 페이지 합계가 아닙니다.
                      {entryType && ` ${entryType} 항목만 집계합니다.`}
                    </p>
                    <AmountCards amounts={ledger.data.totals} />
                  </div>
                  {ledger.data.items.length ? (
                    <div className="data-scroll" tabIndex={0}>
                      <table className="data-table">
                        <caption className="sr-only">
                          매출 근거 승인·환불 항목
                        </caption>
                        <thead>
                          <tr>
                            <th>집계 기준 시각</th>
                            <th>항목</th>
                            <th>귀속 지점</th>
                            <th>용도·판매 당시 상품</th>
                            <th>금액</th>
                            <th>결제 상세</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ledger.data.items.map((r) => (
                            <tr key={r.id}>
                              <td>{formatDateTime(r.basisAt)}</td>
                              <td>{r.entryType}</td>
                              <td>
                                {session.branches.find(
                                  (b) => b.id === r.branchId,
                                )?.name || r.branchId}
                              </td>
                              <td>
                                {r.purpose}
                                {r.productName ? ` · ${r.productName}` : ""}
                              </td>
                              <td>{formatKrw(r.amountKrw)}</td>
                              <td>
                                {r.canViewPayment &&
                                can(
                                  session.user,
                                  r.branchId,
                                  "payments:read",
                                ) ? (
                                  <Link
                                    className="text-primary underline"
                                    to={`/app/${r.branchId}/payments?detail=${encodeURIComponent(r.paymentId)}`}
                                  >
                                    결제 보기
                                  </Link>
                                ) : (
                                  "조회 권한 없음"
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <State
                      title={
                        ledger.data.meta.total
                          ? "이 페이지에 원장 항목이 없어요"
                          : "조회 조건에 맞는 거래가 없어요"
                      }
                    />
                  )}
                  <nav
                    className="flex items-center justify-between gap-3 p-5"
                    aria-label="원장 페이지"
                  >
                    <Button
                      disabled={page <= 1}
                      onClick={() => change("ledgerPage", String(page - 1))}
                    >
                      이전
                    </Button>
                    <span className="text-xs">
                      {formatNumber(ledger.data.meta.total)}건 · {page} /{" "}
                      {Math.max(
                        1,
                        Math.ceil(
                          ledger.data.meta.total / ledger.data.meta.pageSize,
                        ),
                      )}
                      페이지
                    </span>
                    <Button
                      disabled={
                        page * ledger.data.meta.pageSize >=
                        ledger.data.meta.total
                      }
                      onClick={() => change("ledgerPage", String(page + 1))}
                    >
                      다음
                    </Button>
                  </nav>
                  <AggregationMeta
                    meta={ledger.data.aggregation}
                    branches={session.branches}
                  />
                </>
              )
            )}
          </section>
        </>
      )}
    </div>
  );
}
function SalesSection<T>({
  title,
  read,
  children,
}: {
  title: string;
  read: {
    isPending: boolean;
    error: Error | null;
    data: T | undefined;
    refetch: () => Promise<unknown>;
  };
  children: (data: T) => ReactNode;
}) {
  return (
    <section className="card mb-5" aria-label={title}>
      <header className="card-header">
        <h2>{title}</h2>
      </header>
      {read.isPending ? (
        <State loading />
      ) : read.error && hasBlockingReadError(read) ? (
        <ErrorState error={read.error} retry={() => void read.refetch()} />
      ) : (
        read.data && children(read.data)
      )}
    </section>
  );
}
function TrendResults({
  trend,
  branches,
}: {
  trend: SalesTrend;
  branches: { id: string; name: string }[];
}) {
  const revenue = trend.measure === "revenue";
  const label = revenue ? "순매출" : "순판매량";
  const format = revenue
    ? formatKrw
    : (value: number) => `${formatNumber(value)}개`;
  const rows = trend.items.map((item) => ({
    label: item.label,
    value: item.revenue?.netAmountKrw ?? item.passes!.netSoldQuantity,
    noData: (item.revenue ?? item.passes)?.dataStatus === "noData",
    partial: item.partial,
  }));
  return (
    <>
      {trend.aggregation.dataStatus === "noData" ? (
        <State title="조회 조건에 맞는 추세 데이터가 없어요" />
      ) : (
        <div className="p-5">
          <SalesTrendChart rows={rows} label={label} format={format} />
        </div>
      )}
      <div className="data-scroll max-h-80" tabIndex={0}>
        <table className="data-table">
          <caption className="sr-only">{label} 추세 상세</caption>
          <thead>
            <tr>
              <th>구간</th>
              <th>{label}</th>
              <th>데이터</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">
                  {row.label}
                  {row.partial ? " · 부분 구간" : ""}
                </th>
                <td>{format(row.value)}</td>
                <td>{row.noData ? "거래 없음" : "거래 있음"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AggregationMeta meta={trend.aggregation} branches={branches} />
    </>
  );
}
function AmountCards({ amounts }: { amounts: Amounts }) {
  return (
    <MetricCards
      values={[
        ["승인 결제액", amounts.approvedAmountKrw, "원"],
        ["환불액", amounts.refundAmountKrw, "원"],
        ["순매출", amounts.netAmountKrw, "원"],
      ]}
      noData={amounts.dataStatus === "noData"}
    />
  );
}
function MetricCards({
  values,
  noData,
}: {
  values: [string, number, "원" | "건" | "개"][];
  noData: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {values.map(([label, value, unit]) => (
        <div className="card p-5" key={label}>
          <small>{label}</small>
          <p className="stat-value text-2xl">
            {unit === "원" ? formatKrw(value) : `${formatNumber(value)}${unit}`}
          </p>
          {noData && <small>거래 없음</small>}
        </div>
      ))}
    </div>
  );
}
function AmountsTable({
  rows,
  caption,
}: {
  rows: (Amounts & { label: string })[];
  caption: string;
}) {
  return (
    <div className="data-scroll" tabIndex={0}>
      <table className="data-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th>구분</th>
            <th>승인액</th>
            <th>환불액</th>
            <th>순매출</th>
            <th>승인 결제 건수</th>
            <th>환불 건수</th>
            <th>데이터</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, index) => (
            <tr key={`${index}:${r.label}`}>
              <th scope="row" className="px-5 py-4 text-left font-medium">
                {r.label}
              </th>
              <td>{formatKrw(r.approvedAmountKrw)}</td>
              <td>{formatKrw(r.refundAmountKrw)}</td>
              <td>{formatKrw(r.netAmountKrw)}</td>
              <td>{formatNumber(r.approvedPaymentCount)}건</td>
              <td>{formatNumber(r.refundCount)}건</td>
              <td>{r.dataStatus === "noData" ? "거래 없음" : "거래 있음"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function AggregationMeta({
  meta,
  branches,
}: {
  meta: Meta;
  branches: { id: string; name: string }[];
}) {
  const c = meta.condition;
  return (
    <div className="help border-t border-line p-5">
      <p>
        적용 기간: {formatDateTime(c.from)} 이상 ~ {formatDateTime(c.to)} 미만
        {meta.defaultPeriod ? " · 이번 달 기본 기간" : ""}
      </p>
      <p>
        적용 지점:{" "}
        {c.branchIds
          .map((id) => branches.find((b) => b.id === id)?.name || id)
          .join(", ") || "없음"}{" "}
        · {c.purpose || "전체 용도"} ·{" "}
        {c.refundBasis === "processedDate"
          ? "환불 처리일 기준"
          : "원결제일 기준"}
      </p>
      <p>
        {meta.timeZone} · {meta.currency} · 금액: 원 / 건수: 건 · 기준 시각:{" "}
        {formatDateTime(meta.asOf)} · 원거래 {formatNumber(meta.sourceRowCount)}
        건
      </p>
      {meta.partial.periodOpen && (
        <p>
          아직 끝나지 않은 기간입니다. 이후 거래에 따라 값이 달라질 수 있습니다.
        </p>
      )}
      <p>각 영역은 표시된 기준 시각으로 개별 조회합니다.</p>
    </div>
  );
}
