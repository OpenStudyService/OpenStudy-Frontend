import type { ProxyOptions } from "vite";

/** Let EventSource detect a dev-proxy upstream interruption and reconnect. */
export const configureSseProxy: NonNullable<ProxyOptions["configure"]> = (
  proxy,
) => {
  proxy.on("proxyRes", (upstream, _request, downstream) => {
    if (!upstream.headers["content-type"]?.startsWith("text/event-stream"))
      return;
    // pipe() forwards normal end, but not an aborted upstream response.
    upstream.once("aborted", () => downstream.destroy());
  });
};
