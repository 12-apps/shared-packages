// Which packages this push would release, and which of those would be MAJOR.
//
// Runs BEFORE scripts/release-tags.mjs, on the same commits, and writes nothing:
// every invocation is `semantic-release --dry-run`, which analyses and reports
// but does not tag, push or publish. That ordering is the whole safety property
// — a major that is rejected at the approval gate leaves no tag behind, so the
// repo is in exactly the state it was before the push, and the next merge can
// re-cut the version normally. Gating AFTER the tag step would instead strand
// tags the registry never received: the silent, self-perpetuating state
// scripts/verify-released.mjs exists to catch.
//
// WHY this gate exists. semantic-release derives the bump from commit subjects,
// so a `!` or a `BREAKING CHANGE:` footer is enough to cut a major — and a major
// is not a number, it is a migration in every consuming repo. Adopters pin
// @12-apps/* EXACTLY, so a major nobody planned is not picked up and quietly
// ignored: it stalls the pin, and the adopter drifts further behind with every
// later release. One adopter was measured at six majors behind, and a single
// package twelve releases behind, when this was written. The bump itself is
// often correct; what was missing was a human deciding WHEN to spend it.
//
// Output is GitHub Actions step outputs. The `detect-majors` job that consumed
// them is gone with the post-merge gate — a major is consented to on the pull
// request now, before it can reach main — but the analysis is kept, and kept
// asserted by its own selftest, as the standing answer to "what would this
// push publish":
//   has_major  "true" | "false"   — whether this push would cut any major
//   majors     "ui 5.0.0 -> 6.0.0, auth 1.22.0 -> 2.0.1"
//   releases   every package that would release, major or not
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { MAX_OUTPUT, classifyGitFailure, sleep } from "./lib/git-transience.mjs";
import { bumpFor } from "./lib/major-bump.mjs";
import { publishDirs } from "./lib/release-state.mjs";

const BACKOFF_MS = [5_000, 15_000];
const ATTEMPTS = BACKOFF_MS.length + 1;

/**
 * One package's analysis — the release job's invocation with `--dry-run` added.
 *
 * Everything else is deliberately identical to scripts/release-tags.mjs:
 * `pnpm exec` so the workspace's node_modules are on the resolution path (every
 * .releaserc.json `extends` a module), the same `--tag-format` so the package
 * finds its own last tag, and the same cwd so `semantic-release-monorepo`
 * filters the commit range to this directory. A dry run that differed in any of
 * those would be analysing a different question from the one the release
 * answers, and the gate would be reporting on a release that never happens.
 */
function analyse(dir, pkg) {
  const run = spawnSync(
    "pnpm",
    ["exec", "semantic-release", "--dry-run", "--tag-format", `${pkg}-v\${version}`],
    { cwd: resolve(dir), encoding: "utf8", maxBuffer: MAX_OUTPUT },
  );
  return { ok: run.status === 0, output: `${run.stdout ?? ""}${run.stderr ?? ""}` };
}

/** Analyse one package, retrying while the failure looks transient. */
function analyseWithRetry(dir, pkg) {
  let output = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const run = analyse(dir, pkg);
    output = run.output;
    if (run.ok) return { failure: null, output };

    const { retry, why } = classifyGitFailure(output);
    if (retry && attempt < ATTEMPTS) {
      const wait = BACKOFF_MS[attempt - 1] / 1000;
      console.log(
        `::warning::${pkg}: dry-run failed on ${why} — waiting ${wait}s, ` +
          `then attempt ${attempt + 1} of ${ATTEMPTS}`,
      );
      sleep(wait * 1000);
      continue;
    }
    return { failure: why ?? "semantic-release --dry-run failed", output };
  }
  return { failure: "exhausted attempts", output };
}

/**
 * What this push would do to one package: null when it releases nothing.
 *
 * The bump itself is read by ./lib/major-bump.mjs, the same function
 * scripts/release-tags.mjs uses to name a major after the fact — so the gate
 * and the warning can never disagree about what a major is.
 */
function planFor(dir) {
  const pkg = basename(dir);
  const { name } = JSON.parse(readFileSync(join(resolve(dir), "package.json"), "utf8"));
  const { failure, output } = analyseWithRetry(dir, pkg);
  if (failure) return { name, pkg, failure, output };

  const bump = bumpFor(output);
  if (!bump) return null;

  return { name, pkg, ...bump, failure: null };
}

function emit(outputs) {
  const file = process.env.GITHUB_OUTPUT;
  const text = Object.entries(outputs)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  if (file) appendFileSync(file, `${text}\n`);
  console.log(text);
}

const dirs = publishDirs();
if (dirs.length === 0) throw new Error("no publishable packages — nothing to analyse");

const plans = [];
const failures = [];

for (const dir of dirs) {
  const plan = planFor(dir);
  if (!plan) continue;
  if (plan.failure) {
    failures.push(plan);
    continue;
  }
  plans.push(plan);
}

// A dry run that could not answer is NOT "no major". Failing here costs a
// re-run; assuming the safe-looking answer would let the very release this gate
// exists to catch through unreviewed, which is the one outcome worth being
// noisy about.
if (failures.length > 0) {
  for (const { pkg, failure, output } of failures) {
    console.log(`::error::${pkg}: could not determine the next version — ${failure}`);
    console.log(output.split("\n").slice(-25).join("\n"));
  }
  throw new Error(`${failures.length} package(s) could not be analysed — refusing to guess`);
}

const majors = plans.filter((plan) => plan.major);
const describe = (plan) => `${plan.pkg} ${plan.last} -> ${plan.next}`;
const describeMajor = (plan) => `${describe(plan)} (from ${plan.why})`;

emit({
  has_major: majors.length > 0 ? "true" : "false",
  majors: majors.map(describeMajor).join(", "),
  releases: plans.map(describe).join(", "),
});

if (plans.length === 0) {
  console.log("::notice::no package releases from this push");
} else if (majors.length === 0) {
  console.log(`::notice::${plans.length} package(s) release, none major`);
} else {
  console.log(
    `::warning::${majors.length} MAJOR bump(s) awaiting approval: ${majors.map(describeMajor).join(", ")}`,
  );
}
