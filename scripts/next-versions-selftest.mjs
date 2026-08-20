#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Proves scripts/next-versions.mjs answers "would this push cut a major" the
 * way the approval gate in ci.yml assumes.
 *
 * Four of these cases are the gate's correctness and the fifth is its safety.
 * A dry run that cannot answer must FAIL rather than report "no major": the
 * approval job only runs when `has_major` is `true`, so a script that swallowed
 * its own error would hand the release straight through unreviewed — the exact
 * outcome the gate exists to prevent, reached by the one path where nobody is
 * looking.
 *
 * The `--dry-run` assertion is not ceremony either. This script runs BEFORE
 * scripts/release-tags.mjs, so if the flag were ever dropped it would tag and
 * publish every package while presenting itself as an analysis — and a rejected
 * approval would then be rejecting a release that had already happened.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const NEXT_VERSIONS = join(HERE, "next-versions.mjs");

/**
 * A `pnpm` standing in for `pnpm exec semantic-release`.
 *
 * It records its own argv so the test can assert `--dry-run` was passed, then
 * prints semantic-release's real phrasing for the planned outcome: a `next`
 * version, nothing at all (no release), or a transport failure.
 */
const FAKE_PNPM = `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require("node:fs");
const plan = JSON.parse(readFileSync(process.env.FAKE_PLAN, "utf8"));
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_ARGV_LOG, args.join(" ") + "\\n");
const tagArg = args[args.indexOf("--tag-format") + 1] || "";
const pkg = tagArg.replace(/-v\\$\\{version\\}$/, "");
const entry = plan[pkg] || {};
if (entry.fail) {
  process.stderr.write("fatal: unable to access 'https://github.com/…': server certificate verification failed\\n");
  process.stderr.write("EGITNOPERMISSION Cannot push to the Git repository.\\n");
  process.exit(1);
}
if (entry.last) {
  process.stdout.write("[semantic-release] > Found git tag " + pkg + "-v" + entry.last + " associated with version " + entry.last + " on branch main\\n");
}
if (entry.breaking) {
  process.stdout.write("BREAKING CHANGE: the old API is gone\\n");
}
if (entry.next) {
  process.stdout.write("[semantic-release] > The next release version is " + entry.next + "\\n");
}
process.exit(0);
`;

let failures = 0;
function check(what, ok, detail) {
  console.log(`${ok ? "ok" : "FAIL"} — ${what}`);
  if (!ok) {
    failures += 1;
    console.log(`    ${detail}`);
  }
}

/** Run next-versions.mjs against a plan, returning its outputs and log. */
function detect(plan) {
  const dir = mkdtempSync(join(tmpdir(), "next-versions-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const fakePnpm = join(bin, "pnpm");
  writeFileSync(fakePnpm, FAKE_PNPM);
  chmodSync(fakePnpm, 0o755);

  const planFile = join(dir, "plan.json");
  writeFileSync(planFile, JSON.stringify(plan));
  const argvLog = join(dir, "argv.log");
  writeFileSync(argvLog, "");
  const outputFile = join(dir, "github-output");
  writeFileSync(outputFile, "");

  // One directory per planned package, each with the package.json the script reads.
  const dirs = [];
  for (const pkg of Object.keys(plan)) {
    const pkgDir = join(dir, "packages", pkg);
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: `@selftest/${pkg}` }));
    dirs.push(pkgDir);
  }

  const run = spawnSync(process.execPath, [NEXT_VERSIONS], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_PLAN: planFile,
      FAKE_ARGV_LOG: argvLog,
      GITHUB_OUTPUT: outputFile,
      PUBLISH_DIRS: dirs.join(" "),
    },
  });

  const outputs = Object.fromEntries(
    readFileSync(outputFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
  return {
    outputs,
    argv: readFileSync(argvLog, "utf8"),
    log: `${run.stdout ?? ""}${run.stderr ?? ""}`,
    status: run.status,
  };
}

// ── A major is caught, and named ────────────────────────────────────────────
const major = detect({
  ui: { last: "5.0.0", next: "6.0.0", breaking: true },
  auth: { last: "1.22.0", next: "1.23.0" },
});

check(
  "a major bump sets has_major",
  major.outputs.has_major === "true",
  `expected "true", got ${JSON.stringify(major.outputs.has_major)}`,
);

check(
  "the approval prompt names the package and both versions",
  major.outputs.majors === "ui 5.0.0 -> 6.0.0 (from a BREAKING CHANGE footer)",
  `the reviewer approves from this string alone, so it has to carry what is\n    ` +
    `being spent. Got: ${JSON.stringify(major.outputs.majors)}`,
);

check(
  "a minor released alongside a major is not itself listed as one",
  major.outputs.releases.includes("auth 1.22.0 -> 1.23.0") &&
    !major.outputs.majors.includes("auth"),
  `releases: ${major.outputs.majors} / ${major.outputs.releases}`,
);

// ── The flag that makes this an analysis rather than a release ──────────────
check(
  "every invocation passes --dry-run",
  major.argv.trim().split("\n").every((line) => line.includes("--dry-run")),
  `without it this script TAGS AND PUBLISHES before the approval gate runs,\n    ` +
    `and a rejected major would be rejecting something already on npm. Argv:\n    ${major.argv}`,
);

check(
  "the tag format matches the release job's, so each package finds its own last tag",
  major.argv.includes("--tag-format ui-v${version}"),
  `a differing format makes every package look unreleased and reset to 1.0.0.\n    Argv:\n    ${major.argv}`,
);

// ── Non-majors, and the two states that merely look like one ───────────────
const minor = detect({ ui: { last: "5.0.0", next: "5.1.0" } });
check(
  "a minor bump does not trip the gate",
  minor.outputs.has_major === "false" && minor.status === 0,
  `has_major=${minor.outputs.has_major} status=${minor.status}`,
);

const first = detect({ brandnew: { next: "1.0.0" } });
check(
  "a package's FIRST release is not a major",
  first.outputs.has_major === "false" && first.outputs.releases === "brandnew null -> 1.0.0",
  `an untagged package is every package before its first release; gating those\n    ` +
    `would put an approval in front of adding a package. Got: ` +
    `has_major=${first.outputs.has_major} releases=${JSON.stringify(first.outputs.releases)}`,
);

const inferred = detect({ ui: { last: "5.0.0", next: "6.0.0" } });
check(
  "a major with no footer is attributed to the commit analysis, not invented prose",
  inferred.outputs.majors === "ui 5.0.0 -> 6.0.0 (from the commit analysis)",
  `the two ways a major arrives need different follow-up — one is a footer to\n    ` +
    `re-word, the other is a type to correct. Got: ${JSON.stringify(inferred.outputs.majors)}`,
);

const quiet = detect({ ui: { last: "5.0.0" } });
check(
  "a push that releases nothing reports nothing",
  quiet.outputs.has_major === "false" && quiet.outputs.releases === "",
  `releases=${JSON.stringify(quiet.outputs.releases)}`,
);

// ── The safety property ─────────────────────────────────────────────────────
const broken = detect({ ui: { last: "5.0.0", fail: true } });
check(
  "a dry run that cannot answer FAILS instead of reporting no major",
  broken.status !== 0,
  `the approval job runs only when has_major is "true", so swallowing this\n    ` +
    `error releases the major unreviewed. status=${broken.status}`,
);

check(
  "and it retries first, because that failure is the one this repo actually sees",
  /waiting \d+s, then attempt 2 of 3/.test(broken.log),
  `a TLS blip on the runner cost auth-v1.22.0 four days. Log:\n    ${broken.log.slice(-400)}`,
);

console.log(
  failures === 0
    ? "\nnext-versions.mjs gates majors, admits first releases, and refuses to guess"
    : `\n${failures} case(s) failed`,
);
process.exitCode = failures === 0 ? 0 : 1;
