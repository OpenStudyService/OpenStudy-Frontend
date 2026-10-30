import { api, queryString } from "../../shared/api/client";
import type {
  Customer,
  CustomerCreate,
  CustomerFilters,
  CustomerPage,
  CustomerStatusChange,
  CustomerUpdate,
} from "./model";

/** Shared by customer management and payment customer selection (#20). No legacy /members DTO leaks out. */
export const customerApi = {
  list(scope: string, filters: Partial<CustomerFilters>, signal: AbortSignal) {
    return api<CustomerPage>(
      `/customers?${queryString({ scope, ...filters })}`,
      { signal },
    );
  },
  detail(scope: string, id: string, signal: AbortSignal) {
    return api<Customer>(
      `/customers/${encodeURIComponent(id)}?${queryString({ scope })}`,
      { signal },
    );
  },
  create(
    scope: string,
    body: CustomerCreate,
    signal: AbortSignal,
    key: string,
  ) {
    return api<Customer>(`/customers?${queryString({ scope })}`, {
      method: "POST",
      body,
      key,
      signal,
    });
  },
  update(scope: string, id: string, body: CustomerUpdate, signal: AbortSignal) {
    return api<Customer>(
      `/customers/${encodeURIComponent(id)}?${queryString({ scope })}`,
      { method: "PATCH", body, signal },
    );
  },
  changeStatus(
    scope: string,
    id: string,
    body: CustomerStatusChange,
    signal: AbortSignal,
  ) {
    return api<Customer>(
      `/customers/${encodeURIComponent(id)}/status?${queryString({ scope })}`,
      { method: "POST", body, signal },
    );
  },
};
