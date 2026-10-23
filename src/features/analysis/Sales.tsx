import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { api, queryString } from "../../shared/api/client";
import { can, won } from "../../shared/domain/schema";
import { useApp } from "../../app/context";
import { ErrorState, Heading, State } from "../../shared/ui/primitives";
import { SalesChart, SalesTable } from "./Charts";
import type { SalesRow } from "./Charts";
import { asCollections, isAccessError } from "../../shared/api/read-model";
import { DataNotice } from "../../shared/ui/DataNotice";
export function Sales() {
  const { session, scope } = useApp(),
    [params, setParams] = useSearchParams(),
    start = params.get("start") || "2026-09-01",
    end = params.get("end") || "2026-10-01",
    basis = params.get("basis") || "processed";
  const data = useQuery({
    queryKey: ["data", session.user.id, scope, "sales", start, end, basis],
    queryFn: async ({ signal }) =>
      asCollections(
        { rows: [] as SalesRow[] },
        await api<unknown>(
          `/sales?${queryString({ scope, start, end, basis })}`,
          { signal },
        ),
      ),
    enabled: can(session.user, scope, "sales:read"),
    retry: false,
  });
  function change(k: string, v: string) {
    setParams(
      (p) => {
        p.set(k, v);
        return p;
      },
      { replace: true },
    );
  }
  if (!can(session.user, scope, "sales:read"))
    return <State title="매출 조회 권한이 필요해요" />;
  const rows = data.data?.rows || [];
  const unavailable = !data.data && (data.isPending || !!data.error);
  return (
    <div className="page">
      <Heading
        title="매출 조회"
        description="결제 지점 기준의 승인·환불·순매출을 확인해요. 정액권 소비액은 새 매출로 더하지 않아요."
      />
      <div className="card mb-5">
        <div className="filters">
          <label className="field">
            시작일
            <input
              type="date"
              value={start}
              onChange={(e) => change("start", e.target.value)}
            />
          </label>
          <label className="field">
            종료일 (미포함)
            <input
              type="date"
              value={end}
              onChange={(e) => change("end", e.target.value)}
            />
          </label>
          <label className="field">
            환불 집계 기준
            <select
              value={basis}
              onChange={(e) => change("basis", e.target.value)}
            >
              <option value="processed">환불 처리일 기준</option>
              <option value="original">원결제일 차감 기준</option>
            </select>
          </label>
        </div>
      </div>
      {start >= end ? (
        <State title="조회 기간을 확인해 주세요" />
      ) : isAccessError(data.error) ? (
        <ErrorState error={data.error!} retry={() => void data.refetch()} />
      ) : (
        <>
          <DataNotice
            label="매출 데이터"
            loading={data.isPending}
            error={data.error}
            retry={() => void data.refetch()}
          />
          <div className="stat-grid grid-cols-3">
            {[
              ["승인 결제액", "approved"],
              ["환불액", "refunds"],
              ["순매출", "net"],
            ].map(([label, key]) => (
              <div className="card p-5" key={key}>
                <small>{label}</small>
                <p className="stat-value text-2xl">
                  {unavailable
                    ? "—"
                    : won(
                        rows.reduce(
                          (s, r) =>
                            s + r[key as "approved" | "refunds" | "net"],
                          0,
                        ),
                      )}
                </p>
              </div>
            ))}
          </div>
          <section className="card">
            <header className="card-header">
              <h2>지점별 순매출</h2>
              <Link
                className="text-xs text-primary"
                to={`/app/${scope}/payments`}
              >
                원거래 확인 →
              </Link>
            </header>
            <div className="p-5">
              {rows.length ? (
                <SalesChart rows={rows} />
              ) : (
                <State
                  title={
                    unavailable
                      ? "매출 데이터를 기다리고 있어요"
                      : "조회 기간에 매출 내역이 없어요"
                  }
                />
              )}
            </div>
            <SalesTable rows={rows} />
            <p className="help border-t border-line p-5">
              기간 {start} 이상 ~ {end} 미만 · Asia/Seoul · KRW ·{" "}
              {basis === "processed"
                ? "환불 처리일 기준"
                : "원결제일 차감 기준"}{" "}
              · 이용 실적의 지점과 매출 귀속 지점은 구분합니다.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
