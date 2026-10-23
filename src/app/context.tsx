import { useQuery } from "@tanstack/react-query";
import { useOutletContext } from "react-router";
import { api, ApiError } from "../shared/api/client";
import type { CurrentUser, LookupData } from "../shared/domain/schema";
import { asCollections } from "../shared/api/read-model";
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
const lookupCollections: Omit<LookupData, "preview"> = {
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
export const emptyLookups: LookupData = lookupCollections;

export function normalizeLookups(value: unknown): LookupData {
  return {
    ...asCollections(lookupCollections, value),
    preview:
      !!value &&
      typeof value === "object" &&
      "preview" in value &&
      value.preview === true,
  };
}
