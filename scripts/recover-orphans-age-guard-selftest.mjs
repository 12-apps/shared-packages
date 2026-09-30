#!/usr/bin/env node
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Proves the age guard in scripts/recover-orphans.mjs, split from
 * recover-orphans-selftest.mjs to stay under the size/complexity gate's
 * max-lines rather than growing that file past its budget.
 *
 * WHY the guard exists at all. recover-orphans.mjs already waits out npm's
 * read-after-write lag (the schedule shared via lib/release-state.mjs) before
 * calling a tag orphaned, and scripts/publish.mjs hands over PUBLISH_ACCEPTED
 * so verify-released.mjs and release-alert.mjs can tell THIS run's own
 * propagating publish from a real orphan. Neither covers this script on the
 * NEXT push: that hand-off lives only as long as the job that set it, so a
 * tag made minutes ago and still propagating when the next push starts would
 * otherwise read here as a plain orphan and lose its tag for real — this
 * script's one DESTRUCTIVE act. The guard is the second, independent check
 * for that gap: an orphan whose GitHub Release is younger than
 * RELEASE_ORPHAN_MIN_AGE_MIN minutes (default 30) is left alone.
 *
 * `published_at`, not `created_at` or the tag: `created_at` is the tagged
 * COMMIT's date, which can be arbitrarily old, and a lightweight git tag
 * carries no date at all. Only the Release's own `published_at` says when npm
 * was actually asked to serve this version.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const RECOVER = join(HERE, "recover-orphans.mjs");

/** Answers `git tag --list <prefix>-v* --sort=-v:refname`, `rev-parse HEAD` and tag deletion/creation, recording every call. */
const FAKE_GIT = `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require("node:fs");
const plan = JSON.parse(readFileSync(process.env.FAKE_PLAN, "utf8"));
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_GIT_CALLS, args.join(" ") + "\\n");
if (args[0] === "rev-parse" && args[1] === "HEAD") {
  process.stdout.write("0123456789abcdef0123456789abcdef01234567\\n");
  process.exit(0);
}
if (args[0] === "tag" && args[1] === "--list") {
  const pkg = args[2].replace(/-v\\*$/, "");
  const entry = plan[pkg];
  if (entry && entry.tag) process.stdout.write(entry.tag + "\\n");
}
process.exit(0);
`;

/** Answers `npm view <name> versions --json` from the plan; a missing `versions` means "not on the registry". */
const FAKE_NPM = `#!/usr/bin/env node
const { readFileSync } = require("node:fs");
const plan = JSON.parse(readFileSync(process.env.FAKE_PLAN, "utf8"));
const args = process.argv.slice(2);
if (args[0] === "view") {
  const pkg = args[1].replace(/^@selftest\\//, "");
  const entry = plan[pkg];
  if (!entry || !entry.versions) process.exit(1);
  process.stdout.write(JSON.stringify(entry.versions));
}
process.exit(0);
`;

/**
 * A GitHub Releases API that records what was asked of it and answers the
 * lookup with `publishedAt` as the Release's `published_at` — omitted, there
 * is no Release at all, and the guard has nothing to read.
 */
function githubStub(publishedAt) {
  const calls = [];
  const server = createServer((req, res) => {
    calls.push({ method: req.method, path: req.url.split("?")[0] });
    if (req.method === "GET" && publishedAt === undefined) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end("{}");
      return;
    }
    res.writeHead(req.method === "DELETE" ? 204 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: 368170853, ...(publishedAt ? { published_at: publishedAt } : {}) }));
  });
  return { server, calls };
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function workspace(packages) {
  const root = mkdtempSync(join(tmpdir(), "recover-orphans-age-guard-selftest-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "package.json"), '{"type":"commonjs"}\n');
  for (const [name, source] of [
    ["git", FAKE_GIT],
    ["npm", FAKE_NPM],
  ]) {
    writeFileSync(join(bin, name), source);
    chmodSync(join(bin, name), 0o755);
  }
  const dirs = packages.map((pkg) => {
    const dir = join(root, pkg);
    mkdirSync(dir);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `@selftest/${pkg}`, version: "1.0.0" }));
    return dir;
  });
  return { root, bin, dirs };
}

const ORPHAN = { auth: { tag: "auth-v1.22.0", versions: ["1.20.0", "1.21.0"] } };

/** Runs the real scripts/recover-orphans.mjs over a scripted git, npm and API. */
async function recover({ plan = ORPHAN, publishedAt, env = {} }) {
  const { root, bin, dirs } = workspace(Object.keys(plan));
  const planFile = join(root, "plan.json");
  const gitCalls = join(root, "git.log");
  writeFileSync(planFile, JSON.stringify(plan));
  writeFileSync(gitCalls, "");

  const { server } = githubStub(publishedAt);
  const port = await listen(server);

  // `spawn`, not `spawnSync`: the stub API is served by this process, so a
  // synchronous spawn would block the loop that has to answer the child's fetch.
  const result = await new Promise((done) => {
    const child = spawn(process.execPath, [RECOVER], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        PUBLISH_DIRS: dirs.join(" "),
        FAKE_PLAN: planFile,
        FAKE_GIT_CALLS: gitCalls,
        RELEASE_ABSENCE_RECHECK_MS: "",
        GITHUB_API_URL: `http://127.0.0.1:${port}`,
        GITHUB_REPOSITORY: "12-apps/shared-packages",
        GITHUB_TOKEN: "selftest-token",
        RELEASE_AUTO_RECOVER: "",
        ...env,
      },
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (status) => done({ status, output }));
  });
  server.close();

  const git = readFileSync(gitCalls, "utf8").split("\n").filter(Boolean);
  return { ...result, git, deletedTags: git.filter((c) => c.startsWith("push") && c.includes("--delete")) };
}

const failures = [];
function check(label, passed, detail) {
  if (passed) {
    console.log(`  ok  ${label}`);
    return;
  }
  failures.push(`${label}\n    ${detail}`);
}

// ── A very recent GitHub Release is not deleted yet ──────────────────────────
const recent = await recover({ publishedAt: new Date(Date.now() - 5 * 60_000).toISOString() });

check(
  "an orphan whose GitHub Release is 5 minutes old is left alone",
  recent.deletedTags.length === 0,
  `a Release this fresh is far more likely to be propagation lag than a real\n    orphan. git saw:\n    ${recent.git.join("\n    ")}`,
);
check(
  "and it says why, naming the tag and its age",
  /::notice::/.test(recent.output) && /auth-v1\.22\.0/.test(recent.output),
  `Output:\n    ${recent.output}`,
);
check("the run stays green — skipping is not a failure", recent.status === 0, `Output:\n    ${recent.output}`);

// ── The guard has a floor: an old orphan is still recovered ─────────────────
const old = await recover({ publishedAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString() });

check(
  "an orphan whose GitHub Release is 2 hours old is still deleted",
  old.deletedTags.some((call) => call.includes("auth-v1.22.0")),
  `the guard must not become blindness — a real orphan has to age out of it.\n    git saw:\n    ${old.git.join("\n    ")}`,
);

// ── No GitHub Release at all is unaffected by the guard ──────────────────────
const noRelease = await recover({});

check(
  "an orphan with no GitHub Release skips the age check entirely and is still recovered",
  noRelease.deletedTags.some((call) => call.includes("auth-v1.22.0")),
  `there is no published_at to read, so today's behaviour applies. git saw:\n    ${noRelease.git.join("\n    ")}`,
);

// ── The floor is overridable ──────────────────────────────────────────────────
const overridden = await recover({
  publishedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  env: { RELEASE_ORPHAN_MIN_AGE_MIN: "1" },
});

check(
  "RELEASE_ORPHAN_MIN_AGE_MIN lowers the floor",
  overridden.deletedTags.some((call) => call.includes("auth-v1.22.0")),
  `a 5-minute-old Release must clear a 1-minute guard. git saw:\n    ${overridden.git.join("\n    ")}`,
);

// ── A malformed floor falls back to the default, never to "no guard" ─────────
for (const bad of ["", "abc"]) {
  const malformed = await recover({
    publishedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    env: { RELEASE_ORPHAN_MIN_AGE_MIN: bad },
  });
  check(
    `RELEASE_ORPHAN_MIN_AGE_MIN=${JSON.stringify(bad)} still guards a 5-minute-old Release`,
    !malformed.deletedTags.some((call) => call.includes("auth-v1.22.0")),
    `a NaN floor must not switch the guard off. git saw:\n    ${malformed.git.join("\n    ")}`,
  );
}

if (failures.length > 0) {
  console.log(`\n${failures.length} failure(s):\n`);
  for (const failure of failures) console.log(`  FAIL  ${failure}\n`);
  process.exit(1);
}
console.log("\nrecover-orphans.mjs's age guard skips fresh Releases and still catches real orphans");
