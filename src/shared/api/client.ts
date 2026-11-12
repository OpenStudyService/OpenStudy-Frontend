import type { components } from "./foundation.generated";
// Transport failures and legacy mock responses may have no server request ID.
export type ErrorBody = Omit<components["schemas"]["ApiError"], "requestId"> & {
  requestId?: string;
  mergedIntoCustomerId?: string | null;
  closureId?: string | null;
  closingId?: string | null;
  closedDate?: string | null;
  salesStartsAt?: string | null;
  salesEndsAt?: string | null;
  salesLimit?: number | null;
  soldQuantity?: number | null;
};
export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: ErrorBody,
    public retryAfter?: string,
  ) {
    super(
      detail.requestId
        ? `${detail.message} (요청 ID: ${detail.requestId})`
        : detail.message,
    );
  }
}
export const MOCK = import.meta.env.VITE_API_MODE === "mock";
export const API_BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(
  /\/$/,
  "",
);
let privateRequests = new AbortController();
export function abortPrivateRequests() {
  privateRequests.abort();
  privateRequests = new AbortController();
}
let csrfPromise: Promise<string> | undefined;
export function clearCsrf() {
  csrfPromise = undefined;
}
async function fetchCsrf(options?: RequestOptions) {
  const data = await api<{ token: string }>("/auth/csrf", options);
  if (typeof data?.token !== "string" || !data.token) {
    throw new ApiError(0, {
      code: "INVALID_RESPONSE",
      message: "인증 준비에 실패했습니다.",
    });
  }
  return data.token;
}
/** The session CSRF token, fetched once and cached; non-GET requests must send it as X-CSRF-Token. */
export async function csrf() {
  if (csrfPromise) return csrfPromise;
  const request = fetchCsrf().catch((e) => {
    if (csrfPromise === request) clearCsrf();
    throw e;
  });
  csrfPromise = request;
  return request;
}
type RequestOptions = {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  key?: string;
  scope?: "session" | "public";
};

async function request(path: string, options: RequestOptions, accept: string) {
  const isPublic = options.scope === "public";
  const signal = isPublic
    ? options.signal
    : options.signal
      ? AbortSignal.any([privateRequests.signal, options.signal])
      : privateRequests.signal;
  signal?.throwIfAborted();
  const method = (options.method || "GET").toUpperCase(),
    headers: Record<string, string> = { Accept: accept };
  const multipart = options.body instanceof FormData;
  if (options.body !== undefined && !multipart)
    headers["Content-Type"] = "application/json";
  if (!["GET", "HEAD"].includes(method)) {
    headers["X-CSRF-Token"] = isPublic
      ? await fetchCsrf({ scope: "public", signal })
      : await csrf();
  }
  signal?.throwIfAborted();
  if (options.key) headers["Idempotency-Key"] = options.key;
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: "include",
      headers,
      body: multipart
        ? (options.body as FormData)
        : JSON.stringify(options.body),
      signal,
    });
  } catch (e) {
    signal?.throwIfAborted();
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, {
      code: "NETWORK_ERROR",
      message: "연결하지 못했습니다. 네트워크와 서버를 확인해 주세요.",
    });
  }
  signal?.throwIfAborted();
  if (!response.ok) {
    let detail: ErrorBody;
    try {
      const value: unknown = await response.json();
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        !("code" in value) ||
        !("message" in value) ||
        typeof value.code !== "string" ||
        typeof value.message !== "string"
      )
        throw new Error("Invalid error body");
      detail = value as ErrorBody;
    } catch {
      detail = {
        code: "HTTP_ERROR",
        message: `요청에 실패했습니다. (${response.status})`,
      };
    }
    signal?.throwIfAborted();
    const rawRequestId =
      response.headers.get("X-Request-ID") || detail.requestId;
    const requestId =
      typeof rawRequestId === "string"
        ? Array.from(rawRequestId)
            .filter(
              (char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127,
            )
            .join("")
            .slice(0, 128)
        : undefined;
    delete detail.requestId;
    detail = { ...detail, ...(requestId ? { requestId } : {}) };
    if (!isPublic && (response.status === 401 || detail.code === "CSRF_INVALID"))
      clearCsrf();
    if (!isPublic && response.status === 401 && !path.startsWith("/auth/login")) {
      abortPrivateRequests();
      window.dispatchEvent(
        new CustomEvent("openstudy:session-expired", { detail: detail.code }),
      );
    }
    throw new ApiError(
      response.status,
      detail,
      response.headers.get("Retry-After") || undefined,
    );
  }
  return { response, signal };
}

export async function api<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { response, signal } = await request(path, options, "application/json");
  const body = response.status === 204 ? "" : await response.text();
  signal?.throwIfAborted();
  if (["/auth/login", "/auth/logout", "/invitations/accept"].includes(path)) {
    clearCsrf();
    abortPrivateRequests();
  }
  return body.trim() ? (JSON.parse(body) as T) : (undefined as T);
}
export async function apiCsv(path: string, abortSignal?: AbortSignal) {
  const { response, signal } = await request(
    path,
    { signal: abortSignal },
    "text/csv, application/json",
  );
  if (
    response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !==
    "text/csv"
  )
    throw new ApiError(response.status, {
      code: "INVALID_RESPONSE",
      message: "CSV 응답을 확인할 수 없어요. 다시 시도해 주세요.",
    });
  const blob = await response.blob();
  signal?.throwIfAborted();
  return { blob, disposition: response.headers.get("Content-Disposition") };
}

export const queryString = (
  values: Record<string, string | number | readonly string[] | undefined>,
) => {
  const p = new URLSearchParams();
  Object.entries(values).forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach((item) => p.append(k, item));
    else if (v !== undefined && v !== "") p.set(k, String(v));
  });
  return p.toString();
};
