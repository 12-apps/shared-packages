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
 *
 * `preferOnline` bypasses npm's local cache, which will otherwise happily serve
 * a packument it fetched minutes ago. It is OFF for the first read of each
 * package — 32 revalidating reads on every run, to catch something rare — and
 * ON for every re-read, where a stale answer is the entire question being
 * asked.
 */
function registryVersions(name, { preferOnline = false } = {}) {
  const args = ["view", name, "versions", "--json"];
  if (preferOnline) args.push("--prefer-online");
  const run = spawnSync("npm", args, { encoding: "utf8" });
  if (run.status !== 0) return null;
  try {
    const parsed = JSON.parse(`${run.stdout}`);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return null;
  }
}

/**
 * How long to keep re-reading the registry before calling a tagged version
 * absent, one wait in milliseconds per attempt.
 *
 * WHY there is a wait at all. `npm publish` answering `ok` does not mean the
 * next `npm view` can see the version — the write is accepted by the registry
 * and the read is served by a CDN that has not caught up yet. Measured here
 * twice in one night: run 32430666577 published `@12-apps/feature-flags@2.0.0`
 * and its verification called the package STUCK at 00:15:58Z, while the
 * registry recorded that version at 00:17:47Z — 109 seconds later. 2.0.1
 * repeated it on the next merge, on a shorter lag.
 *
 * The cost of being impatient is not a slow job, it is the WRONG INSTRUCTION.
 * Every consumer of this module reads an absent version as an orphaned tag,
 * and an orphan's remedy is to DELETE the tag so the version re-cuts —
 * verify-released.mjs prints that at a human and recover-orphans.mjs performs
 * it unattended. Aimed at a package that was merely propagating, it discards a
 * good tag, spends a version number and turns a healthy release into churn.
 * The schedule is therefore longer than the worst lag observed, and it is paid
 * only when something already looks wrong.
 *
 * Comma-separated milliseconds in RELEASE_ABSENCE_RECHECK_MS override it. Empty
 * disables re-reading altogether, which is both the behaviour that shipped this
 * bug and what the self-tests use to stay instant.
 */
const DEFAULT_RECHECK_MS = [10_000, 20_000, 30_000, 60_000, 60_000, 60_000];

export function recheckSchedule(env = process.env) {
  const raw = env.RELEASE_ABSENCE_RECHECK_MS;
  if (raw === undefined) return DEFAULT_RECHECK_MS;
  return raw
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((ms) => Number.isFinite(ms) && ms >= 0);
}

/** Total wall-clock the schedule can spend, in whole seconds — for the messages. */
export function recheckSeconds(schedule = recheckSchedule()) {
  return Math.round(schedule.reduce((total, ms) => total + ms, 0) / 1000);
}

/**
 * Block this thread for `ms`.
 *
 * Synchronous deliberately: every read in this module is `spawnSync` and
 * verify-released.mjs is a straight-line script, so going async would turn
 * three callers inside out to buy nothing. There is no other work for this
 * process to do while the registry catches up.
 */
function sleep(ms) {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Re-read the registry for the packages whose tagged version was missing, and
 * return the ones still missing once the schedule runs out.
 *
 * The rounds are SHARED rather than per package: ten suspects wait the same
 * wall-clock as one. Waiting per package would multiply a rare fault by the
 * size of the monorepo and turn a two-minute lag into a job timeout.
 */
/**
 * One round of re-reads: which suspects are still missing, and which turned up.
 *
 * Extracted from the loop below rather than nested inside it — the complexity
 * gate reads a loop within a loop as a suspected quadratic, and here the two
 * are measuring different things (attempts, and packages) rather than compounding.
 */
function rereadOnce(pending) {
  const missing = [];
  const found = [];
  for (const suspect of pending) {
    const versions = registryVersions(suspect.name, { preferOnline: true });
    if (versions !== null && versions.includes(suspect.version)) found.push(suspect);
    else missing.push(suspect);
  }
  return { missing, found };
}

function confirmAbsent(suspects, schedule) {
  let pending = suspects;
  const appeared = [];
  for (const wait of schedule) {
    if (pending.length === 0) break;
    console.log(
      `::notice::${pending.length} package(s) tagged for a version the registry did not serve ` +
        `(${pending.map(({ tag }) => tag).join(", ")}). Re-reading in ${Math.round(wait / 1000)}s — ` +
        `npm can take minutes to serve a version it has already accepted.`,
    );
    sleep(wait);
    const { missing, found } = rereadOnce(pending);
    appeared.push(...found);
    pending = missing;
  }
  for (const { name, tag } of appeared) {
    console.log(`::notice::${tag} reached the registry on a re-read — ${name} is healthy, not stuck.`);
  }
  return { orphans: pending, appeared };
}

/**
 * Split every package into the four states that matter to a release.
 *
 * `orphans` are tagged for a version npm does not have — the stuck ones.
 * `untagged` are the MIRROR of an orphan: on the registry, with no tag at all.
 * `unpublished` are not on the registry at all — a first publish, not a fault.
 * `healthy` is everything whose newest tag is on the registry.
 *
 * ## Why `untagged` is a state and not just "no tag yet"
 *
 * This function used to `continue` past any package without a tag, which reads
 * as obviously safe — a package nobody has tagged cannot have a stale tag. It
 * is safe only while the registry has never seen the name. Once a version IS
 * published and no tag records it, semantic-release has no floor to count from:
 * it treats the next release as the package's FIRST, re-cuts the version that
 * is already on the registry, and `scripts/publish.mjs` reports the upload as
 * "skipped" because that version exists. Every step succeeds and the release is
 * silently swallowed.
 *
 * That is the same ending as an orphaned tag, reached from the opposite side,
 * with one difference that matters: an orphan turns the run RED, and this did
 * not turn up anywhere at all — the `continue` above meant no caller could see
 * it. `@12-apps/request-scope` sat in exactly this state after its bootstrap
 * run published 1.0.0 with a token and then failed to tag it.
 *
 * The two states need OPPOSITE remedies, which is why they are separate keys
 * rather than one "stuck" list: an orphan is fixed by DELETING its tag so the
 * version re-cuts, and this is fixed by CREATING the missing one.
 */
export function releaseState(dirs = publishDirs(), { schedule = recheckSchedule() } = {}) {
  // Tagged for a version the FIRST read did not find. Not yet an orphan: that
  // verdict is what `confirmAbsent` below is for, and reaching it in one read
  // is how a propagating publish gets its tag deleted.
  const suspects = [];
  const untagged = [];
  const unpublished = [];
  const healthy = [];

  for (const dir of dirs) {
    const { name } = manifest(dir);
    const prefix = basename(dir);
    const tag = newestTag(prefix);
    const versions = registryVersions(name);

    if (!tag) {
      // No tag is the NORMAL state for a name the registry has never seen —
      // every package looks like this before its first release, and flagging
      // those would fail the job on every genuinely new package. It is only a
      // fault once a version exists to be recorded.
      //
      // `length > 0` is not belt-and-braces: a name CAN sit on the registry
      // with no versions left (they were unpublished), and `null` is reserved
      // for "npm has never heard of it", so that case arrives here as `[]`.
      // Admitting it makes every consumer interpolate `newestPublished`'s null
      // into a tag NAME — `verify-released` prints "create <prefix>-vnull" at a
      // human and `release-alert` files it in an issue, which is defect #3's
      // churn loop reached through the reader instead of the automation.
      // Excluding it here fixes all three consumers at once and leaves
      // `recover-orphans`' own null guard as defence in depth.
      if (versions !== null && versions.length > 0) untagged.push({ name, prefix, versions });
      continue;
    }

    if (versions === null) {
      unpublished.push({ name, ...tag });
    } else if (versions.includes(tag.version)) {
      healthy.push({ name, ...tag });
    } else {
      suspects.push({ name, ...tag });
    }
  }

  const { orphans, appeared } = confirmAbsent(suspects, schedule);
  healthy.push(...appeared);

  return { orphans, untagged, unpublished, healthy };
}

/** `1.2.3-beta.4+build` → `{ nums: [1,2,3], pre: "beta.4" }`. Build metadata is ignored, as semver says. */
function parseVersion(version) {
  const withoutBuild = String(version).split("+")[0];
  const dash = withoutBuild.indexOf("-");
  const core = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash);
  const [major, minor, patch] = core.split(".");
  return {
    nums: [major, minor, patch].map((part) => Number.parseInt(part, 10) || 0),
    pre: dash === -1 ? null : withoutBuild.slice(dash + 1),
  };
}

/**
 * Compare two dot-separated prerelease strings by semver's rules: numeric
 * identifiers compare numerically, a numeric identifier is LOWER than an
 * alphanumeric one, and when everything before matches, fewer fields is lower
 * (`1.0.0-rc` < `1.0.0-rc.1`).
 */
function compareIdentifier(x, y) {
  const xIsNum = /^\d+$/.test(x);
  const yIsNum = /^\d+$/.test(y);
  if (xIsNum && yIsNum) return Number(x) - Number(y);
  // A numeric identifier always sorts below an alphanumeric one.
  if (xIsNum !== yIsNum) return xIsNum ? -1 : 1;
  if (x === y) return 0;
  return x < y ? -1 : 1;
}

function comparePrerelease(a, b) {
  const left = a.split(".");
  const right = b.split(".");
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    // Whichever ran out of fields first is the lower one.
    if (left[i] === undefined) return -1;
    if (right[i] === undefined) return 1;
    const order = compareIdentifier(left[i], right[i]);
    if (order !== 0) return order;
  }
  return 0;
}

/** Semver ordering. Negative when `a` precedes `b`. */
function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < 3; i += 1) {
    if (left.nums[i] !== right.nums[i]) return left.nums[i] - right.nums[i];
  }
  // A version WITH a prerelease precedes the same version without one. This is
  // the clause a lexical or numeric-collation sort gets backwards, and getting
  // it backwards here is not cosmetic: the caller tags whatever this returns,
  // so picking `1.0.0-beta.1` over `1.0.0` writes a floor BELOW a release
  // already out — and the package then reads as healthy for ever while
  // semantic-release re-cuts a published version. That is precisely the silent
  // failure this whole module exists to detect.
  if (left.pre === null && right.pre === null) return 0;
  if (left.pre === null) return 1;
  if (right.pre === null) return -1;
  return comparePrerelease(left.pre, right.pre);
}

/**
 * The newest version in a list, or `null` for an empty one.
 *
 * `npm view … versions` returns PUBLICATION order, which stops being version
 * order the moment a patch lands on an older line after a newer minor — and it
 * is not semver order at all where prereleases are involved.
 *
 * The `null` matters as much as the sort. A caller that tags this value builds
 * a tag name by interpolation, so `undefined` from an empty list becomes a
 * literal `<pkg>-vundefined` pushed to the remote — which the next run reads
 * back as an orphan, deletes, and recreates, for ever. Returning `null` makes
 * the empty case a decision the caller has to make rather than a string.
 */
export function newestPublished(versions) {
  if (!Array.isArray(versions) || versions.length === 0) return null;
  return [...versions].sort(compareVersions).at(-1);
}

/** The names a workflow step handed over through GITHUB_ENV, as a Set. */
export function handedOver(variable, env = process.env) {
  return new Set((env[variable] ?? "").split(/\s+/).filter(Boolean));
}
