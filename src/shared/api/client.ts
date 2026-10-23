import type { components } from "./foundation.generated";
// Transport failures and legacy mock responses may have no server request ID.
export type ErrorBody = Omit<components["schemas"]["ApiError"], "requestId"> & {
  requestId?: string;
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
let csrfPromise: Promise<string> | undefined;
export function clearCsrf() {
  csrfPromise = undefined;
}
async function csrf() {
  csrfPromise ??= api<{ token: string }>("/auth/csrf")
    .then((data) => {
      if (typeof data?.token !== "string" || !data.token) {
        throw new ApiError(0, {
          code: "INVALID_RESPONSE",
          message: "인증 준비에 실패했습니다.",
        });
      }
      return data.token;
    })
    .catch((e) => {
      csrfPromise = undefined;
      throw e;
    });
  return csrfPromise;
}
export async function api<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
    key?: string;
  } = {},
): Promise<T> {
  options.signal?.throwIfAborted();
  const method = (options.method || "GET").toUpperCase(),
    headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (!["GET", "HEAD"].includes(method)) headers["X-CSRF-Token"] = await csrf();
  options.signal?.throwIfAborted();
  if (options.key) headers["Idempotency-Key"] = options.key;
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: "include",
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, {
      code: "NETWORK_ERROR",
      message: "연결하지 못했습니다. 네트워크와 서버를 확인해 주세요.",
    });
  }
  options.signal?.throwIfAborted();
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
    options.signal?.throwIfAborted();
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
    if (response.status === 401 || detail.code === "CSRF_INVALID") clearCsrf();
    if (response.status === 401 && !path.startsWith("/auth/login"))
      window.dispatchEvent(new Event("openstudy:session-expired"));
    throw new ApiError(
      response.status,
      detail,
      response.headers.get("Retry-After") || undefined,
    );
  }
  if (["/auth/login", "/auth/logout", "/invitations/accept"].includes(path))
    clearCsrf();
  if (response.status === 204) return undefined as T;
  const body = await response.text();
  options.signal?.throwIfAborted();
  return body.trim() ? (JSON.parse(body) as T) : (undefined as T);
}
export const queryString = (
  values: Record<string, string | number | undefined>,
) => {
  const p = new URLSearchParams();
  Object.entries(values).forEach(([k, v]) => {
    if (v !== undefined && v !== "") p.set(k, String(v));
  });
  return p.toString();
};
