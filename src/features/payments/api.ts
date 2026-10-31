import { api, queryString } from "../../shared/api/client";
import type {
  Pass,
  PassFilters,
  PassPage,
  Payment,
  PaymentCreate,
  PaymentFilters,
  PaymentPage,
  RefundCreate,
} from "./model";

export function listPayments(filters: PaymentFilters, signal?: AbortSignal) {
  return api<PaymentPage>(`/payments?${queryString(filters)}`, { signal });
}

export function getPayment(id: string, scope = "all", signal?: AbortSignal) {
  return api<Payment>(
    `/payments/${encodeURIComponent(id)}?${queryString({ scope })}`,
    { signal },
  );
}

export function createPayment(body: PaymentCreate, key: string) {
  // Prices and issued conditions belong to the server, never to the form.
  const { customerId, branchId, productId, method, mockOutcome } = body;
  return api<Payment>(`/payments?${queryString({ scope: branchId })}`, {
    method: "POST",
    body: { customerId, branchId, productId, method, mockOutcome },
    key,
  });
}

export function refundPayment(
  id: string,
  body: RefundCreate,
  key: string,
  scope = "all",
) {
  return api<Payment>(
    `/payments/${encodeURIComponent(id)}/refund?${queryString({ scope })}`,
    {
      method: "POST",
      body: { reason: body.reason },
      key,
    },
  );
}

export function listPasses(filters: PassFilters, signal?: AbortSignal) {
  return api<PassPage>(`/passes?${queryString(filters)}`, { signal });
}

export function getPass(id: string, scope = "all", signal?: AbortSignal) {
  return api<Pass>(
    `/passes/${encodeURIComponent(id)}?${queryString({ scope })}`,
    { signal },
  );
}
