import type { components } from "./generated";
export type ErrorBody = components["schemas"]["ApiError"];
export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: ErrorBody,
  ) {
    super(detail.message);
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
  csrfPromise ??= fetch(`${API_BASE}/auth/csrf`, { credentials: "include" })
    .then(async (r) => {
      if (!r.ok) throw new Error("인증 준비에 실패했습니다.");
      const data = (await r.json()) as { token: string };
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
  const method = options.method || "GET",
    headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (!["GET", "HEAD"].includes(method)) headers["X-CSRF-Token"] = await csrf();
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
  if (!response.ok) {
    let detail: ErrorBody;
    try {
      detail = (await response.json()) as ErrorBody;
    } catch {
      detail = {
        code: "HTTP_ERROR",
        message: `요청에 실패했습니다. (${response.status})`,
      };
    }
    if (response.status === 401 || detail.code === "CSRF_INVALID") clearCsrf();
    if (response.status === 401 && !path.startsWith("/auth/login"))
      window.dispatchEvent(new Event("openstudy:session-expired"));
    throw new ApiError(response.status, detail);
  }
  if (["/auth/login", "/auth/logout", "/invitations/accept"].includes(path))
    clearCsrf();
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
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
