// Upload every package in PUBLISH_DIRS to npm over OIDC Trusted Publishing.
//
// WHY this is a script and not the inline bash loop it replaces. That loop
// appended every package's output to one publish.log and then asked whether the
// file contained npm's "already published" wording — so the first package to
// report an already-published version made that test true for every package
// after it, and a real failure late in the run was announced as a skip. It also
// had no notion of a failure worth retrying, so the registry's 409
// packument-save race took a whole release down with it. Here each package's
// result is read from its own npm invocation, and only the errors the registry
// documents as temporary are retried.
//
// This runs after scripts/first-publish.mjs, which is the only step that uses a
// token: a package's first publish cannot go through OIDC. By the time we get
// here every name exists on the registry — but a NAME is not an entitlement.
// first-publish.mjs authenticates with NPM_TOKEN, and a token publish creates
// the package without creating its Trusted Publisher, which is a separate,
// manual, per-package setting on npmjs.com. So "the name exists" does not imply
// "this workflow may publish it tokenlessly", and the gap between those two is
// its own failure — see NO_TRUSTED_PUBLISHER below.
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const DIRS = (process.env.PUBLISH_DIRS ?? "").split(/\s+/).filter(Boolean);
const DEP_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"];

// semantic-release bumps only the packages with releasable commits, so most of
// the list is normally at a version the registry already has. That is the
// ordinary outcome of a release, not an error.
const ALREADY_PUBLISHED = /cannot publish over the previously published versions/i;

// The package has no Trusted Publisher, and this step has no other credential.
//
// npm does not fail this as "forbidden" — it fails it as "logged out". With no
// NODE_AUTH_TOKEN (the step deletes that npmrc line on purpose) npm's only route
// to a credential is to exchange the GitHub OIDC id-token, and the registry
// grants that exchange only for a package whose Trusted Publisher names this
// repo + workflow. No Trusted Publisher, no exchange, no credential — so the CLI
// reports the generic ENEEDAUTH it would print on a laptop that never ran
// `npm login`, and the run reads like a transient credentials blip.
//
// It is the opposite of transient: it is permanent until a human configures the
// publisher, and it is the standing state of every package first published with
// a token (see the header). Matched here so it is diagnosed by name and never
// retried.
const NO_TRUSTED_PUBLISHER = /\bENEEDAUTH\b|You need to authorize this machine using/i;

// Failures worth another attempt. E409 is the packument-save race: publishing
// several packages back to back can outrun the registry's indexing, and npm's
// own remedy is to let it settle and try again.
const TRANSIENT =
  /\b(E409|E429|E5\d\d|ETIMEDOUT|ECONNRESET|EAI_AGAIN|ESOCKETTIMEDOUT)\b|Failed to save packument|socket hang up/i;

const BACKOFF_MS = [5_000, 15_000, 30_000];
const ATTEMPTS = BACKOFF_MS.length + 1;

function npm(args, cwd = process.cwd()) {
  const run = spawnSync("npm", args, { cwd, encoding: "utf8" });
  return {
    ok: run.status === 0,
    output: `${run.stdout ?? ""}${run.stderr ?? ""}`,
  };
}

function tail(output, lines = 12) {
  return output.trim().split("\n").slice(-lines).join("\n");
}

// Synchronous on purpose: every other call here is spawnSync, and a retry has
// nothing to overlap with — the point is that the next attempt does not start
// until the registry has had time to catch up.
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function manifest(dir) {
  return JSON.parse(readFileSync(join(resolve(dir), "package.json"), "utf8"));
}

// npm's ENEEDAUTH says "log in". Nobody can: this step publishes tokenlessly on
// purpose, so the actionable fact is the missing Trusted Publisher and the fix
// is a settings page, not a credential. Say both, and say that the package is
// wedged until someone does it — otherwise the next reader retries the run.
function noTrustedPublisherDiagnosis(name, version, output) {
  return [
    `publish of ${name}@${version} failed: no npm Trusted Publisher for ${name}.`,
    "",
    "npm reported ENEEDAUTH. This step has no token by design — it authenticates",
    "by exchanging the GitHub OIDC id-token, and the registry allows that exchange",
    `only for a package with a Trusted Publisher. ${name} has none, so npm ended up`,
    "with no credential at all and reported it as being logged out.",
    "",
    "This is NOT transient and is not retried. A package's first publish is made",
    "with NPM_TOKEN by scripts/first-publish.mjs, and that creates the NAME but not",
    "the Trusted Publisher — the two are separate, and the second one is manual. So",
    "this package is stuck: first-publish.mjs now skips it (the name exists) and",
    "this step can never authenticate for it. It will publish NO further version",
    "until a Trusted Publisher is configured.",
    "",
    `Fix it once, by hand: npmjs.com → ${name} → Settings → Trusted Publisher →`,
    "GitHub Actions, repository `12-apps/shared-packages`, workflow `ci.yml`.",
    `(https://www.npmjs.com/package/${name}/access)`,
    "",
    "If this package DOES have one, then the exchange itself broke rather than the",
    "trust: check that the job still grants `id-token: write` and that the `Upgrade",
    "npm for OIDC` step ran (trusted publishing needs npm >= 11.5.1). Both leave",
    "npm with no credential too, and npm reports all three the same way.",
    "",
    "npm said:",
    tail(output),
  ].join("\n");
}

// Returns "published" or "skipped"; throws with what npm reported otherwise.
function publish(dir, name, version) {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const { ok, output } = npm(["publish", "--access", "public"], resolve(dir));
    console.log(tail(output, 40));
    if (ok) return "published";
    if (ALREADY_PUBLISHED.test(output)) return "skipped";
    // Ahead of the TRANSIENT test, so a missing Trusted Publisher can never be
    // mistaken for a blip and burn the backoff before failing anyway.
    if (NO_TRUSTED_PUBLISHER.test(output)) {
      const error = new Error(noTrustedPublisherDiagnosis(name, version, output));
      // Read by the caller so the run SUMMARY names this failure for what it is.
      // The `::error::` annotation only ever shows a message's first line, and
      // the summary is the surface a human skims — it is where "red again" has
      // to stop looking like the same anonymous auth blip as yesterday.
      error.noTrustedPublisher = true;
      throw error;
    }
    if (!TRANSIENT.test(output) || attempt === ATTEMPTS) {
      throw new Error(`publish of ${name}@${version} failed:\n${tail(output)}`);
    }
    const wait = BACKOFF_MS[attempt - 1];
    console.log(
      `transient registry error — waiting ${wait / 1000}s, then attempt ` +
        `${attempt + 1} of ${ATTEMPTS}`,
    );
    sleep(wait);
  }
}

// PUBLISH_DIRS is in topological order and prepare-publish.mjs has already
// rewritten interdeps to concrete sibling versions, so a package whose
// dependency just failed would go to the registry with a manifest pointing at a
// version that is not there — an install that resolves to nothing. Hold it back
// instead, and say which failure held it.
function blockedBy(pkg, missing) {
  return DEP_FIELDS.flatMap((field) => Object.keys(pkg[field] ?? {})).filter((dep) =>
    missing.has(dep),
  );
}

function summarize(lines) {
  console.log(lines.join("\n"));
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    ["### Publish", "", ...lines.map((line) => `- ${line}`), ""].join("\n"),
  );
}

if (DIRS.length === 0) throw new Error("PUBLISH_DIRS is empty — nothing to publish");

// Names whose current version did not reach the registry in this run, whether
// they failed outright or were held back. Either way nothing may depend on one.
const missing = new Set();
const published = [];
const skipped = [];
const failed = [];
const blocked = [];
// A subset of `failed`: the ones that failed for a reason no re-run can fix.
const wedged = [];

for (const dir of DIRS) {
  const pkg = manifest(dir);
  const { name, version } = pkg;
  console.log(`::group::npm publish ${name}@${version}`);
  const holdingItBack = blockedBy(pkg, missing);
  if (holdingItBack.length > 0) {
    console.log(`::error::not published — depends on ${holdingItBack.join(", ")}, which did not publish`);
    blocked.push(name);
    missing.add(name);
  } else {
    try {
      const outcome = publish(dir, name, version);
      (outcome === "published" ? published : skipped).push(name);
      console.log(`${outcome} ${name}@${version}`);
    } catch (error) {
      console.log(`::error::${error.message}`);
      failed.push(name);
      if (error.noTrustedPublisher) wedged.push(name);
      missing.add(name);
    }
  }
  console.log("::endgroup::");
}

summarize([
  `${published.length} published, ${skipped.length} already on the registry`,
  ...(failed.length > 0 ? [`failed: ${failed.join(", ")}`] : []),
  ...(wedged.length > 0
    ? [
        `**no npm Trusted Publisher** (re-running will NOT help — configure one at ` +
          `npmjs.com → package → Settings → Trusted Publisher → GitHub Actions, ` +
          `12-apps/shared-packages, ci.yml): ${wedged.join(", ")}`,
      ]
    : []),
  ...(blocked.length > 0 ? [`not attempted, dependency failed: ${blocked.join(", ")}`] : []),
]);

if (failed.length + blocked.length > 0) process.exitCode = 1;
