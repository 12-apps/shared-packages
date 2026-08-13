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
// its own failure — see NO_CREDENTIAL below.
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const DIRS = (process.env.PUBLISH_DIRS ?? "").split(/\s+/).filter(Boolean);
const DEP_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"];

// semantic-release bumps only the packages with releasable commits, so most of
// the list is normally at a version the registry already has. That is the
// ordinary outcome of a release, not an error.
const ALREADY_PUBLISHED = /cannot publish over the previously published versions/i;

// npm ended up with NO credential at all, and says so as "logged out".
//
// With no NODE_AUTH_TOKEN (the step deletes that npmrc line on purpose) npm's
// only route to a credential is to exchange the GitHub OIDC id-token, and the
// registry grants that exchange only for a package whose Trusted Publisher names
// this repo + workflow. When any link in that chain fails, npm's `oidc()`
// returns undefined and `npm publish` carries on unauthenticated — so the CLI
// reports the generic ENEEDAUTH it would print on a laptop that never ran
// `npm login`, and the run reads like a transient credentials blip.
//
// ENEEDAUTH is the SYMPTOM and not the diagnosis. npm's own lib/utils/oidc.js
// reaches that same `undefined` down six distinct paths — from a missing
// `id-token: write` to a 5xx from the registry to the genuine "this package has
// no Trusted Publisher" — and prints the SAME ENEEDAUTH for all of them. The
// cause is only knowable from the `oidc` lines npm logs at `verbose`; see
// OIDC_OUTCOMES, and PUBLISH_ARGS for why this script turns them on.
const NO_CREDENTIAL = /\bENEEDAUTH\b|You need to authorize this machine using/i;

// Failures worth another attempt. E409 is the packument-save race: publishing
// several packages back to back can outrun the registry's indexing, and npm's
// own remedy is to let it settle and try again.
const TRANSIENT =
  /\b(E409|E429|E5\d\d|ETIMEDOUT|ECONNRESET|EAI_AGAIN|ESOCKETTIMEDOUT)\b|Failed to save packument|socket hang up/i;

// `--loglevel verbose` is the whole reason this script can say anything about
// WHY npm had no credential. npm logs every OIDC outcome at `verbose` or
// `silly` and nothing at the default level, so a job log at default loglevel
// contains zero lines about the exchange — measured on run 31682461784, where
// grepping 4,765 lines for oidc/trusted/id-token found only this workflow's own
// echoed text. The evidence existed; the loglevel threw it away.
const PUBLISH_ARGS = ["publish", "--access", "public", "--loglevel", "verbose"];

// Every way npm's OIDC exchange can end, in npm's own words
// (npm/cli lib/utils/oidc.js — and the workflow runs `npm install -g npm@latest`
// right before this, so that is the code that runs). ORDER MATTERS: "Unknown
// error" is npm's placeholder for an exchange that threw before any response
// body existed, which is what a network-level failure looks like, so it has to
// be recognised ahead of the general "the registry answered with a reason" case.
//
// `retry` is whether another attempt could plausibly change the answer.
//
// This is a read of another tool's log wording, which can change between npm
// releases. That is why it only ever ADDS precision: when nothing here matches,
// `publish()` falls back to naming the evidence it does have rather than
// inventing a cause, and the two `silly`-level paths (a missing `id-token:
// write`, no id_token at all) print nothing at `verbose` and land in exactly
// that fallback.
const OIDC_OUTCOMES = [
  {
    match: /Successfully retrieved and set token/i,
    retry: false,
    read: () =>
      "npm DID obtain a credential from the OIDC exchange, so this is not a " +
      "missing Trusted Publisher — something after the exchange rejected it.",
  },
  {
    match: /Failed token exchange request with body message: Unknown error/i,
    retry: true,
    read: () =>
      "the OIDC token exchange never got an answer from the registry (npm " +
      "logged no body message, which is what a network-level failure looks like).",
  },
  {
    match: /Failed token exchange request with body message: (.+)/i,
    retry: false,
    read: (found) => `the registry REFUSED the OIDC token exchange: "${found[1].trim()}"`,
  },
  {
    match: /Failed to fetch id_token from GitHub/i,
    retry: true,
    read: () =>
      "GitHub's own id-token endpoint did not return a usable token, so the " +
      "exchange with the registry never happened.",
  },
  {
    match: /Failed because token exchange was missing the token in the response body/i,
    retry: true,
    read: () => "the registry answered the OIDC token exchange without a token in it.",
  },
  {
    match: /Failure with message: (.+)/i,
    retry: true,
    read: (found) => `npm's OIDC step threw: "${found[1].trim()}"`,
  },
];

const BACKOFF_MS = [5_000, 15_000, 30_000];
const ATTEMPTS = BACKOFF_MS.length + 1;

// `maxBuffer` explicitly, because the default is 1 MB and exceeding it does not
// merely truncate: spawnSync KILLS the child and returns `status: null`, so a
// publish that actually reached the registry comes back looking like a failure
// with a half-written explanation. A tarball notice is one line per file and
// `--loglevel verbose` adds a few hundred more per package, which moves that
// ceiling from theoretical to somewhere a big package could reach.
const MAX_OUTPUT = 64 * 1024 * 1024;

function npm(args, cwd = process.cwd()) {
  const run = spawnSync("npm", args, { cwd, encoding: "utf8", maxBuffer: MAX_OUTPUT });
  return {
    ok: run.status === 0,
    output: `${run.stdout ?? ""}${run.stderr ?? ""}`,
  };
}

// What npm printed, minus the machine chatter `--loglevel verbose` turns on.
//
// Verbose adds a few hundred lines per package, including a line per HTTP call.
// Printing that would bury npm's actual error block under its own telemetry and
// put request URLs in a public job log for no benefit — so DISPLAY drops it.
// npm's `oidc` lines are the exception and the entire point: they are kept.
// Classification still reads the unfiltered output.
//
// The exception is matched on npm's LOG PREFIX (`npm <level> oidc …`) rather
// than on the word appearing anywhere, because the exchange's own request line
// carries "oidc" in its URL — `POST …/-/npm/v1/oidc/token/exchange/package/…` —
// and keeping the http lines is exactly what this is here to avoid.
const NPM_CHATTER = /^npm (?:verb(?:ose)?|sill(?:y)?|http|timing)\b/;
const OIDC_LOG = /^npm \S+ oidc\b/i;
const OIDC = /\boidc\b/i;

function readable(output) {
  return output
    .split("\n")
    .filter((line) => !NPM_CHATTER.test(line) || OIDC_LOG.test(line))
    .join("\n");
}

function tail(output, lines = 12) {
  return readable(output).trim().split("\n").slice(-lines).join("\n");
}

// What npm said about the OIDC exchange, or null when it said nothing.
function oidcEvidence(output) {
  const lines = output.split("\n").filter((line) => OIDC.test(line));
  for (const outcome of OIDC_OUTCOMES) {
    const line = lines.find((candidate) => outcome.match.test(candidate));
    if (line) {
      return {
        retry: outcome.retry,
        reading: outcome.read(line.match(outcome.match)),
        line: line.trim(),
      };
    }
  }
  return null;
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

// The FIRST line, which is all a `::error::` annotation ever shows and the only
// part most readers see. It states what is known — npm finished with no
// credential — and attributes a cause only when npm's own oidc line supports
// one. This repo has already spent a day chasing an ENEEDAUTH; sending the next
// reader to a settings page that turns out to be correct is the same day again.
//
// With `--loglevel verbose` on, NO oidc line is itself evidence, and it points
// AWAY from the obvious answer: a package with no Trusted Publisher gets its
// exchange refused by the registry, and npm logs that refusal. Silence means
// npm never got as far as the exchange — the two paths it logs at `silly`
// (no `id-token: write`, no id_token at all) or an npm too old to have OIDC.
function headline(name, version, evidence) {
  if (evidence) {
    return `publish of ${name}@${version} failed: npm obtained no credential — ${evidence.reading}`;
  }
  return (
    `publish of ${name}@${version} failed: npm obtained no credential and logged no ` +
    "reason for it — check `id-token: write` on the job and npm >= 11.5.1 first, " +
    "since a missing Trusted Publisher would normally have logged the registry " +
    "refusing the exchange."
  );
}

// npm's ENEEDAUTH says "log in". Nobody can: this step publishes tokenlessly on
// purpose, so the fix is a settings page rather than a credential. Say so, say
// which of the several things that produce ENEEDAUTH npm actually reported, and
// say what state the package is left in — otherwise the next reader re-runs.
function noCredentialDiagnosis(name, version, output, evidence) {
  return [
    headline(name, version, evidence),
    "",
    "ENEEDAUTH is npm's way of saying it had no credential — not which of several",
    "things denied it one. This step has no token by design: it authenticates by",
    "exchanging the GitHub OIDC id-token, and the registry allows that exchange",
    "only for a package with a Trusted Publisher.",
    "",
    ...(evidence
      ? ["npm's own log line for the exchange:", `  ${evidence.line}`]
      : [
          "npm printed no `oidc` line at all, though this step runs it at",
          "`--loglevel verbose`. Of npm's six ways to end up without a credential,",
          "only two print nothing at that level — a job without `id-token: write`,",
          "and no id_token to exchange — and an npm older than 11.5.1 has no OIDC",
          "code to log from. Rule those out before the Trusted Publisher below:",
          "when a package simply has none, the registry refuses the exchange and",
          "npm logs the refusal here.",
        ]),
    "",
    "The state this repo produces more often than any other, and the one worth",
    "checking as soon as npm names a refusal: a package's first publish is made",
    "with NPM_TOKEN by scripts/first-publish.mjs, and that creates the NAME but not",
    "the Trusted Publisher — the two are separate, and the second one is manual. A",
    "package left that way is stuck: first-publish.mjs skips it (the name exists)",
    "and this step can never authenticate for it, so it will publish NO further",
    "version until a Trusted Publisher is configured.",
    "",
    `Configure one by hand: npmjs.com → ${name} → Settings → Trusted Publisher →`,
    "GitHub Actions, repository `12-apps/shared-packages`, workflow `ci.yml`.",
    `(https://www.npmjs.com/package/${name}/access)`,
    "",
    "npm said:",
    tail(output),
  ].join("\n");
}

// Whether another attempt could plausibly change the answer: either npm named a
// documented temporary error, or its oidc line says the exchange itself broke.
function worthRetrying(output, evidence) {
  return TRANSIENT.test(output) || evidence?.retry === true;
}

// Returns "published" or "skipped"; throws with what npm reported otherwise.
function publish(dir, name, version) {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const { ok, output } = npm(PUBLISH_ARGS, resolve(dir));
    console.log(tail(output, 40));
    if (ok) return "published";
    if (ALREADY_PUBLISHED.test(output)) return "skipped";

    // The retry test comes FIRST, and deliberately so. An output carrying both a
    // transient marker and ENEEDAUTH is the case where the two tests disagree,
    // and it is a real one: npm's oidc exchange swallows network errors,
    // timeouts and 5xx into the same credential-less ENEEDAUTH as a genuinely
    // missing Trusted Publisher. Retrying first costs at most ~50s of backoff
    // that was going to fail anyway; deciding "permanent" first costs a human a
    // trip to a settings page that is already correct, with the package still
    // broken at the end of it. When the retries are spent an ENEEDAUTH still
    // gets the full diagnosis below, so nothing is lost by trying.
    const evidence = oidcEvidence(output);
    if (worthRetrying(output, evidence) && attempt < ATTEMPTS) {
      const wait = BACKOFF_MS[attempt - 1];
      console.log(
        `transient registry error — waiting ${wait / 1000}s, then attempt ` +
          `${attempt + 1} of ${ATTEMPTS}`,
      );
      sleep(wait);
      continue;
    }
    if (NO_CREDENTIAL.test(output)) {
      const error = new Error(noCredentialDiagnosis(name, version, output, evidence));
      // Read by the caller so the run SUMMARY names this failure for what it is,
      // and so the tag check in the next step knows not to tell anyone to delete
      // this package's tag. The `::error::` annotation only ever shows a
      // message's first line, and the summary is the surface a human skims — it
      // is where "red again" has to stop looking like yesterday's auth blip.
      error.noCredential = true;
      throw error;
    }
    throw new Error(`publish of ${name}@${version} failed:\n${tail(output)}`);
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

// Tell the REST OF THE JOB which packages this run did not get onto the
// registry. The next step is scripts/verify-released.mjs, whose whole remedy for
// a tag the registry never received is "delete the tag and re-run" — correct for
// an orphan left behind by some earlier run, and wrong for one this run just
// made, because re-cutting the version walks straight back into the failure
// above. Without this handoff the two steps print opposite advice in the same
// job summary, and the reader has no way to tell which applies.
//
// GITHUB_ENV rather than a file: the runner reads it after the step exits
// (failed or not) and exports it to every later step, which is exactly the
// lifetime wanted. Outside Actions the variable is simply unset and
// verify-released.mjs behaves as it always did.
function handOff(names, variable) {
  if (!process.env.GITHUB_ENV || names.length === 0) return;
  appendFileSync(process.env.GITHUB_ENV, `${variable}=${names.join(" ")}\n`);
}

if (DIRS.length === 0) throw new Error("PUBLISH_DIRS is empty — nothing to publish");

// Names whose current version did not reach the registry in this run, whether
// they failed outright or were held back. Either way nothing may depend on one.
const missing = new Set();
const published = [];
const skipped = [];
const failed = [];
const blocked = [];
// A subset of `failed`: the ones npm could not authenticate for at all.
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
      if (error.noCredential) wedged.push(name);
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
        `**npm obtained no credential** for these, so a plain re-run is unlikely ` +
          `to help — the annotation above carries what npm reported about the OIDC ` +
          `exchange, and the commonest answer is a package with no Trusted ` +
          `Publisher (npmjs.com → package → Settings → Trusted Publisher → GitHub ` +
          `Actions, 12-apps/shared-packages, ci.yml): ${wedged.join(", ")}`,
      ]
    : []),
  ...(blocked.length > 0 ? [`not attempted, dependency failed: ${blocked.join(", ")}`] : []),
]);

handOff([...missing], "PUBLISH_INCOMPLETE");
handOff(wedged, "PUBLISH_WEDGED");

if (failed.length + blocked.length > 0) process.exitCode = 1;
