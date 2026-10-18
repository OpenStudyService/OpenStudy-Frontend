import { useQuery } from "@tanstack/react-query";
import { useOutletContext } from "react-router";
import { api, ApiError } from "../shared/api/client";
import type { CurrentUser, LookupData } from "../shared/domain/schema";
export function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: ({ signal }) =>
      api<CurrentUser>("/me", { signal }).catch((e) => {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }),
    retry: false,
    staleTime: 30000,
  });
}
export interface AppContext {
  session: CurrentUser;
  scope: string;
  lookups: LookupData;
}
export const useApp = () => useOutletContext<AppContext>();
export const emptyLookups: LookupData = {
  branches: [],
  employees: [],
  members: [],
  products: [],
  passes: [],
  rooms: [],
  seats: [],
  shifts: [],
  attendance: [],
  channels: [],
};
