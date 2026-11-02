import { useId, useState } from "react";
import { domainFor, DEMO_CLOCK } from "./catalog";
import { chartData, resultTotal, scopeLabel, resolveView } from "./model";
import type { DemoResult } from "./model";
import { Heatmap, SeatMap, WeekCalendar } from "./RichVisuals";
const palette = ["#087f71", "#3f7fbd", "#8fb9cb", "#dba464", "#9b91c7"];
const fmt = (value: string | number, unit?: string) =>
  typeof value === "number"
    ? `${value.toLocaleString("ko-KR")}${unit ?? ""}`
    : value;

function Chart({ result }: { result: DemoResult }) {
  const data = chartData(result),
    id = useId();
  const view = resolveView(result.viewSpec);
  const max = Math.max(...data.map((d) => d.value), 1),
    total = data.reduce((n, d) => n + d.value, 0);
  if (view === "donut") {
    return (
      <div className="dl-donut-wrap">
        <svg viewBox="0 0 180 180" role="img" aria-labelledby={id}>
          <title id={id}>
            {result.scenario.title} · 합계 {total}
          </title>
          <circle
            cx="90"
            cy="90"
            r="62"
            fill="none"
            stroke="#edf1e9"
            strokeWidth="22"
          />
          {data.map((d, i) => {
            const length = total ? (d.value / total) * 389.56 : 0;
            const start = total
              ? (data.slice(0, i).reduce((sum, item) => sum + item.value, 0) /
                  total) *
                389.56
              : 0;
            return (
              <circle
                key={d.label}
                cx="90"
                cy="90"
                r="62"
                fill="none"
                stroke={palette[i % palette.length]}
                strokeWidth="22"
                strokeDasharray={`${length} ${389.56 - length}`}
                strokeDashoffset={-start}
                transform="rotate(-90 90 90)"
              />
            );
          })}
          <text x="90" y="85" textAnchor="middle" className="dl-svg-small">
            전체
          </text>
          <text x="90" y="110" textAnchor="middle" className="dl-svg-total">
            {total}
          </text>
        </svg>
        <div className="dl-legend">
          {data.map((d, i) => (
            <div key={d.label}>
              <span>
                <i style={{ background: palette[i % palette.length] }} />
                {d.label}
              </span>
              <b>{fmt(d.value, result.scenario.valueUnit)}</b>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (view === "line") {
    const points = data
      .map(
        (d, i) =>
          `${40 + (i * 500) / Math.max(1, data.length - 1)},${150 - (d.value / max) * 110}`,
      )
      .join(" ");
    return (
      <svg
        className="dl-line"
        viewBox="0 0 600 195"
        role="img"
        aria-labelledby={id}
      >
        <title id={id}>
          {result.scenario.title}:{" "}
          {data.map((d) => `${d.label} ${d.value}`).join(", ")}
        </title>
        {[40, 95, 150].map((y) => (
          <line key={y} x1="40" y1={y} x2="560" y2={y} stroke="#e7ece4" />
        ))}
        <polygon points={`40,150 ${points} 540,150`} fill="#eaf1e4" />
        <polyline
          points={points}
          fill="none"
          stroke="#376c55"
          strokeWidth="3"
        />
        {data.map((d, i) => (
          <g key={d.label}>
            <circle
              cx={40 + (i * 500) / Math.max(1, data.length - 1)}
              cy={150 - (d.value / max) * 110}
              r="4"
              fill="#376c55"
            />
            <text
              x={40 + (i * 500) / Math.max(1, data.length - 1)}
              y={135 - (d.value / max) * 110}
              textAnchor="middle"
              className="dl-svg-small"
            >
              {d.value}
            </text>
            <text
              x={40 + (i * 500) / Math.max(1, data.length - 1)}
              y="181"
              textAnchor="middle"
              className="dl-svg-small"
            >
              {d.label}
            </text>
          </g>
        ))}
      </svg>
    );
  }
  return (
    <div
      className="dl-bars"
      role="img"
      aria-label={`${result.scenario.title}: ${data.map((d) => `${d.label} ${fmt(d.value, result.scenario.valueUnit)}`).join(", ")}`}
    >
      {data.map((d, i) => (
        <div className="dl-bar-row" key={d.label}>
          <span>{d.label}</span>
          <div>
            <i
              style={{
                width: `${Math.max(2, (d.value / max) * 100)}%`,
                background: palette[i % palette.length],
              }}
            />
          </div>
          <b>{fmt(d.value, result.scenario.valueUnit)}</b>
        </div>
      ))}
    </div>
  );
}
export function ResultCard({
  result,
  readOnly = false,
  onFollowup,
}: {
  result: DemoResult;
  readOnly?: boolean;
  onFollowup?: (scope: string) => void;
}) {
  const [sort, setSort] = useState({ key: "", desc: false }),
    [page, setPage] = useState(0),
    [detail, setDetail] = useState<string | null>(null);
  const s = result.scenario,
    d = domainFor(s),
    titleId = useId();
  const view = resolveView(result.viewSpec);
  const fallback =
    view === "table" && result.viewSpec.components[1]?.type !== "table";
  const sorted = [...result.rows].sort((a, b) => {
    if (!sort.key) return 0;
    const x = a[sort.key],
      y = b[sort.key];
    return (
      (typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x ?? "").localeCompare(String(y ?? ""), "ko")) *
      (sort.desc ? -1 : 1)
    );
  });
  const visible = sorted.slice(page * 5, page * 5 + 5),
    selected = result.rows.find((r) => r.id === detail);
  const isChart = ["bar", "line", "donut"].includes(view) && !!s.valueKey;
  return (
    <section
      className="dl-result"
      aria-labelledby={titleId}
      data-scenario={s.id}
    >
      <header className="dl-result-head">
        <div>
          <span className="dl-eyebrow">
            {d.name} <span> / </span>{" "}
            {fallback ? "TABLE FALLBACK" : view.toUpperCase()}
          </span>
          <h3 id={titleId}>{s.title}</h3>
          <p>{s.summary}</p>
        </div>
        <span className="dl-verified">✓ 데모 결과</span>
      </header>
      <div className="dl-conditions">
        <span>{scopeLabel(result.scope)}</span>
        <span>{s.period}</span>
        <span>
          {s.id.startsWith("sales") || s.id === "state-fallback"
            ? "환불 처리일 기준"
            : "고정 가상 데이터"}
        </span>
      </div>
      <div className="dl-kpis">
        <div>
          <span>{s.valueKey ? "조회 합계" : "조회 결과"}</span>
          <strong>{fmt(resultTotal(result), s.valueUnit ?? "건")}</strong>
          <small>
            {s.valueKey
              ? s.columns.find((c) => c.key === s.valueKey)?.label
              : s.grain}
          </small>
        </div>
        {s.id === "sales-net" && (
          <>
            <div>
              <span>승인액</span>
              <strong>
                {fmt(
                  result.rows.reduce((n, r) => n + Number(r.approved), 0),
                  "원",
                )}
              </strong>
              <small>이용권 · 룸 · 사물함</small>
            </div>
            <div>
              <span>환불액</span>
              <strong>
                {fmt(
                  result.rows.reduce((n, r) => n + Number(r.refunds), 0),
                  "원",
                )}
              </strong>
              <small>원결제 지점에 귀속</small>
            </div>
          </>
        )}
        <div>
          <span>적용 범위</span>
          <strong className="dl-kpi-label">{scopeLabel(result.scope)}</strong>
          <small>{result.rows.length}개 결과 행</small>
        </div>
      </div>
      {isChart && (
        <div className="dl-visual">
          <div className="dl-section-title">
            <b>{s.title}</b>
            <small>단위: {s.valueUnit}</small>
          </div>
          <Chart result={result} />
        </div>
      )}
      {view === "heatmap" && <Heatmap result={result} />}
      {view === "seats" && <SeatMap result={result} />}
      {view === "calendar" && ["rooms", "attendance"].includes(s.domainId) && (
        <WeekCalendar result={result} />
      )}
      {view === "calendar" && !["rooms", "attendance"].includes(s.domainId) && (
        <div className="dl-agenda" aria-label="일정 보기">
          {result.rows.map((r) => (
            <div key={r.id}>
              <time>{r.date}</time>
              <span>
                <b>{r.label}</b>
                <small>{r.time ?? r.end ?? ""}</small>
              </span>
              <em>{r.status}</em>
            </div>
          ))}
        </div>
      )}
      {(view === "list" || view === "timeline") && (
        <div className={`dl-list ${view === "timeline" ? "dl-timeline" : ""}`}>
          {visible.map((r) => (
            <button
              key={r.id}
              onClick={() => setDetail(r.id)}
              disabled={readOnly}
            >
              <i />
              <span>
                <b>{r.label}</b>
                <small>
                  {r.date} {r.action ?? r.owner ?? ""}
                </small>
              </span>
              <em>{r.status ?? "상세"}</em>
            </button>
          ))}
        </div>
      )}
      <div className="dl-table-wrap">
        <table>
          <caption className="dl-sr">{s.title}의 근거 데이터</caption>
          <thead>
            <tr>
              {s.columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={
                    sort.key === c.key
                      ? sort.desc
                        ? "descending"
                        : "ascending"
                      : "none"
                  }
                >
                  <button
                    disabled={readOnly}
                    onClick={() => {
                      setSort({
                        key: c.key,
                        desc: sort.key === c.key ? !sort.desc : false,
                      });
                      setPage(0);
                    }}
                  >
                    {c.label}{" "}
                    {sort.key === c.key ? (sort.desc ? "↓" : "↑") : "↕"}
                  </button>
                </th>
              ))}
              {!readOnly && <th scope="col">상세</th>}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id}>
                {s.columns.map((c, i) => (
                  <td key={c.key}>
                    {i === 0 ? (
                      <b>{fmt(r[c.key] ?? "—", c.unit)}</b>
                    ) : (
                      fmt(r[c.key] ?? "—", c.unit)
                    )}
                  </td>
                ))}
                {!readOnly && (
                  <td>
                    <button
                      className="dl-text-button"
                      aria-label={`${r.label} 상세보기`}
                      onClick={() => setDetail(r.id)}
                    >
                      열기 ↗
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!result.rows.length && (
        <p className="dl-empty">결과 없음 · 적용 조건을 확인해 주세요.</p>
      )}
      <div className="dl-pagination">
        <small>
          {result.rows.length ? page * 5 + 1 : 0}–
          {Math.min((page + 1) * 5, result.rows.length)} / {result.rows.length}
          행
        </small>
        <div>
          <button
            disabled={page === 0 || readOnly}
            onClick={() => setPage((n) => n - 1)}
          >
            이전
          </button>
          <span>
            {page + 1} / {Math.max(1, Math.ceil(result.rows.length / 5))}
          </span>
          <button
            disabled={(page + 1) * 5 >= result.rows.length || readOnly}
            onClick={() => setPage((n) => n + 1)}
          >
            다음
          </button>
        </div>
      </div>
      {selected && (
        <section className="dl-detail" aria-label="조회 항목 상세">
          <div className="dl-section-title">
            <b>{selected.label} 상세</b>
            <button onClick={() => setDetail(null)}>닫기</button>
          </div>
          <dl>
            {s.columns.map((c) => (
              <div key={c.key}>
                <dt>{c.label}</dt>
                <dd>{fmt(selected[c.key] ?? "—", c.unit)}</dd>
              </div>
            ))}
          </dl>
          <small>허용된 조회 필드만 표시한 가상 레코드입니다.</small>
        </section>
      )}
      {!readOnly && s.id === "sales-net" && onFollowup && (
        <div className="dl-followups">
          <span>이어서 질문</span>
          <button onClick={() => onFollowup("gangnam")}>강남점만 보기 ↗</button>
          <button onClick={() => onFollowup("seongsu")}>성수점만 보기 ↗</button>
        </div>
      )}
      <footer className="dl-source">
        <span>기준 {DEMO_CLOCK}</span>
        <span>DB·엔진 미연결</span>
      </footer>
      <details className="dl-developer">
        <summary>
          개발자 보기 <span>DB · QuerySpec · ViewSpec</span>
        </summary>
        <div className="dl-developer-body">
          <p>
            <b>지표 정의</b> {s.metric}
          </p>
          <p>
            <b>API 준비 상태</b> {d.readiness}
          </p>
          <p>
            <b>권한</b> {d.policy}
          </p>
          <ul>
            {d.sources.map((ref) => (
              <li key={ref.table}>
                <code>{ref.table}</code> · {ref.fields.join(", ")}
              </li>
            ))}
          </ul>
          <p>{d.relations.join(" / ")}</p>
          <p>연동 협의용 초안 · 정식 엔진 스키마와 차이가 있습니다.</p>
          <h4>QuerySpec</h4>
          <pre>{JSON.stringify(result.querySpec, null, 2)}</pre>
          <h4>ViewSpec</h4>
          <pre>{JSON.stringify(result.viewSpec, null, 2)}</pre>
        </div>
      </details>
    </section>
  );
}
