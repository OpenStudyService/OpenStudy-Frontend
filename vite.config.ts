import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { configureSseProxy } from "./scripts/sse-proxy.ts";

function buildIsolation(mode: "live" | "mock", root: string): Plugin {
  return {
    name: "openstudy-build-isolation",
    apply: "build",
    generateBundle(_options, bundle) {
      const moduleId = (id: string) =>
        id.startsWith("\0")
          ? `virtual:${id.slice(1)}`
          : relative(root, id).replaceAll("\\", "/");
      const chunks = Object.values(bundle)
        .filter((entry) => entry.type === "chunk")
        .map((chunk) => ({
          fileName: chunk.fileName,
          modules: Object.keys(chunk.modules).map(moduleId).sort(),
        }))
        .sort((a, b) => a.fileName.localeCompare(b.fileName));
      this.emitFile({
        type: "asset",
        fileName: "build-provenance.json",
        source: JSON.stringify({ schemaVersion: 1, mode, chunks }, null, 2),
      });
      if (mode === "live") {
        // Vite normally copies public/ verbatim. Keep ordinary assets, while
        // the demo service worker is emitted only by the mock build.
        const publicRoot = resolve(root, "public");
        const copyPublicAssets = (directory: string) => {
          for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = resolve(directory, entry.name);
            const fileName = relative(publicRoot, path).replaceAll("\\", "/");
            if (entry.isSymbolicLink())
              throw new Error(
                `Public assets cannot be symbolic links: ${fileName}`,
              );
            if (entry.isDirectory()) copyPublicAssets(path);
            else if (fileName !== "mockServiceWorker.js")
              this.emitFile({
                type: "asset",
                fileName,
                source: readFileSync(path),
              });
          }
        };
        copyPublicAssets(publicRoot);
      }
    },
  };
}

export default defineConfig(({ mode, command, isPreview }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const buildMode = mode === "live" || mode === "mock" ? mode : undefined;
  if (command === "build" && !buildMode)
    throw new Error("Use --mode live or --mode mock for an OpenStudy build.");
  if (buildMode && env.VITE_API_MODE !== buildMode)
    throw new Error(
      `VITE_API_MODE must be ${buildMode} when --mode ${buildMode} is selected.`,
    );
  if (!buildMode && command === "serve" && !isPreview && mode !== "test")
    throw new Error(
      "Use npm run dev:live or npm run dev to select an API mode.",
    );
  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(buildMode ? [buildIsolation(buildMode, process.cwd())] : []),
    ],
    // The live plugin copies approved public assets without the demo worker.
    publicDir: command === "build" && buildMode === "live" ? false : "public",
    server: {
      proxy: {
        "/api": {
          target: env.API_PROXY_TARGET || "http://localhost:8080",
          changeOrigin: true,
          configure: configureSseProxy,
        },
      },
    },
    build: {
      outDir: buildMode === "mock" ? "dist-demo" : "dist",
      // Source maps include removed source text, including demo-only branches.
      sourcemap: buildMode === "mock",
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      include: ["src/**/*.test.{ts,tsx}"],
      restoreMocks: true,
    },
  };
});
