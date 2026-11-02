import { build } from "vite";
import react from "@vitejs/plugin-react";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const output = await build({
  configFile: false,
  publicDir: false,
  plugins: [react()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    write: false,
    minify: true,
    cssCodeSplit: false,
    sourcemap: false,
    lib: {
      entry: resolve("src/mocks/domainlenz/Standalone.tsx"),
      name: "OpenStudyDomainLenz",
      formats: ["iife"],
    },
  },
});
const chunks = (Array.isArray(output) ? output : [output]).flatMap((item) =>
  "output" in item ? item.output : [],
);
const js = chunks
  .filter((item) => item.type === "chunk")
  .map((item) => item.code)
  .join("\n");
const css = chunks
  .filter((item) => item.type === "asset" && item.fileName.endsWith(".css"))
  .map((item) =>
    typeof item.source === "string"
      ? item.source
      : new TextDecoder().decode(item.source),
  )
  .join("\n");
if (!js || !css)
  throw new Error("Standalone output must contain both JS and CSS");
// Radix embeds scroll-lock CSS in a template literal. Whitespace-only CSS lines
// have no effect, and removing their spaces keeps the generated diff clean.
const html =
  `<!doctype html>\n<html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>OpenStudy × DomainLenz — 채팅 데모</title><style>${css.replaceAll("</style", "<\\/style")}</style></head><body><div id="root"></div><script>${js.replaceAll("</script", "<\\/script")}</script></body></html>\n`.replace(
    /^[ \t]+$/gm,
    "",
  );
await mkdir("docs/domainlenz", { recursive: true });
await writeFile("docs/domainlenz/OpenStudy_DomainLenz_Demo.html", html, "utf8");
console.log(
  `Standalone HTML: ${Buffer.byteLength(html).toLocaleString()} bytes; all assets embedded.`,
);
