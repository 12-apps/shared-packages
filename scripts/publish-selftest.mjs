#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Proves scripts/publish.mjs CLASSIFIES what npm says (#166).
 *
 * The script's whole job is to read one npm invocation's output and decide
 * between three things that look alike in a log: an ordinary skip, a blip worth
 * retrying, and a failure nobody can retry their way out of. Getting that wrong
 * is silent by construction — the wrong branch still exits, still prints npm's
 * own text, and only a human comparing runs would notice. `main` was red for a
 * day across five pushes (runs 31667899507 … 31682461784) because an ENEEDAUTH
 * from four packages with no npm Trusted Publisher fell through the generic
 * throw and read as a transient credentials problem.
 *
 * So each classification gets a case here, run through the REAL script — spawned
 * exactly as the workflow spawns it, against a temp workspace, with npm's own
 * words as the input. The npm on PATH is a shim that plays a scripted plan and
 * RECORDS every call, which is what lets a case assert the thing a log cannot
 * show you: how many times a package was attempted.
 *
 * The npm outputs below are verbatim from the Release job of run 31682461784
 * (and its healthy siblings) — a paraphrase would test this file's idea of what
 * npm prints rather than what it prints.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLISH = join(HERE, "publish.mjs");

const ENEEDAUTH = [
  "npm notice Publishing to https://registry.npmjs.org/ with tag latest and public access",
  "npm error code ENEEDAUTH",
  "npm error need auth This command requires you to be logged in to https://registry.npmjs.org",
  "npm error need auth You need to authorize this machine using `npm login`",
  "npm error A complete log of this run can be found in: /home/runner/.npm/_logs/run.log",
].join("\n");

const ALREADY_PUBLISHED = [
  "npm error code E403",
  "npm error 403 Forbidden - PUT https://registry.npmjs.org/@selftest%2fone",
  "npm error 403 You cannot publish over the previously published versions: 1.0.0.",
].join("\n");

const TRANSIENT = [
  "npm error code E409",
  "npm error 409 Conflict - PUT https://registry.npmjs.org/@selftest%2fone",
  "npm error 409 Failed to save packument",
].join("\n");

const OK = ["npm notice Publishing to https://registry.npmjs.org/", "+ @selftest/one@1.0.0"].join(
  "\n",
);

/**
 * The npm the script under test will find on PATH.
 *
 * CommonJS and extensionless on purpose: it has to be spawnable as the bare word
 * `npm`, which is how publish.mjs invokes it. It identifies the package from the
 * cwd npm was given (publish.mjs runs each publish inside the package directory),
 * appends that name to a call log, and replays the plan entry for this attempt —
 * the LAST entry repeats, so a plan of one failing step keeps failing however
 * often it is retried. That is what makes "was it retried?" answerable.
 */
const FAKE_NPM = `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require("node:fs");
const plan = JSON.parse(readFileSync(process.env.FAKE_NPM_PLAN, "utf8"));
const log = process.env.FAKE_NPM_CALLS;
const { name } = JSON.parse(readFileSync("package.json", "utf8"));
const before = readFileSync(log, "utf8").split("\\n").filter((line) => line === name).length;
appendFileSync(log, name + "\\n");
const steps = plan[name] || [];
const step = steps[Math.min(before, steps.length - 1)];
process.stdout.write(step.out + "\\n");
process.exit(step.status);
`;

function workspace(packages) {
  const root = mkdtempSync(join(tmpdir(), "publish-selftest-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  // Pins the shim to CommonJS whatever the surrounding tree says.
  writeFileSync(join(bin, "package.json"), '{"type":"commonjs"}\n');
  writeFileSync(join(bin, "npm"), FAKE_NPM);
  chmodSync(join(bin, "npm"), 0o755);

  const dirs = packages.map((pkg) => {
    const dir = join(root, pkg.name.replace(/[@/]/g, "_"));
    mkdirSync(dir);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "1.0.0", ...pkg }));
    return dir;
  });
  return { root, bin, dirs };
}

/** Runs the real scripts/publish.mjs over a scripted registry. */
function release(packages, plan) {
  const { root, bin, dirs } = workspace(packages);
  const calls = join(root, "calls.log");
  const planFile = join(root, "plan.json");
  const summary = join(root, "summary.md");
  writeFileSync(calls, "");
  writeFileSync(planFile, JSON.stringify(plan));
  writeFileSync(summary, "");

  const result = spawnSync(process.execPath, [PUBLISH], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      PUBLISH_DIRS: dirs.join(" "),
      FAKE_NPM_PLAN: planFile,
      FAKE_NPM_CALLS: calls,
      GITHUB_STEP_SUMMARY: summary,
    },
  });

  const logged = readFileSync(calls, "utf8").split("\n").filter(Boolean);
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    summary: readFileSync(summary, "utf8"),
    attempts: (name) => logged.filter((line) => line === name).length,
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

// ── ENEEDAUTH: the package has no Trusted Publisher ─────────────────────────
const WEDGED = "@selftest/wedged";
const eneedauth = release([{ name: WEDGED }], { [WEDGED]: [{ status: 1, out: ENEEDAUTH }] });

check("ENEEDAUTH fails the run", eneedauth.status === 1, `expected exit 1, got ${eneedauth.status}`);
check(
  "ENEEDAUTH is diagnosed as a missing Trusted Publisher, not as npm's 'log in'",
  eneedauth.output.includes(`no npm Trusted Publisher for ${WEDGED}`),
  `the diagnosis is missing from:\n${eneedauth.output}`,
);
check(
  "the diagnosis says a token-based first publish creates the name but not the publisher",
  /creates the NAME but not/i.test(eneedauth.output),
  "nothing in the output explains how a package gets into this state",
);
check(
  "the diagnosis says the package can publish no further version until it is fixed",
  /NO further version/i.test(eneedauth.output),
  "the output does not say the package is wedged, only that it failed",
);
check(
  "the diagnosis says where to configure it",
  ["Settings", "Trusted Publisher", "GitHub Actions", "12-apps/shared-packages", "ci.yml"].every(
    (part) => eneedauth.output.includes(part),
  ),
  "the remedy does not name npmjs.com → Settings → Trusted Publisher → GitHub Actions + repo + workflow",
);
check(
  "ENEEDAUTH is NOT retried",
  eneedauth.attempts(WEDGED) === 1,
  `npm was invoked ${eneedauth.attempts(WEDGED)} time(s) — a permanent failure must be attempted once`,
);
check(
  "ENEEDAUTH is not mistaken for TRANSIENT",
  !eneedauth.output.includes("transient registry error"),
  "the script announced a backoff for a failure no wait can fix",
);
check(
  "ENEEDAUTH is not mistaken for ALREADY_PUBLISHED",
  !eneedauth.output.includes(`skipped ${WEDGED}`) && eneedauth.output.includes(`failed: ${WEDGED}`),
  "the package was reported as an ordinary skip — the exact way a red release goes unnoticed",
);
check(
  "the run summary names the cause, not just the failure",
  eneedauth.summary.includes("no npm Trusted Publisher") && eneedauth.summary.includes(WEDGED),
  `GITHUB_STEP_SUMMARY said:\n${eneedauth.summary}`,
);

// ── The two classifications ENEEDAUTH must not have taken over ──────────────
const ONE = "@selftest/one";
const skip = release([{ name: ONE }], { [ONE]: [{ status: 1, out: ALREADY_PUBLISHED }] });
check("an already-published version is still a skip", skip.status === 0, `exit ${skip.status}`);
check(
  "the skip is reported as one",
  skip.output.includes(`skipped ${ONE}`) && !skip.output.includes("failed:"),
  skip.output,
);
check("a skip is attempted once", skip.attempts(ONE) === 1, `${skip.attempts(ONE)} attempt(s)`);

console.log("  …  retrying the transient case — the first backoff is a real 5s wait");
const retried = release([{ name: ONE }], {
  [ONE]: [
    { status: 1, out: TRANSIENT },
    { status: 0, out: OK },
  ],
});
check("a transient registry error still succeeds on retry", retried.status === 0, retried.output);
check(
  "a transient registry error is still retried",
  retried.attempts(ONE) === 2 && retried.output.includes("transient registry error"),
  `npm was invoked ${retried.attempts(ONE)} time(s)`,
);

// ── A wedged package is a real failure, so its dependents are held back ─────
const DEPENDENT = "@selftest/dependent";
const cascade = release(
  [{ name: WEDGED }, { name: DEPENDENT, dependencies: { [WEDGED]: "1.0.0" } }],
  { [WEDGED]: [{ status: 1, out: ENEEDAUTH }], [DEPENDENT]: [{ status: 0, out: OK }] },
);
check(
  "a package depending on a wedged one is not published",
  cascade.status === 1 && cascade.attempts(DEPENDENT) === 0,
  `exit ${cascade.status}, ${cascade.attempts(DEPENDENT)} attempt(s) on the dependent`,
);
check(
  "and is reported as held back rather than failed on its own",
  cascade.output.includes(`not attempted, dependency failed: ${DEPENDENT}`),
  cascade.output,
);

if (failures.length > 0) {
  console.error(`\nscripts/publish.mjs misclassified ${failures.length} case(s):\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}\n`);
  process.exit(1);
}

console.log("\nEvery publish outcome was classified as expected.");
