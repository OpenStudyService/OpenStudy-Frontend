import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const manifestName = "build-provenance.json";
const javascript = /\.(?:[cm]?js)$/i;
const workerName = /(?:^|\/)mockServiceWorker\.js$/i;
const forbiddenModules = [
  ["mock application module", /(?:^|\/)src\/mocks(?:\/|$)/i],
  ["MSW dependency", /(?:^|\/)node_modules\/(?:msw(?:\/|$)|@mswjs\/)/i],
];
const forbiddenRuntime = [
  [
    "MSW runtime",
    /\[MSW\]|mswjs\.io|INTEGRITY_CHECK_REQUEST|MOCK_ACTIVATE|MOCK_DEACTIVATE|\bsetupWorker\b/,
  ],
  ["demo API", /\/_demo\b/],
  ["mock ledger", /openstudy-mock-v1|\bMockStore\b/],
  [
    "arbitrary failure control",
    /\bsimulateFailure\b|승인 실패 재현|결제 실패 재현/,
  ],
  [
    "demo persona controls",
    /사장님으로 체험|직원으로 체험|관리자로 체험|데모·검증 도구|체험 계정|세션 만료 재현|정상 응답 복원/,
  ],
];

function normalizedModule(id) {
  return id.replaceAll("\\", "/").replaceAll("\0", "");
}
function decodeEscapes(text) {
  // The emitted bundle can escape localized UI text or ASCII markers.
  return text.replace(
    /\\(?:u\{([0-9a-f]{1,6})\}|u([0-9a-f]{4})|x([0-9a-f]{2}))/gi,
    (original, brace, unicode, ascii) => {
      const code = Number.parseInt(brace || unicode || ascii, 16);
      return code <= 0x10ffff ? String.fromCodePoint(code) : original;
    },
  );
}
function relativeFile(name) {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    !name.includes("\\") &&
    !path.posix.isAbsolute(name) &&
    !/^[a-z]:/i.test(name) &&
    name.split("/").every((part) => part && part !== "." && part !== "..")
  );
}

async function artifactFiles(directory) {
  const files = new Map();
  async function visit(current, prefix = "") {
    const info = await lstat(current);
    if (info.isSymbolicLink())
      throw new Error(
        `Symlinks are not accepted in build output: ${prefix || directory}`,
      );
    if (!info.isDirectory())
      throw new Error(`Build output is not a directory: ${directory}`);
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`Symlinks are not accepted in build output: ${name}`);
      if (entry.isDirectory()) await visit(absolute, name);
      else if (entry.isFile()) files.set(name, await readFile(absolute));
      else throw new Error(`Unsupported build artifact: ${name}`);
    }
  }
  await visit(directory);
  return files;
}

/** Inspect the entire emitted directory, including lazy chunks and copied assets. */
export async function checkBuild(directory, mode) {
  if (mode !== "live" && mode !== "mock")
    throw new Error("Build mode must be exactly live or mock.");
  const resolved = path.resolve(directory);
  const files = await artifactFiles(resolved);
  const failures = [];
  if (!files.get("index.html")?.length)
    failures.push("Missing or empty index.html.");
  let manifest;
  try {
    manifest = JSON.parse(files.get(manifestName)?.toString("utf8") || "");
  } catch {
    failures.push(
      `Missing or invalid ${manifestName}. Build through the configured Vite pipeline.`,
    );
  }
  const chunks = new Set();
  const modules = [];
  {
    if (
      !manifest ||
      typeof manifest !== "object" ||
      Array.isArray(manifest) ||
      manifest.schemaVersion !== 1 ||
      manifest.mode !== mode ||
      !Array.isArray(manifest.chunks) ||
      !manifest.chunks.length
    ) {
      failures.push(
        `Invalid provenance schema, mode, or empty chunk list in ${manifestName}.`,
      );
    } else {
      for (const chunk of manifest.chunks) {
        if (
          !chunk ||
          !relativeFile(chunk.fileName) ||
          !javascript.test(chunk.fileName) ||
          !Array.isArray(chunk.modules) ||
          !chunk.modules.length ||
          !chunk.modules.every((id) => typeof id === "string" && id.length > 0)
        ) {
          failures.push(`Invalid chunk provenance in ${manifestName}.`);
          continue;
        }
        if (chunks.has(chunk.fileName))
          failures.push(`Duplicate chunk provenance: ${chunk.fileName}`);
        chunks.add(chunk.fileName);
        if (!files.get(chunk.fileName)?.length)
          failures.push(`Missing or empty emitted chunk: ${chunk.fileName}`);
        modules.push(...chunk.modules.map(normalizedModule));
      }
    }
  }
  for (const [name, bytes] of files) {
    const text = decodeEscapes(bytes.toString("utf8"));
    if (
      javascript.test(name) &&
      !chunks.has(name) &&
      !(mode === "mock" && workerName.test(name))
    ) {
      failures.push(`JavaScript artifact is absent from provenance: ${name}`);
    }
    if (mode === "live") {
      if (workerName.test(name))
        failures.push(`MSW worker artifact in live output: ${name}`);
      if (/\.map$/i.test(name))
        failures.push(`Source map in live output: ${name}`);
      for (const [label, pattern] of forbiddenRuntime) {
        if (pattern.test(text))
          failures.push(`${label} in live artifact: ${name}`);
      }
    }
  }
  if (mode === "live") {
    for (const id of modules) {
      for (const [label, pattern] of forbiddenModules) {
        if (pattern.test(id))
          failures.push(`${label} in live chunk provenance: ${id}`);
      }
    }
  } else {
    const allText = [...files.values()]
      .map((bytes) => bytes.toString("utf8"))
      .join("\n");
    const worker = [...files].find(([name]) => workerName.test(name));
    if (
      !worker ||
      !worker[1].toString("utf8").includes("INTEGRITY_CHECK_REQUEST")
    )
      failures.push("Mock output is missing the functional MSW worker.");
    if (!modules.some((id) => /(?:^|\/)src\/mocks\//i.test(id)))
      failures.push("Mock output has no mock application modules.");
    if (!modules.some((id) => /(?:^|\/)node_modules\/msw\//i.test(id)))
      failures.push("Mock output has no MSW dependency.");
    if (!allText.includes("/_demo"))
      failures.push("Mock output has no demo API controls.");
    if (!allText.includes("openstudy-mock-v1"))
      failures.push("Mock output has no mock ledger.");
  }
  if (failures.length)
    throw new Error(
      `Build verification failed (${mode}):\n${[...new Set(failures)].map((message) => `- ${message}`).join("\n")}`,
    );
  return {
    mode,
    directory: resolved,
    fileCount: files.size,
    chunkCount: chunks.size,
  };
}

export function parseArguments(args) {
  if (
    args.length !== 3 ||
    args[0] !== "--mode" ||
    !["live", "mock"].includes(args[1]) ||
    !args[2] ||
    args[2].startsWith("--")
  ) {
    throw new Error(
      "Usage: node scripts/check-build.mjs --mode <live|mock> <output-directory>",
    );
  }
  return { mode: args[1], directory: args[2] };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { mode, directory } = parseArguments(process.argv.slice(2));
    const report = await checkBuild(directory, mode);
    process.stdout.write(
      `[build-check] ${mode}: ${report.fileCount} files and ${report.chunkCount} chunks verified.\n`,
    );
  } catch (error) {
    process.stderr.write(`[build-check] ${error.message}\n`);
    process.exitCode = 1;
  }
}
