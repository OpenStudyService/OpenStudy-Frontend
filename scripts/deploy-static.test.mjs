import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";

const script = fileURLToPath(new URL("deploy-static.sh", import.meta.url));
const bash =
  process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const deployArgs = [
  "-c",
  'export PATH="$DEPLOY_TEST_BIN:$PATH"; exec bash "$1"',
  "deploy-test",
  script.replaceAll("\\", "/"),
];

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "openstudy-deploy-"));
  t.after(() => {
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
    rmSync(dir, { recursive: true, force: true });
  });
  mkdirSync(join(dir, "bin"));
  mkdirSync(join(dir, "dist/assets"), { recursive: true });
  writeFileSync(
    join(dir, "dist/index.html"),
    '<html><script type="module" src="/assets/app.js"></script></html>',
  );
  writeFileSync(join(dir, "dist/assets/app.js"), 'console.log("release");');
  writeFileSync(
    join(dir, "dist/build-provenance.json"),
    JSON.stringify({
      schemaVersion: 1,
      mode: "live",
      chunks: [{ fileName: "assets/app.js", modules: ["src/main.tsx"] }],
    }),
  );
  writeFileSync(
    join(dir, "bin/aws"),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.DEPLOY_COMMANDS, JSON.stringify(args) + '\\n');
if (args[1] === 'create-invalidation') {
  if (process.env.FAIL_INVALIDATION) process.exit(1);
  console.log('INVALIDATION123');
}
if (args[1] === 'get-distribution') console.log('example123.cloudfront.net');
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(dir, "bin/curl"),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.DEPLOY_COMMANDS, JSON.stringify(['curl', ...args]) + '\\n');
fs.copyFileSync('dist/index.html', args[args.indexOf('--output') + 1]);
`,
    { mode: 0o755 },
  );
  return {
    dir,
    env: {
      ...process.env,
      PATH: join(dir, "bin") + delimiter + process.env.PATH,
      DEPLOY_TEST_BIN: join(dir, "bin")
        .replaceAll("\\", "/")
        .replace(/^([a-z]):\//i, (_, drive) => `/${drive.toLowerCase()}/`),
      AWS_REGION: "ap-northeast-2",
      S3_BUCKET: "example-frontend",
      CLOUDFRONT_DISTRIBUTION_ID: "EXAMPLE123",
      DEPLOY_COMMANDS: join(dir, "commands.jsonl"),
      GITHUB_STEP_SUMMARY: "",
    },
  };
}

test("assets precede index publication; cache invalidation and SPA checks complete", (t) => {
  const f = fixture(t);
  const result = spawnSync(bash, deployArgs, {
    cwd: f.dir,
    env: f.env,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const commands = readFileSync(f.env.DEPLOY_COMMANDS, "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.deepEqual(
    commands.slice(0, 3).map((c) => c.slice(0, 3)),
    [
      ["s3", "sync", "dist/assets/"],
      ["s3", "sync", "dist/"],
      ["s3", "cp", "dist/index.html"],
    ],
  );
  assert.ok(
    !commands.flat().includes("--delete"),
    "Keep previous release assets available",
  );
  assert.ok(commands[0].includes("public,max-age=31536000,immutable"));
  assert.ok(commands[2].includes("no-cache"));
  assert.ok(commands.some((c) => c[1] === "wait"));
  assert.equal(commands.filter((c) => c[0] === "curl").length, 2);
});

test("a failed invalidation fails deployment before reporting success", (t) => {
  const f = fixture(t);
  const result = spawnSync(bash, deployArgs, {
    cwd: f.dir,
    env: { ...f.env, FAIL_INVALIDATION: "1" },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /Frontend deployed/);
  assert.doesNotMatch(
    readFileSync(f.env.DEPLOY_COMMANDS, "utf8"),
    /get-distribution|curl/,
  );
});

test("an incomplete build fails before publishing any files", (t) => {
  const f = fixture(t);
  rmSync(join(f.dir, "dist/index.html"));
  const result = spawnSync(bash, deployArgs, {
    cwd: f.dir,
    env: f.env,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Build the live frontend/);
});

test("a contaminated artifact fails before any AWS call", (t) => {
  const f = fixture(t);
  writeFileSync(
    join(f.dir, "dist/mockServiceWorker.js"),
    "// accidental demo worker",
  );
  const result = spawnSync(bash, deployArgs, {
    cwd: f.dir,
    env: f.env,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /worker|MSW/i);
  assert.equal(existsSync(f.env.DEPLOY_COMMANDS), false);
});
