import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { afterEach, test } from "node:test";
import { checkBuild, parseArguments } from "./check-build.mjs";

const temporary = [];
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((directory) => {
      const absolute = path.resolve(directory);
      assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()));
      assert.ok(path.basename(absolute).startsWith("openstudy-build-check-"));
      return rm(absolute, { recursive: true, force: true });
    }),
  );
});
async function fixture(mode = "live") {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "openstudy-build-check-"),
  );
  temporary.push(directory);
  await mkdir(path.join(directory, "assets"));
  await writeFile(
    path.join(directory, "index.html"),
    '<div id="root"></div><script type="module" src="/assets/app.js"></script>',
  );
  await writeFile(
    path.join(directory, "assets/app.js"),
    'console.log("Mock 결제·실제 금전 이동 없음");const mockOutcome="FAILED";',
  );
  const manifest = {
    schemaVersion: 1,
    mode,
    chunks: [
      {
        fileName: "assets/app.js",
        modules: [
          "src/main.tsx",
          "src/features/payments/PaymentCreate.tsx",
          "node_modules/react/index.js",
        ],
      },
    ],
  };
  if (mode === "mock") {
    manifest.chunks[0].modules.push(
      "src/mocks/browser.ts",
      "src/mocks/store.ts",
      "node_modules/msw/lib/browser/index.mjs",
    );
    await writeFile(
      path.join(directory, "assets/app.js"),
      'fetch("/_demo");sessionStorage.getItem("openstudy-mock-v1");',
    );
    await writeFile(
      path.join(directory, "mockServiceWorker.js"),
      'const event="INTEGRITY_CHECK_REQUEST";',
    );
  }
  await writeFile(
    path.join(directory, "build-provenance.json"),
    JSON.stringify(manifest),
  );
  return directory;
}
async function changeManifest(directory, change) {
  const file = path.join(directory, "build-provenance.json");
  const manifest = JSON.parse(await readFile(file, "utf8"));
  change(manifest);
  await writeFile(file, JSON.stringify(manifest));
}

test("accepts a live payment bundle including official Mock outcomes and stale-worker cleanup URL", async () => {
  const directory = await fixture();
  await writeFile(
    path.join(directory, "assets/cleanup.js"),
    'registration.active.scriptURL.endsWith("/mockServiceWorker.js");',
  );
  await changeManifest(directory, (manifest) =>
    manifest.chunks.push({
      fileName: "assets/cleanup.js",
      modules: ["src/shared/api/worker-cleanup.ts"],
    }),
  );
  const result = await checkBuild(directory, "live");
  assert.equal(result.chunkCount, 2);
  assert.equal(result.fileCount, 4);
});

test("accepts the mock build only when worker, MSW, demo controls and ledger are all present", async () => {
  const directory = await fixture("mock");
  assert.equal((await checkBuild(directory, "mock")).mode, "mock");
  await rm(path.join(directory, "mockServiceWorker.js"));
  await assert.rejects(checkBuild(directory, "mock"), /functional MSW worker/);
});

test("rejects missing output, invalid arguments and invalid modes instead of silently scanning nothing", async () => {
  assert.deepEqual(parseArguments(["--mode", "live", "dist"]), {
    mode: "live",
    directory: "dist",
  });
  for (const args of [
    [],
    ["dist"],
    ["--mode", "production", "dist"],
    ["--mode", "live", "dist", "--unknown"],
  ])
    assert.throws(() => parseArguments(args), /Usage:/);
  const directory = await fixture();
  await assert.rejects(
    checkBuild(directory, "production"),
    /exactly live or mock/,
  );
  await assert.rejects(
    checkBuild(path.join(directory, "missing"), "live"),
    /ENOENT/,
  );
});

test("rejects a missing or malformed provenance manifest and mismatched build mode", async () => {
  const directory = await fixture();
  await writeFile(path.join(directory, "build-provenance.json"), "{");
  await assert.rejects(
    checkBuild(directory, "live"),
    /Missing or invalid build-provenance/,
  );
  const mock = await fixture("mock");
  await assert.rejects(
    checkBuild(mock, "live"),
    /Invalid provenance schema, mode/,
  );
});

test("rejects primitive JSON provenance even when no JavaScript was emitted", async () => {
  const directory = await fixture();
  await rm(path.join(directory, "assets/app.js"));
  for (const value of [null, false, 0, "metadata", []]) {
    await writeFile(
      path.join(directory, "build-provenance.json"),
      JSON.stringify(value),
    );
    await assert.rejects(
      checkBuild(directory, "live"),
      /Invalid provenance schema/,
    );
  }
});

test("rejects an empty entry or chunk and output paths outside the artifact root", async () => {
  const directory = await fixture();
  await writeFile(path.join(directory, "index.html"), "");
  await writeFile(path.join(directory, "assets/app.js"), "");
  await assert.rejects(
    checkBuild(directory, "live"),
    /Missing or empty index\.html[\s\S]*Missing or empty emitted chunk/,
  );
  await changeManifest(
    directory,
    (manifest) => (manifest.chunks[0].fileName = "../outside.js"),
  );
  await assert.rejects(
    checkBuild(directory, "live"),
    /Invalid chunk provenance/,
  );
});

for (const [label, module] of [
  ["renamed mock implementation", "src/mocks/store.ts"],
  ["MSW core", "node_modules/msw/lib/core/index.mjs"],
  ["MSW interceptors", "node_modules/@mswjs/interceptors/lib/node/index.mjs"],
  ["Windows module path", "C:\\project\\src\\mocks\\browser.ts"],
]) {
  test(`rejects ${label} provenance even after minification removes recognizable byte strings`, async () => {
    const directory = await fixture();
    await changeManifest(directory, (manifest) =>
      manifest.chunks[0].modules.push(module),
    );
    await assert.rejects(
      checkBuild(directory, "live"),
      /in live chunk provenance/,
    );
  });
}

for (const [label, code] of [
  ["persona API", 'fetch("/api/_demo")'],
  ["mock ledger", 'sessionStorage.getItem("openstudy-mock-v1")'],
  ["failure input", "const f={simulateFailure:true}"],
  ["persona label", 'const text="사장님으로 체험"'],
  ["escaped failure input", 'const f={"simulat\\u0065Failure":true}'],
  ["renamed worker runtime", 'const a="INTEGRITY_CHECK_REQUEST"'],
]) {
  test(`rejects ${label} injected into a nested lazy chunk with clean provenance`, async () => {
    const directory = await fixture();
    await mkdir(path.join(directory, "assets/nested"));
    await writeFile(path.join(directory, "assets/nested/lazy.js"), code);
    await changeManifest(directory, (manifest) =>
      manifest.chunks.push({
        fileName: "assets/nested/lazy.js",
        modules: ["src/features/settings/Settings.tsx"],
      }),
    );
    await assert.rejects(
      checkBuild(directory, "live"),
      /in live artifact: assets\/nested\/lazy\.js/,
    );
  });
}

test("scans unreferenced copied assets instead of trusting the chunk manifest alone", async () => {
  const directory = await fixture();
  await writeFile(
    path.join(directory, "mockServiceWorker.js"),
    'const a="INTEGRITY_CHECK_REQUEST"',
  );
  await writeFile(
    path.join(directory, "assets/unreferenced.html"),
    "<button>데모·검증 도구</button>",
  );
  await assert.rejects(
    checkBuild(directory, "live"),
    /MSW worker artifact[\s\S]*demo persona controls|demo persona controls[\s\S]*MSW worker artifact/,
  );
});

test("rejects unknown JavaScript and source maps, even when they are never loaded by the browser", async () => {
  const directory = await fixture();
  await writeFile(path.join(directory, "assets/unlisted.js"), "console.log(1)");
  await writeFile(
    path.join(directory, "assets/app.js.map"),
    JSON.stringify({ sourcesContent: ['fetch("/_demo")'] }),
  );
  await assert.rejects(
    checkBuild(directory, "live"),
    /absent from provenance[\s\S]*Source map|Source map[\s\S]*absent from provenance/,
  );
});

test("CLI exits nonzero with a useful contamination message", async () => {
  const directory = await fixture();
  await writeFile(path.join(directory, "assets/app.js"), 'fetch("/_demo")');
  const result = spawnSync(
    process.execPath,
    ["scripts/check-build.mjs", "--mode", "live", directory],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /demo API in live artifact/);
  assert.equal(result.stdout, "");
});
