import type { QueryClient } from "@tanstack/react-query";

/** Resource is the fourth segment of workspace read keys, after user and scope. */
export function invalidateReads(
  client: QueryClient,
  userId: string,
  ...resources: string[]
) {
  return client.invalidateQueries({
    queryKey: ["data", userId],
    predicate: ({ queryKey }) =>
      resources.some((resource) => resource === queryKey[3]),
  });
}
