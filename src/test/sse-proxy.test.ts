// @vitest-environment node
import http from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it } from "vitest";
import { createServer } from "vite";
import { configureSseProxy } from "../../scripts/sse-proxy.ts";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups.length = 0;
});

async function listen(server: http.Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return (server.address() as AddressInfo).port;
}

async function stream(contentType = "text/event-stream") {
  let upstream!: http.ServerResponse;
  const upstreamPort = await listen(
    http.createServer((_request, response) => {
      upstream = response;
      response.writeHead(200, { "Content-Type": contentType });
      response.write("first\n");
    }),
  );
  const vite = await createServer({
    configFile: false,
    server: {
      middlewareMode: true,
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${upstreamPort}`,
          configure: configureSseProxy,
        },
      },
    },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: "silent",
  });
  cleanups.push(() => vite.close());
  const proxyPort = await listen(http.createServer(vite.middlewares));
  const request = http.get(
    `http://127.0.0.1:${proxyPort}/api/workspace/events`,
  );
  cleanups.push(async () => request.destroy());
  const [downstream] = (await once(request, "response")) as [
    http.IncomingMessage,
  ];
  // Abrupt SSE termination is expected to produce an HTTP stream error.
  downstream.on("error", () => undefined);
  const chunks: string[] = [];
  downstream.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
  await once(downstream, "data");
  return { upstream, downstream, chunks };
}

it("closes the browser-facing SSE response when the upstream aborts", async () => {
  const { upstream, downstream } = await stream();
  const closed = new Promise<void>((resolve) =>
    downstream.once("close", resolve),
  );
  upstream.destroy();
  await closed;
  expect(downstream.destroyed).toBe(true);
  expect(downstream.complete).toBe(false);
});

it("keeps live SSE data flowing and forwards normal completion", async () => {
  const { upstream, downstream, chunks } = await stream();
  const next = once(downstream, "data");
  upstream.write("second\n");
  await next;
  expect(downstream.destroyed).toBe(false);
  const ended = once(downstream, "end");
  upstream.end("last\n");
  await ended;
  expect(chunks.join("")).toBe("first\nsecond\nlast\n");
  expect(downstream.complete).toBe(true);
});

it("preserves normal non-SSE HTTP responses", async () => {
  const { upstream, downstream, chunks } = await stream("application/json");
  const ended = once(downstream, "end");
  upstream.end("last\n");
  await ended;
  expect(chunks.join("")).toBe("first\nlast\n");
  expect(downstream.complete).toBe(true);
});
