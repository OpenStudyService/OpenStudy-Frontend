import { api, queryString } from "../../shared/api/client";
import { asPage } from "../../shared/api/read-model";
import type { components } from "../../shared/api/foundation.generated";

type Schemas = components["schemas"];
export type Correction = Schemas["AttendanceCorrection"];
export type Swap = Schemas["ShiftSwap"];
export type RequestConflict = Schemas["WorkforceRequestConflictError"];

export function requestApi<T>(path: string) {
  return {
    list: async (scope: string, page: number, signal?: AbortSignal) =>
      asPage<T>(
        await api(`${path}?${queryString({ scope, page, pageSize: 20 })}`, {
          signal,
        }),
      ),
    command: (id: string, action: string, body: { version: number }) =>
      api<T>(`${path}/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        body,
      }),
  };
}

export const corrections = requestApi<Correction>("/attendance-corrections");
export const swaps = requestApi<Swap>("/shift-swaps");

export function createRequest<T>(path: string, body: T, key: string) {
  return api(path, { method: "POST", body, key });
}
