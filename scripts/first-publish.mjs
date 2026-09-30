// Publish the packages that are not on the registry yet — and nothing else.
//
// WHY: OIDC Trusted Publishing cannot make a package's FIRST publish. A Trusted
// Publisher is configured from a package's settings page on npmjs.com, and that
// page exists only once the package does, so a name nobody has published has
// nowhere to point the trust at and the tokenless publish 404s (npm/cli#8544).
// Exactly one token-authenticated publish per package is the way in; from the
// next release onward the tokenless loop in cd.yml handles it as usual.
//
// This runs before that loop and leaves it alone. Packages already on the
// registry are never touched here, and with no NPM_TOKEN secret set the whole
// step is a no-op — publishing then behaves exactly as it did before.
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { publishDirs } from "./lib/release-state.mjs";

const REGISTRY = "https://registry.npmjs.org";
// Through the helper, so this still resolves when no PUBLISH_DIRS is set —
// cd.yml sets none. See publishDirs() for why that is not a bug there.
const DIRS = publishDirs();

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

function accessUrl(name) {
  return `https://www.npmjs.com/package/${name}/access`;
}

// Who the token says we are — established BEFORE anything else, because every
// reading below depends on it and none of them can tell that it went wrong.
//
// A token that is expired, revoked, or scoped to another org reads the registry
// exactly like no token at all. `npm view` then 404s on every RESTRICTED
// package, `isOnRegistry` reads that as "the name is free", `firstPublish`
// attempts a publish it cannot authenticate, and npm reports THAT as a 404 on
// the PUT — a message with nothing in it about credentials, pointing instead at
// the one explanation that is not the cause. This step has actually failed that
// way, and the day it cost went entirely on the wrong explanations. One extra
// call turns the whole chain into the sentence it should have been.
function whoami() {
  const { ok, output } = npm(["whoami", `--registry=${REGISTRY}`]);
  if (ok) return output.trim();
  throw new Error(
    [
      "NPM_TOKEN did not authenticate against the registry, so nothing below",
      "this line could be trusted: an unauthenticated read cannot tell a name",
      "that is free from one that is merely private, and a publish made with it",
      "fails as a 404 on the PUT rather than as the auth error it is.",
      "",
      "The likeliest cause by a distance is an EXPIRED token. Granular tokens",
      "carry an expiry date and npm does not warn before it passes — check the",
      "dates at https://www.npmjs.com/settings/~/tokens. Issue a replacement",
      "with read+write on the @12-apps scope and update the NPM_TOKEN secret.",
      "",
      "npm said:",
      tail(output),
    ].join("\n"),
  );
}

// A 404 means the name is free. That reading needs the step to run with
// NODE_AUTH_TOKEN set AND that token to be live — whoami() above establishes
// the second half: the seven packages published before this repo went public
// are still RESTRICTED on npm, and an unauthenticated read 404s on those
// exactly as it does on a package that was never published. Anything other than
// a 404 is left to the caller rather than guessed at.
function isOnRegistry(name) {
  const { ok, output } = npm(["view", name, "version", `--registry=${REGISTRY}`]);
  if (ok) return true;
  if (/E404/.test(output)) return false;
  throw new Error(`npm view ${name} failed:\n${tail(output)}`);
}

// Returns the package name when it published, null when it was already there.
function firstPublish(dir) {
  const manifest = join(resolve(dir), "package.json");
  const { name, version } = JSON.parse(readFileSync(manifest, "utf8"));
  if (isOnRegistry(name)) return null;
  console.log(`::group::first publish ${name}@${version}`);
  // `--loglevel verbose` because a failure here arrives as a 404 on a PUT, and
  // a 404 on a PUT is three unrelated faults wearing one status code: no
  // credential, no write on the scope, or a name that is genuinely taken. The
  // quiet output distinguishes none of them; the verbose output names the
  // request npm made and what came back. It sits inside the group, so it costs
  // a collapsed section on the runs that pass. npm redacts the auth header.
  const publishArgs = ["publish", "--access", "public", "--loglevel", "verbose"];
  const { ok, output } = npm(publishArgs, resolve(dir));
  console.log(tail(output, 40));
  console.log("::endgroup::");
  if (!ok) throw new Error(`first publish of ${name} failed:\n${tail(output, 40)}`);
  console.log(`published ${name}@${version} (first publish)`);
  return name;
}

// One package's failure must not strand the ones after it: this is the only
// route onto the registry those packages have, and the job fails at the end.
function attempt(dir, failures) {
  try {
    return firstPublish(dir);
  } catch (error) {
    console.log(`::error::${error.message}`);
    failures.push(dir);
    return null;
  }
}

// The bootstrap is only half the job — each new package still needs a Trusted
// Publisher before its NEXT release can go out tokenlessly, so name them where
// whoever reads the run will see it.
function reportPublished(names) {
  const lines = names.map((name) => `- \`${name}\` — ${accessUrl(name)}`);
  console.log(
    [
      `${names.length} package(s) published for the first time. Add a Trusted`,
      "Publisher to each (GitHub Actions, 12-apps/shared-packages, cd.yml) so the",
      "next release publishes tokenlessly:",
      ...lines,
    ].join("\n"),
  );
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    ["### First publish", "", "Add a Trusted Publisher to each:", "", ...lines, ""].join("\n"),
  );
}

if (!process.env.NODE_AUTH_TOKEN) {
  console.log(
    "No NPM_TOKEN secret set — skipping. Packages already on the registry publish " +
      "as usual; a package that has never been published needs a token once, because " +
      "OIDC cannot create it (https://github.com/npm/cli/issues/8544).",
  );
  process.exit(0);
}

if (DIRS.length === 0) throw new Error("PUBLISH_DIRS is empty — nothing to check");

console.log(`npm authenticated as ${whoami()}`);

const failures = [];
const published = DIRS.map((dir) => attempt(dir, failures)).filter(Boolean);

/**
 * Tell the later steps which names THIS run put on the registry.
 *
 * A package bootstrapped here sits on the registry with no tag for as long as
 * the rest of this job takes, which is the exact shape `verify-released.mjs`
 * fails on. Left unsaid, adding a package turns the run that adds it red — and
 * red for a state nobody can clear from that PR, because a tag only appears
 * once a release cuts one. The recovery on the next push is what fixes it.
 *
 * GITHUB_ENV for the same reason `publish.mjs` uses it: the runner exports it to
 * every later step whether this one passed or failed, which is exactly the
 * lifetime wanted. Outside Actions it is unset and nothing changes.
 */
if (process.env.GITHUB_ENV && published.length > 0) {
  appendFileSync(process.env.GITHUB_ENV, `FIRST_PUBLISHED=${published.join(" ")}\n`);
}

if (published.length > 0) reportPublished(published);
else if (failures.length === 0) {
  console.log("every package is already on the registry — nothing to bootstrap");
}

if (failures.length > 0) {
  console.log(`::error::first publish failed for: ${failures.join(", ")}`);
  process.exitCode = 1;
}
