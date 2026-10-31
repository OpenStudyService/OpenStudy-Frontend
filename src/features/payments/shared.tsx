import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { customerApi } from "../customers/api";
import { Field, Pager } from "../organization/shared";
import { Button, ErrorState } from "../../shared/ui/primitives";

export const MOCK_PAYMENT_NOTICE = "Mock 결제·실제 금전 이동 없음";
export function MockPaymentNotice() {
  return (
    <p className="tip my-3" role="note">
      {MOCK_PAYMENT_NOTICE}
    </p>
  );
}
export function useSalesSearch() {
  const [params, setParams] = useSearchParams();
  const raw = Number(params.get("page") || 1);
  const page = Number.isSafeInteger(raw) && raw > 0 ? raw : 1;
  const update = (name: string, value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(name, value);
        else next.delete(name);
        if (name !== "page" && name !== "detail") next.delete("page");
        return next;
      },
      { replace: name !== "detail" },
    );
  return { params, page, update };
}
export function SalesPager({
  page,
  total,
  onChange,
}: {
  page: number;
  total: number;
  onChange: (page: number) => void;
}) {
  return <Pager page={page} total={total} onChange={onChange} />;
}
export function useSalesClock() {
  const { session } = useApp();
  const query = useQueryClient();
  const [anchor] = useState(() => {
    const client = Date.now();
    const server = Date.parse(session.asOf);
    const receivedAt = query.getQueryState(["session"])?.dataUpdatedAt;
    const cachedAge =
      receivedAt && Number.isFinite(receivedAt)
        ? Math.max(0, client - receivedAt)
        : 0;
    return {
      client,
      server: Number.isFinite(server) ? server + cachedAge : client,
    };
  });
  const [now, setNow] = useState(anchor.server);
  useEffect(() => {
    // Keep the server's time basis, including the demo clock, and advance it
    // while this panel is open instead of trusting the client's absolute time.
    const timer = window.setInterval(
      () => setNow(anchor.server + Math.max(0, Date.now() - anchor.client)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [anchor]);
  return now;
}
export function dateTime(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(new Date(value))
    : "—";
}
export function CustomerSelector({
  value,
  onChange,
  disabled = false,
  allowAll = false,
}: {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  allowAll?: boolean;
}) {
  const { session, scope } = useApp();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const customers = useQuery({
    queryKey: [
      "data",
      session.user.id,
      scope,
      "customers",
      "sale-selection",
      search,
      page,
    ],
    queryFn: ({ signal }) =>
      customerApi.list(
        scope,
        { q: search, page, pageSize: 20, sort: "name", direction: "asc" },
        signal,
      ),
    retry: false,
  });
  return (
    <div className="my-3">
      <Field label="고객 검색 (이름·회원번호·연락처)">
        <input
          value={search}
          disabled={disabled}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </Field>
      <Field label={allowAll ? "고객 필터" : "고객 선택"}>
        <select
          value={value}
          disabled={disabled || customers.isPending || !!customers.error}
          onChange={(e) => onChange(e.target.value)}
          required={!allowAll}
        >
          <option value="">
            {allowAll ? "전체 고객" : "고객을 선택해 주세요"}
          </option>
          {value && !customers.data?.items.some((c) => c.id === value) && (
            <option value={value}>선택 고객 · {value}</option>
          )}
          {customers.data?.items.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.memberNo} · {c.phone} · {c.status}
            </option>
          ))}
        </select>
      </Field>
      {customers.error && (
        <ErrorState
          error={customers.error}
          retry={() => void customers.refetch()}
        />
      )}
      {customers.data && (
        <div className="flex items-center gap-2 my-2">
          <Button
            type="button"
            disabled={disabled || page <= 1}
            onClick={() => setPage(page - 1)}
          >
            고객 이전
          </Button>
          <span className="help">
            {page}페이지 · 총 {customers.data.meta.total}명
          </span>
          <Button
            type="button"
            disabled={disabled || page * 20 >= customers.data.meta.total}
            onClick={() => setPage(page + 1)}
          >
            고객 다음
          </Button>
        </div>
      )}
    </div>
  );
}
