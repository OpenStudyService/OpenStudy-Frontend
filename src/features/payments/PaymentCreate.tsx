import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { api, queryString } from "../../shared/api/client";
import type { components } from "../../shared/api/foundation.generated";
import { can, won } from "../../shared/domain/schema";
import {
  Button,
  ErrorState,
  FieldError,
  State,
} from "../../shared/ui/primitives";
import { Field } from "../organization/shared";
import { createPayment } from "./api";
import type { Payment, PaymentCreate as CreateBody } from "./model";
import { useSubmission } from "./useSubmission";
import { CustomerSelector, MockPaymentNotice, dateTime } from "./shared";

export function PaymentCreate({
  onSaved,
  onBusyChange,
}: {
  onSaved: (payment: Payment) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { session, scope } = useApp();
  const mounted = useRef(true);
  const submitting = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const branches = session.branches.filter(
    (b) =>
      b.status === "운영 중" &&
      (scope === "all" || b.id === scope) &&
      can(session.user, b.id, "payments:write"),
  );
  const [branchId, setBranchId] = useState(
    branches.length === 1 ? branches[0].id : "",
  );
  const [customerId, setCustomerId] = useState("");
  const [productId, setProductId] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [productPage, setProductPage] = useState(1);
  const [method, setMethod] = useState<CreateBody["method"]>("카드");
  const [mockOutcome, setMockOutcome] =
    useState<CreateBody["mockOutcome"]>("APPROVED");
  const [validation, setValidation] = useState("");
  const write = useSubmission<CreateBody, Payment>(
    `payments:create:${session.user.id}`,
    createPayment,
  );
  const products = useQuery({
    queryKey: [
      "data",
      session.user.id,
      branchId,
      "products",
      "sale-selection",
      productSearch,
      productPage,
    ],
    queryFn: ({ signal }) =>
      api<components["schemas"]["ProductPage"]>(
        `/products?${queryString({ scope: branchId, status: "판매 중", q: productSearch, page: productPage, pageSize: 20, sort: "name", direction: "asc" })}`,
        { signal },
      ),
    enabled: !!branchId,
    retry: false,
  });
  const selected = products.data?.items.find((p) => p.id === productId);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || write.pending) return;
    if (
      !branchId ||
      !customerId ||
      !selected ||
      !branches.some((b) => b.id === branchId)
    ) {
      setValidation("고객·판매 지점·판매 중인 상품을 선택해 주세요.");
      return;
    }
    setValidation("");
    submitting.current = true;
    onBusyChange(true);
    try {
      const result = await write.run({
        customerId,
        branchId,
        productId,
        method,
        mockOutcome,
      });
      if (result && mounted.current) onSaved(result);
    } catch {
      /* The submission hook preserves the error and retry key. */
    } finally {
      submitting.current = false;
      onBusyChange(false);
    }
  }
  if (!branches.length)
    return <State title="이 지점에서 결제할 권한이 없어요" />;
  return (
    <form onSubmit={submit} className="form-grid">
      <MockPaymentNotice />
      <fieldset disabled={write.pending} className="contents">
        <Field label="판매 지점">
          <select
            value={branchId}
            required
            onChange={(e) => {
              setBranchId(e.target.value);
              setProductId("");
              setProductPage(1);
            }}
          >
            <option value="">지점을 선택해 주세요</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <CustomerSelector
          value={customerId}
          onChange={setCustomerId}
          disabled={write.pending}
        />
        <Field label="판매 상품 검색">
          <input
            value={productSearch}
            onChange={(e) => {
              setProductSearch(e.target.value);
              setProductPage(1);
              setProductId("");
            }}
          />
        </Field>
        <Field label="판매 상품">
          <select
            value={productId}
            required
            disabled={!branchId || products.isPending || !!products.error}
            onChange={(e) => setProductId(e.target.value)}
          >
            <option value="">상품을 선택해 주세요</option>
            {products.data?.items
              .filter((p) => p.branchIds.includes(branchId))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.terms.kind}
                </option>
              ))}
          </select>
        </Field>
        {products.data && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              disabled={productPage <= 1}
              onClick={() => {
                setProductPage(productPage - 1);
                setProductId("");
              }}
            >
              상품 이전
            </Button>
            <span className="help">
              {productPage}페이지 · 총 {products.data.meta.total}개
            </span>
            <Button
              type="button"
              disabled={productPage * 20 >= products.data.meta.total}
              onClick={() => {
                setProductPage(productPage + 1);
                setProductId("");
              }}
            >
              상품 다음
            </Button>
          </div>
        )}
        {products.error && (
          <ErrorState
            error={products.error}
            retry={() => void products.refetch()}
          />
        )}
        <p className="help">
          {selected
            ? `서버 상품 가격: ${won(selected.priceKrw)}. 결제 결과의 서버 산정 금액으로 확정됩니다.`
            : "금액은 서버에서 산정합니다."}
        </p>
        <Field label="결제 수단">
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as CreateBody["method"])}
          >
            {["카드", "현금", "계좌이체", "기타"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="Mock 결제 결과">
          <select
            value={mockOutcome}
            onChange={(e) =>
              setMockOutcome(e.target.value as CreateBody["mockOutcome"])
            }
          >
            <option value="APPROVED">승인</option>
            <option value="FAILED">실패</option>
          </select>
        </Field>
      </fieldset>
      {validation && <FieldError>{validation}</FieldError>}
      {write.error && (
        <FieldError>
          {write.error.message} 입력을 유지했어요. 같은 내용으로 다시 제출하면
          동일한 요청으로 재시도합니다.
        </FieldError>
      )}
      <Button
        type="submit"
        variant="primary"
        disabled={write.pending || !selected || !customerId || !branchId}
      >
        {write.pending
          ? "결제 처리 중…"
          : write.error
            ? "같은 결제 다시 시도"
            : "Mock 결제 요청"}
      </Button>
    </form>
  );
}
export function PaymentResult({ payment }: { payment: Payment }) {
  return (
    <section role="status">
      <MockPaymentNotice />
      <h3>결제 {payment.status}</h3>
      <p>서버 산정 금액: {won(payment.amountKrw)}</p>
      <p>
        {payment.customer.name} · {payment.productName}
      </p>
      <p>{dateTime(payment.approvedAt ?? payment.failedAt)}</p>
      <p>
        {payment.status === "실패"
          ? "실패 결제를 기록했으며 이용권은 발급되지 않았어요."
          : "이용권 발급을 완료했어요."}
      </p>
      <p className="help">결제 번호: {payment.id}</p>
    </section>
  );
}
