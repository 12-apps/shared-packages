#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALREADY_PUBLISHED,
  BOTH_TOKENS,
  ENEEDAUTH,
  EXCHANGE_BROKE,
  OK,
  REFUSAL,
  REFUSED,
  TRANSIENT,
} from "./publish-selftest-fixtures.mjs";

/**
 * Proves scripts/publish.mjs CLASSIFIES what npm says (#166).
 *
 * The script's whole job is to read one npm invocation's output and decide
 * between things that look alike in a log: an ordinary skip, a blip worth
 * retrying, and a failure nobody can retry their way out of. Getting that wrong
 * is silent by construction — the wrong branch still exits, still prints npm's
 * own text, and only a human comparing runs would notice. `main` was red for a
 * day across five pushes (runs 31667899507 … 31682461784) because an ENEEDAUTH
 * from four packages npm could not authenticate for fell through the generic
 * throw and read as a transient credentials problem.
 *
 * So each classification gets a case here, run through the REAL script — spawned
 * exactly as the workflow spawns it, against a temp workspace, with npm's own
 * words as the input. The npm on PATH is a shim that plays a scripted plan and
 * RECORDS every call and its arguments, which is what lets a case assert the
 * things a log cannot show you: how many times a package was attempted, how npm
 * was asked to run, and what the script handed to the step after it.
 *
 * The npm outputs live in ./publish-selftest-fixtures.mjs, where each one states
 * whether it was copied from run 31682461784 or constructed — the difference
 * between testing npm and testing this repo's idea of npm.
 *
 * COST: three cases exercise a real retry at a real 5s first backoff, so this
 * takes ~17s wall. The wait is left honest rather than made configurable for the
 * test's convenience.
 *
 * Assertions on the diagnosis match the FACTS a reader must come away with
 * rather than whole sentences: `release` needs this job, so an assertion on
 * exact prose would let a wording edit halt publishing.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLISH = join(HERE, "publish.mjs");

/**
 * The npm the script under test will find on PATH.
 *
 * CommonJS and extensionless on purpose: it has to be spawnable as the bare word
 * `npm`, which is how publish.mjs invokes it. It identifies the package from the
 * cwd npm was given (publish.mjs runs each publish inside the package directory),
 * appends that name to a call log, and replays the plan entry for this attempt —
 * the LAST entry repeats, so a plan of one failing step keeps failing however
 * often it is retried. That is what makes "was it retried?" answerable.
 *
 * A step's optional `pad` prefixes that many lines of chatter, which is how a
 * case can be about the SIZE of npm's output rather than its wording. It writes
 * with `writeSync` rather than `process.stdout.write`, because writes to a pipe
 * are async and `process.exit` does not flush them — at these sizes the shim
 * would silently drop most of its own output and the case would prove nothing.
 */
const FAKE_NPM = `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeSync } = require("node:fs");
const plan = JSON.parse(readFileSync(process.env.FAKE_NPM_PLAN, "utf8"));
const log = process.env.FAKE_NPM_CALLS;
const { name } = JSON.parse(readFileSync("package.json", "utf8"));
const before = readFileSync(log, "utf8").split("\\n").filter((line) => line === name).length;
appendFileSync(log, name + "\\n");
appendFileSync(process.env.FAKE_NPM_ARGV, process.argv.slice(2).join(" ") + "\\n");
const steps = plan[name] || [];
const step = steps[Math.min(before, steps.length - 1)];
if (step.pad) writeSync(1, "npm verbose padding for the buffer case\\n".repeat(step.pad));
writeSync(1, step.out + "\\n");
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
  const argv = join(root, "argv.log");
  // The runner's step-to-step channel. publish.mjs writes the names it did not
  // get onto the registry here, and the tag check in the next step reads them.
  const handoff = join(root, "github.env");
  for (const file of [calls, summary, argv, handoff]) writeFileSync(file, "");
  writeFileSync(planFile, JSON.stringify(plan));

  const result = spawnSync(process.execPath, [PUBLISH], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      PUBLISH_DIRS: dirs.join(" "),
      FAKE_NPM_PLAN: planFile,
      FAKE_NPM_CALLS: calls,
      FAKE_NPM_ARGV: argv,
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

/** The `::error::` annotation only ever surfaces a message's FIRST line. */
function annotation(output) {
  return (output.split("\n").find((line) => line.startsWith("::error::")) ?? "").slice(9);
}

// ── ENEEDAUTH with npm saying nothing about why: run 31682461784 exactly ────
const WEDGED = "@selftest/wedged";
const eneedauth = release([{ name: WEDGED }], { [WEDGED]: [{ status: 1, out: ENEEDAUTH }] });

check("ENEEDAUTH fails the run", eneedauth.status === 1, `expected exit 1, got ${eneedauth.status}`);
check(
  "npm is asked for the oidc lines in the first place",
  // `.length > 0` because `.every` on no invocations at all is vacuously true,
  // and "npm was never run" must not read as "npm was run correctly".
  eneedauth.argv.length > 0 &&
    eneedauth.argv.every((call) => /(^|\s)--loglevel[=\s]verbose(\s|$)/.test(call)),
  `npm logs every OIDC outcome at verbose or silly and NOTHING at the default\n    loglevel, so a publish run at the default level throws away the only evidence\n    of why it had no credential. npm was invoked as:\n    ${eneedauth.argv.join("\n    ")}`,
);
check(
  "the annotation states the evidence — npm got no credential — rather than a cause npm never reported",
  /no credential/i.test(annotation(eneedauth.output)) &&
    /trusted publisher/i.test(annotation(eneedauth.output)) &&
    /id-token/i.test(annotation(eneedauth.output)),
  `npm printed no oidc line, so the first line must name npm's outcome and offer\n    the candidate causes, not pick one. It said:\n    ${annotation(eneedauth.output)}`,
);
check(
  "the diagnosis says a token-based first publish creates the name but not the publisher",
  /creates\s+the\s+NAME\s+but\s+not/i.test(eneedauth.output),
  "nothing in the output explains how a package gets into this state",
);
check(
  "the diagnosis says the package can publish no further version until it is fixed",
  /no further\s+version/i.test(eneedauth.output),
  "the output does not say the package is wedged, only that it failed",
);
check(
  "the diagnosis gives the remedy's coordinates",
  [/trusted publisher/i, /npmjs\.com/i, /12-apps\/shared-packages/, /ci\.yml/].every((part) =>
    part.test(eneedauth.output),
  ),
  "the remedy does not name the Trusted Publisher setting, npmjs.com, the repo and the workflow",
);
check(
  "ENEEDAUTH with no retryable marker is NOT retried",
  eneedauth.attempts(WEDGED) === 1,
  `npm was invoked ${eneedauth.attempts(WEDGED)} time(s) — nothing here suggests waiting would help`,
);
check(
  "ENEEDAUTH is not mistaken for TRANSIENT",
  !eneedauth.output.includes("transient registry error"),
  "the script announced a backoff for a failure with no transient marker in it",
);
check(
  "ENEEDAUTH is not mistaken for ALREADY_PUBLISHED",
  !eneedauth.output.includes(`skipped ${WEDGED}`) && eneedauth.output.includes(`failed: ${WEDGED}`),
  "the package was reported as an ordinary skip — the exact way a red release goes unnoticed",
);
check(
  "the run summary names the outcome, not just the failure",
  /no credential/i.test(eneedauth.summary) && eneedauth.summary.includes(WEDGED),
  `GITHUB_STEP_SUMMARY said:\n${eneedauth.summary}`,
);
check(
  "the failure is handed to the tag check, which must not tell anyone to delete this package's tag",
  eneedauth.handoff.includes(`PUBLISH_WEDGED=${WEDGED}`) &&
    eneedauth.handoff.includes(`PUBLISH_INCOMPLETE=${WEDGED}`),
  `verify-released.mjs's standing remedy is "delete the tag and re-run", which is\n    the opposite of this diagnosis. GITHUB_ENV got:\n${eneedauth.handoff}`,
);

// ── ENEEDAUTH with npm's oidc line saying the registry REFUSED the exchange ──
const REFUSED_PKG = "@selftest/refused";
const refused = release([{ name: REFUSED_PKG }], { [REFUSED_PKG]: [{ status: 1, out: REFUSED }] });

check(
  "the registry's own reason is surfaced, though npm printed it far from the end of its output",
  refused.output.includes(REFUSAL),
  `npm logs the exchange's outcome once, near the TOP of a verbose run — a tail of\n    the output loses it, and it is the only evidence there is. Output:\n${refused.output}`,
);
check(
  "a refused exchange is still a permanent failure",
  refused.status === 1 && refused.attempts(REFUSED_PKG) === 1,
  `exit ${refused.status} after ${refused.attempts(REFUSED_PKG)} attempt(s)`,
);
check(
  "npm's verbose chatter does not reach the job log, but its oidc line does",
  !/npm verbose (cwd|exit|stack)/.test(refused.output) &&
    !refused.output.includes("npm http fetch") &&
    refused.output.includes("npm verbose oidc"),
  "`--loglevel verbose` adds a few hundred lines per package, one of them an http\n    line whose URL contains `oidc`. Only npm's own oidc LOG lines are wanted.",
);

// ── ENEEDAUTH whose oidc line says the exchange itself broke ────────────────
console.log("  …  three retry cases follow — each pays a real 5s first backoff");
const BROKE_PKG = "@selftest/broke";
const broke = release([{ name: BROKE_PKG }], {
  [BROKE_PKG]: [
    { status: 1, out: EXCHANGE_BROKE },
    { status: 0, out: OK },
  ],
});
check(
  "an ENEEDAUTH whose oidc line says the exchange never got an answer IS retried",
  broke.status === 0 && broke.attempts(BROKE_PKG) === 2,
  `npm swallows network errors, timeouts and 5xx into the same credential-less\n    ENEEDAUTH as a genuinely unconfigured package. exit ${broke.status} after\n    ${broke.attempts(BROKE_PKG)} attempt(s)`,
);

// ── The one output where the two tests disagree: both markers at once ───────
const BOTH_PKG = "@selftest/both";
const both = release([{ name: BOTH_PKG }], {
  [BOTH_PKG]: [
    { status: 1, out: BOTH_TOKENS },
    { status: 0, out: OK },
  ],
});
check(
  "an output carrying BOTH a transient marker and ENEEDAUTH is retried, not called permanent",
  both.status === 0 && both.attempts(BOTH_PKG) === 2,
  `the retry costs at most ~50s of backoff that was going to fail anyway; calling it\n    permanent costs a human a trip to a settings page that is already correct.\n    exit ${both.status} after ${both.attempts(BOTH_PKG)} attempt(s)`,
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
check(
  "a skip tells the tag check nothing — its version IS on the registry",
  !skip.handoff.includes(ONE),
  `an unremarkable skip must not suppress the tag check's remedy. GITHUB_ENV got:\n${skip.handoff}`,
);

// ── Output too big for spawnSync's 1 MB default ─────────────────────────────
// Exceeding maxBuffer does not truncate, it KILLS npm and returns status null,
// so a publish that reached the registry comes back looking like a failure.
// `--loglevel verbose` is what makes that ceiling reachable for a big package.
const BIG = "@selftest/big";
const big = release([{ name: BIG }], {
  [BIG]: [{ status: 1, out: ALREADY_PUBLISHED, pad: 40_000 }],
});
check(
  "2 MB of npm output is still classified, not cut off mid-stream",
  big.status === 0 && big.output.includes(`skipped ${BIG}`),
  `exit ${big.status} — spawnSync needs an explicit maxBuffer or it kills npm here`,
);

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
check(
  "the held-back package is handed to the tag check too — its version is not on the registry either",
  new RegExp(`PUBLISH_INCOMPLETE=.*${DEPENDENT}`).test(cascade.handoff),
  `GITHUB_ENV got:\n${cascade.handoff}`,
);

if (failures.length > 0) {
  console.error(`\nscripts/publish.mjs misclassified ${failures.length} case(s):\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}\n`);
  process.exit(1);
}

console.log("\nEvery publish outcome was classified as expected.");
