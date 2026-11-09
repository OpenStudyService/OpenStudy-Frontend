import { api, queryString } from "../../shared/api/client";
import { asPage } from "../../shared/api/read-model";
import type { components } from "../../shared/api/foundation.generated";
import { requestApi } from "./request-api";

type Schemas = components["schemas"];
export type LeaveRequest = Schemas["LeaveRequest"];
export type LeaveGrant = Schemas["LeaveGrant"];
export type LeaveGrantDetail = Schemas["LeaveGrantDetail"];
export type LeaveRequestCreate = Schemas["LeaveRequestCreate"];
export type LeaveGrantCreate = Schemas["LeaveGrantCreate"];

export const leaveRequests = requestApi<LeaveRequest>("/leave-requests");
export const leaveBalance = (employeeId?: string, signal?: AbortSignal) =>
  api<Schemas["LeaveBalance"]>(
    employeeId
      ? `/employees/${encodeURIComponent(employeeId)}/leave-balance`
      : "/me/leave-balance",
    { signal },
  );
export const leaveGrants = async (
  scope: string,
  page: number,
  signal?: AbortSignal,
) =>
  asPage<LeaveGrant>(
    await api(
      `/leave-grants?${queryString({ scope, page, pageSize: 20, includeExpired: "true" })}`,
      { signal },
    ),
  );
export const leaveGrantDetail = (id: string, signal?: AbortSignal) =>
  api<LeaveGrantDetail>(`/leave-grants/${encodeURIComponent(id)}`, { signal });

export function calendarDays(start: string, end: string) {
  return (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
}
