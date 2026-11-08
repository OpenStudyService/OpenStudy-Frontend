export function RankedBarChart({ rows }: { rows: Record<string, unknown>[] }) {
  const items = rows.map((r, idx) => ({
    rank: idx + 1,
    productId: String(r.product_id ?? r.productId ?? idx + 1),
    product: String(r.product ?? r.product_name ?? `상품 ${idx + 1}`),
    issuedUnits: Number(r.issued_units ?? r.issuedUnits ?? 0),
    refundedUnits: Number(r.refunded_units ?? r.refundedUnits ?? 0),
    netUnits: Number(r.net_units ?? r.netUnits ?? 0),
  }));

  const maxUnits = Math.max(1, ...items.map((i) => i.netUnits));

  return (
    <div
      className="flex flex-col gap-3"
      data-testid="viewspec-ranked-bar"
      role="region"
      aria-label="인기 이용권 TOP 5 순위 차트"
    >
      {items.map((item) => {
        const unitWidthPct = Math.max(
          0,
          Math.round((item.netUnits / maxUnits) * 100),
        );
        return (
          <div
            key={item.productId}
            className="rounded-xl border border-line bg-surface p-3.5 shadow-xs"
          >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                    item.rank === 1
                      ? "bg-primary text-white"
                      : item.rank <= 3
                        ? "bg-soft text-primary"
                        : "bg-line text-muted"
                  }`}
                >
                  {item.rank}
                </span>
                <strong className="text-sm text-ink">{item.product}</strong>
                <span className="rounded-md bg-soft px-2 py-0.5 text-[11px] font-medium text-primary">
                  순판매 {item.netUnits}건
                </span>
                {item.refundedUnits > 0 && (
                  <span className="text-[11px] text-muted">
                    (발급 {item.issuedUnits}건 · 환불 {item.refundedUnits}건)
                  </span>
                )}
              </div>
            </div>

            <div className="grid gap-1.5 text-[11px]">
              <div className="flex items-center gap-2">
                <span className="w-16 text-muted">판매 건수</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-soft">
                  <div
                    className="h-full rounded-full bg-primary/60 transition-all"
                    style={{ width: `${unitWidthPct}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
