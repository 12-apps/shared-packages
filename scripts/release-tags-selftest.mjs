#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACCIDENTAL_MAJOR,
  BROKEN_CONFIG,
  CHANGED_BUT_SILENT,
  DELIBERATE_MINOR,
  NOTHING,
  RELEASED,
  STALE_REF,
  TLS_BLIP,
} from "./release-tags-selftest-fixtures.mjs";
import { declaredDirs } from "./lib/release-state.mjs";

/**
 * Proves scripts/release-tags.mjs SURVIVES the two things that broke this repo's
 * releases, and keeps the tag scheme that 700+ existing tags depend on.
 *
 * Run 31427350698 is the case this whole script exists for. semantic-release
 * reported `EGITNOPERMISSION Cannot push to the Git repository … missing push
 * permission`, and the line above it said what had really happened: a `git push
 * --dry-run` that failed with `server certificate verification failed`. A TLS
 * blip. It happened on `realtime`, 11th of 30, seven packages after `auth` had
 * already been tagged — and because the old inline loop ran under `set -e`, it
 * ended the step, skipped the remaining packages, and skipped the PUBLISH step,
 * leaving `auth-v1.22.0` as a tag npm never received. `@12-apps/auth` then sat
 * at 1.21.0 for four days while every later run reported success.
 *
 * So the two behaviours asserted here are the two that would each, alone, have
 * prevented it: a transient git failure is RETRIED, and a package that genuinely
 * cannot be released does not stop the ones after it.
 *
 * Both are silent when wrong. A missing retry looks like a red run with a
 * plausible-sounding permissions error; a loop that stops early looks like a run
 * that simply had less to do. Neither shows up as anything a reader would
 * question, which is why they get a test rather than a code review.
 *
 * The `pnpm` on PATH is a shim that plays a scripted plan and RECORDS every call
 * with its arguments — which is what lets a case assert the things a log cannot
 * show: how many times a package was attempted, in what order, and how
 * semantic-release was asked to run.
 *
 * COST: two cases exercise a real retry at a real 5s first backoff, so this
 * takes ~11s wall. The wait is left honest rather than made configurable for the
 * test's convenience, matching scripts/publish-selftest.mjs.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const RELEASE_TAGS = join(HERE, "release-tags.mjs");

// ── The scripted pnpm ───────────────────────────────────────────────────────

/**
 * The `pnpm` the script under test will find on PATH.
 *
 * CommonJS and extensionless on purpose: it has to be spawnable as the bare word
 * `pnpm`, which is how release-tags.mjs invokes it. It identifies the package
 * from the directory it was run IN (release-tags.mjs runs each release inside
 * the package directory), appends that to a call log, and replays the plan entry
 * for this attempt — the LAST entry repeats, so a plan of one failing step keeps
 * failing however often it is retried. That is what makes "was it retried?"
 * answerable.
 */
const FAKE_PNPM = `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeSync } = require("node:fs");
const { basename } = require("node:path");
const plan = JSON.parse(readFileSync(process.env.FAKE_PNPM_PLAN, "utf8"));
const log = process.env.FAKE_PNPM_CALLS;
const pkg = basename(process.cwd());
const before = readFileSync(log, "utf8").split("\\n").filter((line) => line === pkg).length;
appendFileSync(log, pkg + "\\n");
appendFileSync(process.env.FAKE_PNPM_ARGV, pkg + " :: " + process.argv.slice(2).join(" ") + "\\n");
const steps = plan[pkg] || [{ status: 0, out: "no plan" }];
const step = steps[Math.min(before, steps.length - 1)];
writeSync(1, step.out + "\\n");
process.exit(step.status);
`;

function workspace(packages) {
  const root = mkdtempSync(join(tmpdir(), "release-tags-selftest-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  // Pins the shim to CommonJS whatever the surrounding tree says.
  writeFileSync(join(bin, "package.json"), '{"type":"commonjs"}\n');
  writeFileSync(join(bin, "pnpm"), FAKE_PNPM);
  chmodSync(join(bin, "pnpm"), 0o755);

  // The DIRECTORY name is the package identity here, exactly as in the release
  // job: `--tag-format "$(basename $dir)-v..."`, because payments ships nested.
  const dirs = packages.map((pkg) => {
    const dir = join(root, pkg);
    mkdirSync(dir);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `@selftest/${pkg}`, version: "1.0.0" }));
    return dir;
  });
  return { root, bin, dirs };
}

/** Runs the real scripts/release-tags.mjs over a scripted semantic-release. */
function releaseTags(packages, plan) {
  const { root, bin, dirs } = workspace(packages);
  const calls = join(root, "calls.log");
  const planFile = join(root, "plan.json");
  const summary = join(root, "summary.md");
  const argv = join(root, "argv.log");
  // The runner's step-to-step channel: release-tags.mjs writes the packages it
  // could not tag here, and the alert step reads them.
  const handoff = join(root, "github.env");
  for (const file of [calls, summary, argv, handoff]) writeFileSync(file, "");
  writeFileSync(planFile, JSON.stringify(plan));

  const result = spawnSync(process.execPath, [RELEASE_TAGS], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      PUBLISH_DIRS: dirs.join(" "),
      FAKE_PNPM_PLAN: planFile,
      FAKE_PNPM_CALLS: calls,
      FAKE_PNPM_ARGV: argv,
      GITHUB_STEP_SUMMARY: summary,
      GITHUB_ENV: handoff,
    },
  });

  const logged = readFileSync(calls, "utf8").split("\n").filter(Boolean);
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    summary: readFileSync(summary, "utf8"),
    handoff: readFileSync(handoff, "utf8"),
    argv: readFileSync(argv, "utf8").split("\n").filter(Boolean),
    order: logged,
    attempts: (pkg) => logged.filter((line) => line === pkg).length,
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

// ── The TLS blip that took auth-v1.22.0 down: run 31427350698 exactly ────────
const tls = releaseTags(["auth"], {
  auth: [
    { status: 1, out: TLS_BLIP },
    { status: 0, out: RELEASED },
  ],
});

check(
  "a git transport failure is retried rather than ending the release",
  tls.attempts("auth") === 2,
  `semantic-release was invoked ${tls.attempts("auth")} time(s). A TLS handshake that\n    failed once is a different question five seconds later, and not retrying it is\n    what stranded auth-v1.22.0.`,
);
check(
  "the run goes green once the retry succeeds",
  tls.status === 0,
  `expected exit 0 after a successful retry, got ${tls.status}`,
);
check(
  "the retry says what it is waiting on, not just that it is waiting",
  /git transport failure/i.test(tls.output),
  `the warning must name the transport failure, because semantic-release's own\n    error code says "permission" and sends the reader to the wrong place. It said:\n    ${tls.output.split("\n").find((l) => l.includes("::warning::")) ?? "(no warning)"}`,
);
check(
  "EGITNOPERMISSION alone is not read as a permissions problem",
  !/missing push permission/i.test(
    tls.output.split("\n").filter((line) => line.startsWith("::error::")).join("\n"),
  ),
  "the script repeated semantic-release's permissions diagnosis for what was a TLS blip",
);

// ── The concurrent-merge race ───────────────────────────────────────────────
const stale = releaseTags(["ui"], {
  ui: [
    { status: 1, out: STALE_REF },
    { status: 0, out: RELEASED },
  ],
});

check(
  "a push race with a concurrent release is retried",
  stale.attempts("ui") === 2 && stale.status === 0,
  `push runs are keyed by SHA so two merges release concurrently by design; the\n    loser must retry rather than fail. Attempts: ${stale.attempts("ui")}, exit ${stale.status}`,
);

// ── A genuinely broken package must not take the others with it ─────────────
const ORDER = ["auth", "realtime", "ui"];
const partial = releaseTags(ORDER, {
  auth: [{ status: 0, out: RELEASED }],
  realtime: [{ status: 1, out: BROKEN_CONFIG }],
  ui: [{ status: 0, out: NOTHING }],
});

check(
  "every package is attempted even after one fails",
  ORDER.every((pkg) => partial.attempts(pkg) >= 1),
  `the old inline loop ran under set -e, so realtime's failure skipped ui entirely\n    AND skipped the publish step, orphaning auth's tag. Attempts: ${ORDER.map(
    (p) => `${p}=${partial.attempts(p)}`,
  ).join(", ")}`,
);
check(
  "packages are released in the topological order they were given",
  partial.order.filter((pkg, at) => partial.order.indexOf(pkg) === at).join(",") === ORDER.join(","),
  `interdeps are resolved to concrete sibling versions at publish time, so order is\n    load-bearing. Got: ${partial.order.join(", ")}`,
);
check(
  "a package that cannot be released is not retried",
  partial.attempts("realtime") === 1,
  `nothing about a missing module changes on a second attempt; it was tried\n    ${partial.attempts("realtime")} time(s)`,
);
check(
  "the run fails when a package could not be tagged",
  partial.status === 1,
  `expected exit 1, got ${partial.status} — a package that did not release must not\n    report success, which is how this class of failure stays invisible`,
);
check(
  "the failed package is handed to the steps that alert on it",
  /TAG_FAILED=.*\brealtime\b/.test(partial.handoff),
  `the alert step reads TAG_FAILED from GITHUB_ENV; it got: ${JSON.stringify(partial.handoff)}`,
);
check(
  "the summary says the publish step still runs",
  /publish step still runs/i.test(partial.summary),
  `a reader seeing a red tag step must know the packages tagged before it were\n    still published, or they will go looking for an orphan that is not there.\n    Summary: ${partial.summary}`,
);

// ── The happy path, and the tag scheme it must preserve ─────────────────────
const clean = releaseTags(["auth", "ui"], {
  auth: [{ status: 0, out: RELEASED }],
  ui: [{ status: 0, out: NOTHING }],
});

check(
  "a clean release attempts each package exactly once",
  clean.attempts("auth") === 1 && clean.attempts("ui") === 1 && clean.status === 0,
  `attempts: auth=${clean.attempts("auth")}, ui=${clean.attempts("ui")}, exit ${clean.status}`,
);
check(
  "nothing is handed over when every package tagged",
  !clean.handoff.includes("TAG_FAILED"),
  `TAG_FAILED must be absent on a clean run, or the alert step raises an issue\n    about nothing. Got: ${JSON.stringify(clean.handoff)}`,
);
check(
  "each package is tagged under its own directory-name prefix",
  clean.argv.some((call) => call.startsWith("auth :: ") && call.includes("--tag-format auth-v${version}")) &&
    clean.argv.some((call) => call.startsWith("ui :: ") && call.includes("--tag-format ui-v${version}")),
  `--tag-format keeps the scheme 700+ existing tags use. Without it\n    semantic-release-monorepo imposes @12-apps/ui-v1.2.3, under which no package\n    finds its own last tag and every one resets to 1.0.0. Calls:\n    ${clean.argv.join("\n    ")}`,
);

// ── exit 0 and nothing shipped: the success that has to be told apart ──────
//
// Both packages "succeed" and neither is tagged. `ui` is correct — nothing in
// its range. `prisma` is the bug. Told apart in BOTH directions: a warning that
// fires for `ui` too is noise on every release, one that fires for neither is
// today's silence.
// `request-scope` and the second `ui` line carry the mirror case: the version a
// consumer cannot take without reading is the one the job currently says least
// about, and it is decided by whether a wrap put `BREAKING CHANGE` at column 0.
const quiet = releaseTags(["prisma", "ui", "request-scope", "auth"], {
  prisma: [{ status: 0, out: CHANGED_BUT_SILENT }],
  ui: [{ status: 0, out: NOTHING }],
  "request-scope": [{ status: 0, out: ACCIDENTAL_MAJOR }],
  auth: [{ status: 0, out: DELIBERATE_MINOR }],
});

check(
  "a major is named while the run is still on screen, with what caused it",
  /::warning::request-scope: cut a MAJOR, from a BREAKING CHANGE footer/.test(quiet.output) &&
    /RELEASED_MAJOR=request-scope/.test(quiet.handoff),
  `@12-apps/request-scope went out as 2.0.0 because a 100-char wrap put the phrase at\n    the start of a body line, and nothing in the job said so. Output was:\n    ${quiet.output}`,
);
check(
  "a minor bump is not reported as one",
  !/auth: cut a MAJOR/.test(quiet.output) && !/RELEASED_MAJOR=.*auth/.test(quiet.handoff),
  `most releases are minor or patch; warning on those makes the warning worthless`,
);

check(
  "a package with commits in range and no release is named",
  /::warning::prisma: 1 commit\(s\) in range and NO release/.test(quiet.output),
  `semantic-release exits 0 for this, so nothing else in the job can see it.\n    Output was:\n    ${quiet.output}`,
);
check(
  "the warning says what to check, including the ! shorthand the preset ignores",
  /BREAKING CHANGE footer/.test(quiet.output) && /angular preset/.test(quiet.output),
  "the reader has to know WHY a commit that looked like a release was not one",
);
check(
  "it is handed to the rest of the job with its commit count",
  /^CHANGED_NO_RELEASE=prisma:1$/m.test(quiet.handoff),
  `later steps read GITHUB_ENV, and the count is what makes the entry actionable.\n    Handoff was: ${JSON.stringify(quiet.handoff)}`,
);
check(
  "a package with NO commits in range is not reported",
  !/ui: \d+ commit/.test(quiet.output) && !/CHANGED_NO_RELEASE=.*\bui\b/.test(quiet.handoff),
  `this is the normal state for 29 of 30 packages on every release — warning about\n    it would bury the one that matters. Output was:\n    ${quiet.output}`,
);
check(
  "and none of it fails the run",
  quiet.status === 0,
  `expected exit 0: a docs or test commit legitimately releases nothing, so this is\n    a warning. Got ${quiet.status}`,
);

// ── The two copies of the package list must be the same list ───────────────
//
// ci.yml carries PUBLISH_DIRS so its shell steps can read it; release-packages.txt
// is what everything running OUTSIDE the release job reads, the scheduled
// watchdog above all. Two lists that can drift are the failure this repo already
// warns about in ci.yml's own comment — a package in one and not the other is
// released but never verified, or verified but never released. Neither is
// visible until the day it matters, so it is asserted rather than trusted.
const workflow = readFileSync(join(HERE, "..", ".github", "workflows", "ci.yml"), "utf8");
const inWorkflow = (workflow.match(/PUBLISH_DIRS: >-\n([\s\S]*?)\n\n/) ?? ["", ""])[1]
  .split(/\s+/)
  .filter(Boolean);
const inFile = declaredDirs();

check(
  "ci.yml's PUBLISH_DIRS and release-packages.txt are the same list, in the same order",
  inWorkflow.length > 0 && inWorkflow.join(",") === inFile.join(","),
  `the two must not drift.\n    ci.yml (${inWorkflow.length}): ${inWorkflow.join(" ")}\n    release-packages.txt (${inFile.length}): ${inFile.join(" ")}`,
);

// ── Every released package must carry its own release config ───────────────
//
// semantic-release resolves its config with cosmiconfig, which searches UPWARD
// from the cwd. So a package directory with no `.releaserc.json` does not fail
// — it silently inherits the ROOT one, which does not `extends
// semantic-release-monorepo`. Without that extension nothing narrows the commit
// range to the package's own directory, and the package is versioned from the
// WHOLE repository's history.
//
// `packages/request-scope` shipped that way. Measured on this tree: run bare, it
// analysed 11 commits belonging to other packages, found the `BREAKING CHANGE`
// footer on a `fix(app-shell)` commit, and computed `request-scope-v2.0.0` — a
// major for a package with zero commits since its last tag. The release job then
// failed on it (`TAG_FAILED: request-scope`) on every push to main for days.
//
// The inherited config is a VALID one, which is what makes this invisible: there
// is no missing-file error to read, and the version it invents is plausible.
// Only the range it was computed from is wrong. Hence a check on the file's
// existence AND on the one key that does the narrowing — a `.releaserc.json`
// that forgot `extends` fails exactly the same way as no file at all.
const misconfigured = inFile.filter((dir) => {
  const config = join(HERE, "..", dir, ".releaserc.json");
  if (!existsSync(config)) return true;
  return JSON.parse(readFileSync(config, "utf8")).extends !== "semantic-release-monorepo";
});

check(
  "every released package has a .releaserc.json extending semantic-release-monorepo",
  inFile.length > 0 && misconfigured.length === 0,
  `without it semantic-release inherits the root config, whose commit range is the\n    WHOLE repository — the package is versioned off other packages' commits.\n    Missing or not extending semantic-release-monorepo: ${misconfigured.join(", ")}`,
);

if (failures.length > 0) {
  console.log(`\n${failures.length} failure(s):\n`);
  for (const failure of failures) console.log(`  FAIL  ${failure}\n`);
  process.exit(1);
}
console.log("\nrelease-tags.mjs behaves as documented");
