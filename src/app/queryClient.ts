import type { Query } from "@tanstack/react-query";
import { QueryClient } from "@tanstack/react-query";

const readTimes = new WeakMap<Query, number>();

export function lastReadAt(query: Query) {
  return readTimes.get(query) ?? 0;
}

export function createAppQueryClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        networkMode: "always",
      },
      mutations: { retry: false },
    },
  });
  client.getQueryCache().subscribe((event) => {
    if (
      event.type === "updated" &&
      event.action.type === "success" &&
      !event.action.manual
    )
      readTimes.set(event.query, event.query.state.dataUpdatedAt);
  });
  return client;
}
