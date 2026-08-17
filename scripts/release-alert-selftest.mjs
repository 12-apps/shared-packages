#!/usr/bin/env node
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Proves scripts/release-alert.mjs raises ONE alert and takes it back.
 *
 * This is the only script here that writes to the repo rather than reading it,
 * and both directions are dangerous in a way a log will not show. If it fails to
 * recognise the issue it already opened, a package stuck for a week files seven
 * issues and the signal is buried in its own noise. If it fails to close a
 * resolved one, the next real outage arrives at an issue that is already open
 * and reads as known. Either way the alert stops meaning anything, which is the
 * exact failure this script was added to fix — auth-v1.22.0 went unreported for
 * four days across five red runs.
 *
 * So the GitHub API is a real HTTP server here, and each case asserts on the
 * REQUESTS made: an alert must be a POST once and a PATCH thereafter, and a
 * healthy release must close what it opened. `GITHUB_API_URL` is what makes that
 * possible, and it is not a test seam invented for the purpose — Actions sets it
 * on every runner, and it differs on Enterprise Server.
 *
 * `git` and `npm` are shims, so a case can state "this package is tagged 1.22.0
 * and the registry stops at 1.21.0" directly rather than building a repository
 * to imply it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ALERT = join(HERE, "release-alert.mjs");

/** Answers `git tag --list <prefix>-v* --sort=-v:refname` from the plan. */
const FAKE_GIT = `#!/usr/bin/env node
const { readFileSync } = require("node:fs");
const plan = JSON.parse(readFileSync(process.env.FAKE_PLAN, "utf8"));
const args = process.argv.slice(2);
if (args[0] === "tag" && args[1] === "--list") {
  const pkg = args[2].replace(/-v\\*$/, "");
  const entry = plan[pkg];
  if (entry && entry.tag) process.stdout.write(entry.tag + "\\n");
}
process.exit(0);
`;

/** Answers `npm view <name> versions --json` from the plan. */
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
 * A GitHub issues API that records what was asked of it.
 *
 * `issues` is the state the run starts from, so a case can say "an alert is
 * already open" without having to make one first.
 */
function githubStub(issues, createStatus = 201) {
  const calls = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const path = req.url.split("?")[0];
      calls.push({ method: req.method, path, body });
      const created = { number: 42, body: `${JSON.parse(body || "{}").body ?? ""}` };
      if (req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(issues));
        return;
      }
      // A repository that REFUSES issue creation. 410 is not hypothetical: it is
      // what `12-apps/shared-packages` answers today, because Issues are
      // disabled on it — so the alert channel this script is built around does
      // not exist, and every alert it has raised has been a log line.
      if (req.method === "POST" && path.endsWith("/issues") && createStatus >= 400) {
        res.writeHead(createStatus, { "content-type": "application/json" });
        res.end(JSON.stringify({ message: "Issues has been disabled in this repository." }));
        return;
      }
      res.writeHead(req.method === "POST" ? 201 : 200, { "content-type": "application/json" });
      res.end(JSON.stringify(created));
    });
  });
  return { server, calls };
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function workspace(packages) {
  const root = mkdtempSync(join(tmpdir(), "release-alert-selftest-"));
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

/** Runs the real scripts/release-alert.mjs against the stub API. */
async function alert({ plan, issues = [], env = {}, createStatus = 201 }) {
  const { root, bin, dirs } = workspace(Object.keys(plan));
  const planFile = join(root, "plan.json");
  writeFileSync(planFile, JSON.stringify(plan));

  const { server, calls } = githubStub(issues, createStatus);
  const port = await listen(server);

  // `spawn`, NOT `spawnSync`. The stub API is served by this very process, so a
  // synchronous spawn blocks the event loop that would answer the child's fetch
  // — the child waits forever on a request that cannot be served until it exits.
  const result = await new Promise((done) => {
    const child = spawn(process.execPath, [ALERT], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        PUBLISH_DIRS: dirs.join(" "),
        FAKE_PLAN: planFile,
        GITHUB_API_URL: `http://127.0.0.1:${port}`,
        GITHUB_REPOSITORY: "12-apps/shared-packages",
        GITHUB_TOKEN: "selftest-token",
        GITHUB_RUN_ID: "31427350698",
        RELEASE_ALERT_WEBHOOK: "",
        TAG_FAILED: "",
        PUBLISH_WEDGED: "",
        PUBLISH_INCOMPLETE: "",
        RELEASE_JOB_STATUS: "",
        ...env,
      },
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (status) => done({ status, output }));
  });
  server.close();

  return {
    ...result,
    calls,
    of: (method, match) => calls.filter((c) => c.method === method && c.path.includes(match)),
    // Matched on the EXACT path: `/issues` creates one, `/issues/42/comments`
    // does not, and an `includes` test counts the comment as a second issue.
    creations: calls.filter((c) => c.method === "POST" && c.path.endsWith("/issues")),
  };
}

const failures = [];

function check(label, passed, detail) {
  if (passed) {
    console.log(`  ok  ${label}`);
    return;
  }
  failures.push(`${label}\n    ${detail}`);
}

const MARKER = "<!-- release-alert:shared-packages -->";
const STUCK = { auth: { tag: "auth-v1.22.0", versions: ["1.20.0", "1.21.0"] } };
const HEALTHY = { auth: { tag: "auth-v1.22.0", versions: ["1.21.0", "1.22.0"] } };

// ── A stuck package with no alert open: file one ────────────────────────────
const opened = await alert({ plan: STUCK });

check(
  "a stuck package opens an issue",
  opened.creations.length === 1,
  `expected exactly one POST /issues, got ${JSON.stringify(opened.calls.map((c) => `${c.method} ${c.path}`))}`,
);
check(
  "the issue names the package, the tag and the version npm is missing",
  [/auth/, /auth-v1\.22\.0/, /1\.22\.0/].every((part) => part.test(opened.creations[0]?.body ?? "")),
  `a reader must be able to act without opening the run. Body was:\n    ${opened.creations[0]?.body}`,
);
check(
  "the issue carries the marker that lets the next run find it",
  (opened.creations[0]?.body ?? "").includes(MARKER),
  "without the marker every later run files a NEW issue for the same outage",
);

// ── The same package, still stuck, with the alert already open ──────────────
const again = await alert({
  plan: STUCK,
  issues: [{ number: 42, body: `${MARKER}\nprevious state`, pull_request: null }],
});

check(
  "a second failing run does NOT file a second issue",
  again.creations.length === 0,
  `a package stuck for a week must be one conversation, not seven issues. Calls:\n    ${again.calls
    .map((c) => `${c.method} ${c.path}`)
    .join("\n    ")}`,
);
check(
  "it rewrites the open issue instead",
  again.of("PATCH", "/issues/42").length === 1,
  "the top of the thread must show the CURRENT state, not the first run's",
);
check(
  "and comments, so the thread shows it is still happening",
  again.of("POST", "/issues/42/comments").length === 1,
  "a silently-edited issue gives a watcher no notification that it recurred",
);

// ── A pull request is an issue to this API, and must not be mistaken for one ─
const prShaped = await alert({
  plan: STUCK,
  issues: [{ number: 7, body: `${MARKER}`, pull_request: { url: "..." } }],
});

check(
  "a pull request carrying the marker is not treated as the alert issue",
  prShaped.creations.length === 1 && prShaped.of("PATCH", "/issues/7").length === 0,
  `/issues returns PRs too; editing one instead of the alert would comment on\n    someone's PR and leave the outage unreported. Calls:\n    ${prShaped.calls
    .map((c) => `${c.method} ${c.path}`)
    .join("\n    ")}`,
);

// ── Recovered: the alert must take itself back ──────────────────────────────
const closed = await alert({
  plan: HEALTHY,
  issues: [{ number: 42, body: `${MARKER}\nstuck`, pull_request: null }],
});

check(
  "a healthy release closes the open alert",
  closed.of("PATCH", "/issues/42").some((c) => c.body.includes('"state":"closed"')),
  `an alert nobody closes is one the next outage hides behind. Calls:\n    ${closed.calls
    .map((c) => `${c.method} ${c.path} ${c.body}`)
    .join("\n    ")}`,
);
check(
  "closing does not also file a new issue",
  closed.creations.length === 0,
  "a healthy run must not raise an alert about being healthy",
);

// ── Healthy, with nothing open: say nothing at all ──────────────────────────
const quiet = await alert({ plan: HEALTHY });

check(
  "a healthy release with no alert open writes nothing",
  quiet.calls.every((c) => c.method === "GET"),
  `the ordinary case must be silent. Calls:\n    ${quiet.calls.map((c) => `${c.method} ${c.path}`).join("\n    ")}`,
);

// ── A failed job with nothing stuck is still worth saying ───────────────────
const jobFailed = await alert({ plan: HEALTHY, env: { RELEASE_JOB_STATUS: "failure" } });

check(
  "a failed release job alerts even when no package is stuck",
  jobFailed.creations.length === 1,
  "a run that shipped nothing is worth an alert even when it left no orphan behind",
);

// ── The no-credential case keeps its own remedy ─────────────────────────────
const wedged = await alert({
  plan: HEALTHY,
  env: { PUBLISH_WEDGED: "@12-apps/auth", RELEASE_JOB_STATUS: "failure" },
});

check(
  "a package npm could not authenticate for gets the Trusted Publisher remedy",
  /Trusted Publisher/i.test(wedged.creations[0]?.body ?? ""),
  `"a plain re-run will not fix this" is the whole point of distinguishing it.\n    Body was:\n    ${wedged.creations[0]?.body}`,
);

// ── The alert channel itself is missing ─────────────────────────────────────
//
// The one case where this script's own premise fails. Its header says a GitHub
// issue is "the alert channel this repo already has" — on `12-apps/shared-packages`
// that is false, because Issues are disabled, so `POST /issues` answers 410 and
// the alert degrades to a line in the run's log: the exact place the header says
// nobody looks. It has to say so, and say it differently depending on whether a
// webhook carried the alert anyway, or the dead channel is itself invisible.
const noChannel = await alert({ plan: STUCK, createStatus: 410 });

check(
  "an alert that could not be filed says so, loudly",
  /::error::THIS ALERT REACHED NOBODY/.test(noChannel.output),
  `a failed POST used to degrade to the same ::warning:: a successful one prints.\n    Output was:\n    ${noChannel.output}`,
);
check(
  "it names the cause and what to do about it",
  /Issues are disabled/.test(noChannel.output) && /RELEASE_ALERT_WEBHOOK/.test(noChannel.output),
  `"could not file" is not actionable; "Issues are disabled, set the webhook" is.\n    Output was:\n    ${noChannel.output}`,
);
check(
  "the headline is still emitted, so the reason is not all a reader gets",
  /::error::Release is STUCK for \S*auth — tagged, but never published/.test(noChannel.output),
  `the alert's CONTENT must survive its channel failing.\n    Output was:\n    ${noChannel.output}`,
);

// The same refusal with a webhook configured: the alert did reach someone, so
// this is a warning about durability, not a blackout.
const webhookOnly = await alert({
  plan: STUCK,
  createStatus: 410,
  env: { RELEASE_ALERT_WEBHOOK: "http://127.0.0.1:1/hook" },
});

check(
  "with a webhook configured it is a warning about durability, not a blackout",
  !/REACHED NOBODY/.test(webhookOnly.output) && /nothing here outlives the run/.test(webhookOnly.output),
  `crying blackout when the webhook fired is the kind of false alarm that gets a\n    gate ignored. Output was:\n    ${webhookOnly.output}`,
);

if (failures.length > 0) {
  console.log(`\n${failures.length} failure(s):\n`);
  for (const failure of failures) console.log(`  FAIL  ${failure}\n`);
  process.exit(1);
}
console.log("\nrelease-alert.mjs raises one alert and takes it back");
