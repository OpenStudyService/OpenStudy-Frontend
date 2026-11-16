import { CustomerMergeErrorLink } from "../customers/CustomerMergeErrorLink";
import { useDraftGuard } from "../../shared/ui/leaveGuard";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "../../app/context";
import { api, ApiError, queryString } from "../../shared/api/client";
import { readAllPages } from "../../shared/api/read-sorted-pages";
import type { ProductPage } from "../products/model";
import { saleAvailability, saleMessages } from "../../shared/domain/sale";
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
import { PaymentCustomerPicker } from "./PaymentCustomerPicker";
import { useSubmission } from "./useSubmission";
import { MockPaymentNotice, dateTime, useSalesClock } from "./shared";

export function PaymentCreate({
  onSaved,
  onBusyChange,
}: {
  onSaved: (payment: Payment) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { session, scope } = useApp();
  const now = useSalesClock();
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
  const [method, setMethod] = useState<CreateBody["method"]>("카드");
  const [mockOutcome, setMockOutcome] =
    useState<CreateBody["mockOutcome"]>("APPROVED");
  const leave = useDraftGuard({
    branchId,
    customerId,
    productId,
    method,
    mockOutcome,
  });
  const [validation, setValidation] = useState("");
  const write = useSubmission<CreateBody, Payment>(
    `payments:create:${session.user.id}`,
    createPayment,
  );
  const products = useQuery({
    queryKey: ["data", session.user.id, branchId, "products", "sale-selection"],
    queryFn: ({ signal }) =>
      readAllPages(
        async (page, pageSize) => {
          const result = await api<ProductPage>(
            `/products?${queryString({
              scope: branchId,
              status: "판매 중",
              page,
              pageSize,
              sort: "name",
              direction: "asc",
            })}`,
            { signal },
          );
          return { items: result.items, total: result.meta.total };
        },
        (product) => product.id,
      ),
    enabled: !!branchId,
    retry: false,
  });
  const saleProducts = products.data?.filter(
    (product) =>
      product.status === "판매 중" && product.branchIds.includes(branchId),
  );
  const selected = saleProducts?.find((product) => product.id === productId);
  const availability =
    selected?.soldQuantity === undefined
      ? selected?.saleAvailability
      : saleAvailability(selected, now, selected.soldQuantity);
  const saleCode =
    availability === "판매 전" || availability === "판매 종료"
      ? "PRODUCT_NOT_IN_SALE_PERIOD"
      : availability === "한도 소진"
        ? "PRODUCT_SALE_LIMIT_REACHED"
        : "";
  const errorCode =
    write.error instanceof ApiError ? write.error.detail.code : "";
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || write.pending || products.isError || saleCode)
      return;
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
      if (result && mounted.current) {
        leave.saved();
        onSaved(result);
      }
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
      {leave.guard}
      <MockPaymentNotice />
      <fieldset disabled={write.pending} className="contents">
        <Field label="판매 지점">
          <select
            value={branchId}
            required
            onChange={(e) => {
              setBranchId(e.target.value);
              setProductId("");
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
        <PaymentCustomerPicker
          mode="sale"
          value={customerId}
          onChange={setCustomerId}
        />
        <Field label="판매 상품">
          <select
            value={productId}
            required
            disabled={!saleProducts?.length || products.isError}
            onChange={(e) => setProductId(e.target.value)}
          >
            <option value="">
              {!branchId
                ? "판매 지점을 먼저 선택해 주세요"
                : products.isPending
                  ? "상품을 불러오는 중이에요"
                  : products.isError
                    ? "상품을 불러오지 못했어요"
                    : saleProducts?.length
                      ? "상품을 선택해 주세요"
                      : "판매 중인 상품이 없어요"}
            </option>
            {saleProducts?.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} · {product.terms.kind}
              </option>
            ))}
          </select>
        </Field>
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
      {saleCode && <FieldError>{saleMessages[saleCode]}</FieldError>}
      {validation && <FieldError>{validation}</FieldError>}
      <CustomerMergeErrorLink error={write.error} />
      {write.error && (
        <FieldError>
          {saleMessages[errorCode] ?? write.error.message} 입력을 유지했어요.
          같은 내용으로 다시 제출하면 동일한 요청으로 재시도합니다.
        </FieldError>
      )}
      <Button
        type="submit"
        variant="primary"
        disabled={
          write.pending ||
          products.isError ||
          !selected ||
          !customerId ||
          !branchId ||
          !!saleCode
        }
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
