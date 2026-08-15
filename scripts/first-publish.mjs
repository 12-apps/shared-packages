// Publish the packages that are not on the registry yet — and nothing else.
//
// WHY: OIDC Trusted Publishing cannot make a package's FIRST publish. A Trusted
// Publisher is configured from a package's settings page on npmjs.com, and that
// page exists only once the package does, so a name nobody has published has
// nowhere to point the trust at and the tokenless publish 404s (npm/cli#8544).
// Exactly one token-authenticated publish per package is the way in; from the
// next release onward the tokenless loop in ci.yml handles it as usual.
//
// This runs before that loop and leaves it alone. Packages already on the
// registry are never touched here, and with no NPM_TOKEN secret set the whole
// step is a no-op — publishing then behaves exactly as it did before.
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REGISTRY = "https://registry.npmjs.org";
const DIRS = (process.env.PUBLISH_DIRS ?? "").split(/\s+/).filter(Boolean);

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

// A 404 means the name is free. That reading needs the step to run with
// NODE_AUTH_TOKEN set: the seven packages published before this repo went
// public are still RESTRICTED on npm, and an unauthenticated read 404s on those
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
  const { ok, output } = npm(["publish", "--access", "public"], resolve(dir));
  console.log(tail(output, 40));
  console.log("::endgroup::");
  if (!ok) throw new Error(`first publish of ${name} failed:\n${tail(output)}`);
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
      "Publisher to each (GitHub Actions, 12-apps/shared-packages, ci.yml) so the",
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
