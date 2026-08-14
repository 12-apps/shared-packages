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
// classify() for how this reads the git error underneath instead.
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const DIRS = (process.env.PUBLISH_DIRS ?? "").split(/\s+/).filter(Boolean);

// git/curl transport failures, in git's own words. Every one of these is a
// property of the network between the runner and github.com at one instant, so
// the same command a few seconds later is a genuinely different question.
//
// `server certificate verification failed` is first because it is the one this
// repo has actually been bitten by; the rest are the neighbouring faults from
// git's transport layer that would behave identically and should not each need
// their own outage to get added.
const TRANSIENT_GIT =
  /server certificate verification failed|unable to access|Could not resolve host|Temporary failure in name resolution|Connection (?:timed out|reset)|Operation timed out|early EOF|RPC failed|gnutls_handshake|GnuTLS recv error|SSL(?:_ERROR|read|write| connect)|TLS connect error|the remote end hung up|HTTP 5\d\d|The requested URL returned error: 5\d\d|502 Bad Gateway|503 Service Unavailable/i;

// semantic-release's verdict when its preflight `git push --dry-run` fails, for
// ANY reason. Ambiguous by construction: it covers both a token that genuinely
// cannot push and a runner that could not reach github.com for a moment.
const NO_PERMISSION = /\bEGITNOPERMISSION\b/;

// The stale-ref race. Push runs are keyed by SHA (see the concurrency block in
// ci.yml), so two merges landing minutes apart release CONCURRENTLY on purpose.
// The older run's `HEAD:main` is then behind the ref it is pushing to, and git
// refuses it — which is correct, and which the next run resolves by definition.
const STALE_REF = /non-fast-forward|fetch first|Updates were rejected|cannot lock ref|reference already exists/i;

const BACKOFF_MS = [5_000, 15_000, 30_000];
const ATTEMPTS = BACKOFF_MS.length + 1;

// Explicit, because spawnSync's 1 MB default does not truncate — it KILLS the
// child and returns `status: null`, so a release that actually happened comes
// back looking like a failure. semantic-release at this repo's package count is
// comfortably into the megabytes.
const MAX_OUTPUT = 64 * 1024 * 1024;

/**
 * Synchronous on purpose: there is nothing to overlap with, and the point of a
 * backoff is that the next attempt does NOT start until the fault has had time
 * to clear.
 */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

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

/**
 * Whether another attempt could plausibly change the answer.
 *
 * The git transport error is read BEFORE the semantic-release error code,
 * because the code is a lossy summary of it: EGITNOPERMISSION means "the
 * preflight push did not succeed" and nothing more.
 *
 * A bare EGITNOPERMISSION with no transport error underneath is still retried,
 * on the same reasoning scripts/publish.mjs applies to ENEEDAUTH: if the token
 * really cannot push, three more attempts cost ~50s of a run that was going to
 * fail anyway, and the diagnosis at the end is unchanged. If it was the network,
 * retrying is the entire fix. The asymmetry is not close.
 */
function classify(output) {
  if (TRANSIENT_GIT.test(output)) return { retry: true, why: "a git transport failure" };
  if (STALE_REF.test(output)) return { retry: true, why: "a concurrent push to main" };
  if (NO_PERMISSION.test(output)) {
    return {
      retry: true,
      why:
        "EGITNOPERMISSION, which semantic-release reports for ANY failure of its " +
        "preflight `git push --dry-run` — including a transient one",
    };
  }
  return { retry: false, why: null };
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
 * Returns null when the package released (or had nothing to release, which
 * semantic-release also reports as success); returns the diagnosis otherwise.
 */
function releasePackage(dir, pkg) {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const { ok, output } = semanticRelease(dir, pkg);
    console.log(tail(output, 60));
    if (ok) return null;

    const { retry, why } = classify(output);
    if (retry && attempt < ATTEMPTS) {
      const wait = BACKOFF_MS[attempt - 1] / 1000;
      console.log(
        `::warning::${pkg}: semantic-release failed on ${why} — waiting ${wait}s, ` +
          `then attempt ${attempt + 1} of ${ATTEMPTS}`,
      );
      sleep(wait * 1000);
      continue;
    }
    return `${pkg}: semantic-release failed${retry ? ` after ${ATTEMPTS} attempts` : ""}\n${tail(output)}`;
  }
  return null;
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

// Every package is attempted, even after one fails. The loop is in topological
// order and a failure here means "this package did not get a NEW version" — it
// does not make the packages after it unreleasable, and stopping would strand
// the ones already tagged with no publish step to carry them to the registry.
for (const dir of DIRS) {
  const pkg = basename(dir);
  console.log(`::group::semantic-release ${pkg}`);
  const failure = releasePackage(dir, pkg);
  if (failure) {
    failed.push(pkg);
    failures.push(failure);
  }
  console.log("::endgroup::");
}

for (const failure of failures) console.log(`::error::${failure}`);

summarize([
  `${DIRS.length - failed.length} of ${DIRS.length} package(s) versioned and tagged`,
  ...(failed.length > 0
    ? [
        `**failed to tag**: ${failed.join(", ")} — the publish step still runs, so any ` +
          `package tagged before these still reaches the registry`,
      ]
    : []),
]);

handOff(failed, "TAG_FAILED");

if (failed.length > 0) process.exitCode = 1;
