// Version + tag every package with semantic-release, one package at a time.
//
// WHY this is a script and not the inline bash loop it replaces. That loop ran
// under `set -e`, so the FIRST package semantic-release failed for ended the
// whole step — every package after it went unreleased, and, far worse, the
// `Publish to npm` step never ran at all. Tagging and publishing are separate
// steps in this workflow, so anything already tagged by the time of the abort
// was left as a tag the registry never received: the silent, self-perpetuating
// state scripts/verify-released.mjs exists to catch.
//
// That is not hypothetical. Run 31427350698 tagged `auth-v1.22.0` (4th of 30 in
// PUBLISH_DIRS), reached `realtime` (11th), and died there. `@12-apps/auth` sat
// at 1.21.0 for four days while every later run reported success, and a consumer
// two repositories away found it as `Cannot find module '@12-apps/auth/react'`.
//
// And what killed `realtime` was worth retrying — which is the second reason
// this is a script. semantic-release reported:
//
//     EGITNOPERMISSION Cannot push to the Git repository.
//     ... missing push permission for the user configured via the Git
//     credentials on your CI environment
//
// while the line above it said what had actually happened:
//
//     The command "git push --dry-run --no-verify -- https://…/shared-packages.git
//     HEAD:main" failed with the error message fatal: unable to access '…':
//     server certificate verification failed. CAfile: none CRLfile: none.
//
// A TLS blip on the runner. semantic-release maps ANY failure of that preflight
// dry-run push onto EGITNOPERMISSION, so a five-second network fault and a
// genuinely unauthorised token are indistinguishable from the error code — see
// classifyGitFailure() for how this reads the git error underneath instead.
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { MAX_OUTPUT, classifyGitFailure, sleep } from "./lib/git-transience.mjs";
import { bumpFor } from "./lib/major-bump.mjs";

const DIRS = (process.env.PUBLISH_DIRS ?? "").split(/\s+/).filter(Boolean);

// The retry policy lives in ./lib/git-transience.mjs, shared with
// scripts/next-versions.mjs — the dry-run that gates a major bump meets the
// same transport faults as the release itself, and a second copy of that
// knowledge would drift silently toward reporting a blip as a real failure.

const BACKOFF_MS = [5_000, 15_000, 30_000];
const ATTEMPTS = BACKOFF_MS.length + 1;

/**
 * One package's release, run exactly as the workflow's bash loop used to.
 *
 * `pnpm exec`, not `pnpm dlx`: every .releaserc.json `extends` a module, so
 * semantic-release has to run with the workspace's node_modules on its
 * resolution path. Pinning it in package.json also means a release is no longer
 * built by whatever version happened to be latest that morning.
 *
 * What bounds each invocation to ONE package is `extends:
 * semantic-release-monorepo`, which filters the commit range down to commits
 * that touched this directory. Without it every run analysed the whole repo
 * history, so a single `feat(payments)` merge cut a release for all 30 packages
 * — 30 tags, 30 GitHub Releases and 30 PR comments per merge, for 29 packages
 * whose files had not changed at all.
 *
 * `--tag-format` keeps the tag scheme this repo already has (`ui-v1.2.3`, 700+
 * tags deep). It deliberately overrides the `@12-apps/ui-v1.2.3` that
 * semantic-release-monorepo would otherwise impose — under that scheme no
 * package would find its own last tag, every one would look unreleased, and
 * they would all reset to 1.0.0.
 *
 * The prefix is the DIRECTORY name, because payments ships as a nested
 * workspace: `packages/payments/backend` tags as `backend-v*`.
 */
function semanticRelease(dir, pkg) {
  const run = spawnSync("pnpm", ["exec", "semantic-release", "--tag-format", `${pkg}-v\${version}`], {
    cwd: resolve(dir),
    encoding: "utf8",
    maxBuffer: MAX_OUTPUT,
  });
  return { ok: run.status === 0, output: `${run.stdout ?? ""}${run.stderr ?? ""}` };
}

/** npm/semantic-release chatter that says nothing once the run has failed. */
const NOISE = /does not provide step|No more plugins|Start step|Completed step/;

function tail(output, lines = 25) {
  return output
    .split("\n")
    .filter((line) => !NOISE.test(line))
    .join("\n")
    .trim()
    .split("\n")
    .slice(-lines)
    .join("\n");
}

/**
 * Release ONE package, retrying while the failure looks transient.
 *
 * Returns `{ failure, output }`. `failure` is null when the package released
 * (or had nothing to release, which semantic-release also reports as success)
 * and the diagnosis otherwise; `output` is the last attempt's log, which
 * silentNoRelease() reads to tell those two successes apart.
 */
function releasePackage(dir, pkg) {
  let output = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const run = semanticRelease(dir, pkg);
    output = run.output;
    console.log(tail(output, 60));
    if (run.ok) return { failure: null, output };

    const { retry, why } = classifyGitFailure(output);
    if (retry && attempt < ATTEMPTS) {
      const wait = BACKOFF_MS[attempt - 1] / 1000;
      console.log(
        `::warning::${pkg}: semantic-release failed on ${why} — waiting ${wait}s, ` +
          `then attempt ${attempt + 1} of ${ATTEMPTS}`,
      );
      sleep(wait * 1000);
      continue;
    }
    return {
      failure: `${pkg}: semantic-release failed${retry ? ` after ${ATTEMPTS} attempts` : ""}\n${tail(output)}`,
      output,
    };
  }
  return { failure: null, output };
}

// semantic-release's own accounting of the range it analysed. Both lines come
// from the CORE rather than a plugin, so they do not move with plugin config.
// The FILTERED count — semantic-release-monorepo's, after it has narrowed the
// range to commits touching this package's directory.
//
// NOT the core's `Found N commits since last release`, which is what this first
// shipped as and which is wrong in the way that matters. That line is printed
// before the filter, so it is the whole repository's range: measured on `main`,
// prisma reports 15, eslint-config 133 and auth 43 — all non-zero, on every
// package, on every release. Reading it made the warning fire for all thirty
// and quote a count belonging to none of them, which is precisely the noise the
// "a package with NO commits in range is not reported" case exists to forbid.
// It passed only because the fixture it was written against was inferred rather
// than captured, and omitted a line real output always prints.
const COMMITS_IN_RANGE = /Analysis of (\d+) commits? complete/;
const NOTHING_RELEASED = /There are no relevant changes, so no new version is released/;

/**
 * The success that ships nothing: commits landed in this package's range and
 * NOT ONE of them produced a version.
 *
 * semantic-release exits 0 for both "nothing changed here" and "things changed
 * and none of them counted", and this step prints the same green line for each.
 * The second is almost always a mistake, and it is silent in the one direction
 * that matters — the fix is on main, the registry never gets it, and every later
 * run agrees there is nothing to do.
 *
 * How this repo met it: `fix(prisma)!: …` on main. The `!` shorthand is
 * conventionalcommits, and semantic-release runs the ANGULAR preset, whose
 * headerPattern does not allow it — so the header did not parse at all and the
 * commit was worth NO release rather than the major its author intended. It was
 * the only commit in range for prisma, mcp, notifications, onboarding and shift,
 * all five of which carried a production migration fix. `0 published, 30 already
 * on the registry`, exit 0, nothing said.
 *
 * A WARNING and not a failure, because the state is legitimate too: a
 * `docs(pkg)` or `test(pkg)` commit is a real change that correctly releases
 * nothing. Distinguishing intent from a commit message is not something this
 * script can do — naming the packages, so a human can, is.
 */
function silentNoRelease(output) {
  if (!NOTHING_RELEASED.test(output)) return 0;
  return Number((output.match(COMMITS_IN_RANGE) ?? [, "0"])[1]);
}

function summarize(lines) {
  console.log(lines.join("\n"));
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    ["### Version + tag", "", ...lines.map((line) => `- ${line}`), ""].join("\n"),
  );
}

/**
 * Tell the rest of the JOB which packages never got tagged.
 *
 * GITHUB_ENV rather than an output: the runner exports it to every later step
 * whether this one succeeded or not, which is the lifetime wanted — the steps
 * that read it are the ones that run precisely BECAUSE this step failed.
 */
function handOff(names, variable) {
  if (!process.env.GITHUB_ENV || names.length === 0) return;
  appendFileSync(process.env.GITHUB_ENV, `${variable}=${names.join(" ")}\n`);
}

if (DIRS.length === 0) throw new Error("PUBLISH_DIRS is empty — nothing to release");

const failures = [];
const failed = [];
const silent = [];
const majors = [];

// Every package is attempted, even after one fails. The loop is in topological
// order and a failure here means "this package did not get a NEW version" — it
// does not make the packages after it unreleasable, and stopping would strand
// the ones already tagged with no publish step to carry them to the registry.
for (const dir of DIRS) {
  const pkg = basename(dir);
  console.log(`::group::semantic-release ${pkg}`);
  const { failure, output } = releasePackage(dir, pkg);
  if (failure) {
    failed.push(pkg);
    failures.push(failure);
  } else {
    // `pkg:detail`, with no space in it, because handOff() joins on spaces.
    const count = silentNoRelease(output);
    if (count > 0) silent.push(`${pkg}:${count}`);
    const bump = bumpFor(output);
    if (bump?.major) majors.push({ pkg, why: bump.why });
  }
  console.log("::endgroup::");
}

for (const failure of failures) console.log(`::error::${failure}`);

for (const entry of silent) {
  const [pkg, count] = entry.split(":");
  console.log(
    `::warning::${pkg}: ${count} commit(s) in range and NO release. If any of them was ` +
      `meant to ship, its subject did not say so in a form the commit-analyzer reads — ` +
      `note the \`!\` breaking shorthand is NOT parsed by the angular preset, so use a ` +
      `BREAKING CHANGE footer`,
  );
}

for (const { pkg, why } of majors) {
  console.log(
    `::warning::${pkg}: cut a MAJOR, from ${why}. Note that \`BREAKING CHANGE\` at the ` +
      `start of any body line IS the footer, whether the sentence around it meant one or ` +
      `only mentioned one — and the commit guard wraps bodies at 100 characters, so a wrap ` +
      `can put it there`,
  );
}

summarize([
  `${DIRS.length - failed.length} of ${DIRS.length} package(s) versioned and tagged`,
  ...(majors.length > 0
    ? [`**major**: ${majors.map(({ pkg, why }) => `${pkg} (${why})`).join(", ")}`]
    : []),
  ...(failed.length > 0
    ? [
        `**failed to tag**: ${failed.join(", ")} — the publish step still runs, so any ` +
          `package tagged before these still reaches the registry`,
      ]
    : []),
  ...(silent.length > 0
    ? [
        `**changed but released nothing**: ${silent
          .map((entry) => entry.replace(":", " ("))
          .map((entry) => `${entry} commits)`)
          .join(", ")} — commits landed in these packages and none produced a version. ` +
          `Legitimate for docs/test/chore; a mistake for anything meant to ship`,
      ]
    : []),
]);

handOff(failed, "TAG_FAILED");
// Named for what a reader must check, not for a verdict this script cannot
// reach: the packages ARE changed, and whether that should have released is a
// judgement about intent that only the commit's author has.
handOff(silent, "CHANGED_NO_RELEASE");
handOff(
  majors.map(({ pkg }) => pkg),
  "RELEASED_MAJOR",
);

if (failed.length > 0) process.exitCode = 1;
