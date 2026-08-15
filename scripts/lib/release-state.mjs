// One reading of "which packages are tagged for a version the registry never
// received", for the three steps that all need to ask.
//
// `scripts/recover-orphans.mjs` asks it BEFORE the release, to delete the tag
// and let semantic-release re-cut the version. `scripts/verify-released.mjs`
// asks it AFTER, to fail the run when one is left behind. `scripts/release-alert.mjs`
// asks it last of all, to decide whether a human has to be told. Three readings
// of the same question would eventually disagree, and the disagreement is silent
// in the worst direction: the step that finds fewer orphans simply heals less
// and reports nothing.
//
// The subtlety worth keeping in one place is the tag SORT. `--sort=-v:refname`
// is version-aware; the default is lexical, and lexically `v1.9.0` sorts after
// `v1.22.0`. A lexical read compares the registry against the wrong tag and
// calls a healthy package stuck — or, worse, a stuck one healthy.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

/** The repo-root file that IS the list, for anything running without the workflow's env. */
const PACKAGE_LIST = new URL("../../release-packages.txt", import.meta.url);

/** The package list as written in release-packages.txt, comments and blanks stripped. */
export function declaredDirs(file = PACKAGE_LIST) {
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

/**
 * The publishable package directories.
 *
 * PUBLISH_DIRS when the workflow set it, and release-packages.txt otherwise —
 * which is what lets the scheduled watchdog run these same checks without
 * restating the list. ci.yml's copy and the file are held identical by
 * scripts/release-tags-selftest.mjs, so the fallback can never be a second,
 * quietly diverging answer: a package present in one and missing from the other
 * would be released but never verified, or verified but never released.
 */
export function publishDirs(env = process.env) {
  const fromEnv = (env.PUBLISH_DIRS ?? "").split(/\s+/).filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : declaredDirs();
}

function manifest(dir) {
  return JSON.parse(readFileSync(join(resolve(dir), "package.json"), "utf8"));
}

/**
 * The newest `<prefix>-v*` tag, as `{ tag, version }`, or null when untagged.
 *
 * The prefix is the DIRECTORY name rather than the package name, matching
 * `--tag-format "<pkg>-v${version}"` in the release job — payments ships as a
 * nested workspace, so `packages/payments/backend` tags as `backend-v*`.
 */
function newestTag(prefix) {
  const run = spawnSync("git", ["tag", "--list", `${prefix}-v*`, "--sort=-v:refname"], {
    encoding: "utf8",
  });
  const out = `${run.stdout ?? ""}`.trim();
  if (run.status !== 0 || out === "") return null;
  const tag = out.split("\n")[0];
  return { tag, version: tag.slice(`${prefix}-v`.length) };
}

/**
 * Every version of a package on the registry, or null when the name is not
 * there at all.
 *
 * `null` is NOT "no versions": a name the registry has never seen is a first
 * publish, which scripts/first-publish.mjs owns. Callers must keep the two
 * apart — treating an unpublished name as an orphan would have this delete the
 * tag of a package that is merely new.
 */
function registryVersions(name) {
  const run = spawnSync("npm", ["view", name, "versions", "--json"], { encoding: "utf8" });
  if (run.status !== 0) return null;
  try {
    const parsed = JSON.parse(`${run.stdout}`);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return null;
  }
}

/**
 * Split every package into the three states that matter to a release.
 *
 * `orphans` are tagged for a version npm does not have — the stuck ones.
 * `unpublished` are not on the registry at all — a first publish, not a fault.
 * `healthy` is everything whose newest tag is on the registry.
 */
export function releaseState(dirs = publishDirs()) {
  const orphans = [];
  const unpublished = [];
  const healthy = [];

  for (const dir of dirs) {
    const { name } = manifest(dir);
    const tag = newestTag(basename(dir));
    if (!tag) continue;

    const versions = registryVersions(name);
    if (versions === null) {
      unpublished.push({ name, ...tag });
    } else if (versions.includes(tag.version)) {
      healthy.push({ name, ...tag });
    } else {
      orphans.push({ name, ...tag });
    }
  }

  return { orphans, unpublished, healthy };
}

/** The names a workflow step handed over through GITHUB_ENV, as a Set. */
export function handedOver(variable, env = process.env) {
  return new Set((env[variable] ?? "").split(/\s+/).filter(Boolean));
}
