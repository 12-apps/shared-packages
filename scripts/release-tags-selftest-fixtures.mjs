// The semantic-release outputs scripts/release-tags-selftest.mjs plays back.
//
// A sibling module for the same reason scripts/publish-selftest-fixtures.mjs is
// one: these are LONG, several are transcribed from real job logs and must stay
// byte-faithful to them, and the cases that read them are the part worth having
// on one screen. Keeping both in one file also pushed the selftest past the
// size gate, which is the gate noticing the same thing.

/**
 * Run 31427350698, copied from the job log.
 *
 * Both lines matter and they disagree: the CODE says permissions, the line
 * above it says TLS. A reader — or a classifier — that stops at the code gets
 * the wrong answer, which is the entire point of the first case that reads it.
 */
export const TLS_BLIP = [
  '[semantic-release] › ✘  The command "git push --dry-run --no-verify -- ' +
    'https://github.com/12-apps/shared-packages.git HEAD:main" failed with the error ' +
    "message fatal: unable to access 'https://github.com/12-apps/shared-packages.git/': " +
    "server certificate verification failed. CAfile: none CRLfile: none.",
  "[semantic-release] › ✘  EGITNOPERMISSION Cannot push to the Git repository.",
].join("\n");

/**
 * Constructed, not copied: the stale-ref race this repo's concurrency block
 * describes. Push runs are keyed by SHA so two merges release CONCURRENTLY, and
 * the older run's HEAD:main is then behind the ref it pushes to.
 */
export const STALE_REF = [
  " ! [rejected]        HEAD -> main (non-fast-forward)",
  "error: failed to push some refs to 'https://github.com/12-apps/shared-packages.git'",
  "hint: Updates were rejected because a pushed branch tip is behind its remote counterpart.",
  "[semantic-release] › ✘  EGITNOPERMISSION Cannot push to the Git repository.",
].join("\n");

/** Constructed: a genuine, non-retryable fault in the package's own config. */
export const BROKEN_CONFIG = [
  "[semantic-release] › ✘  An error occurred while running semantic-release: Error: " +
    "Cannot find module 'semantic-release-monorepo'",
  "[semantic-release] › ✘  EINVALIDCONFIG",
].join("\n");

export const RELEASED = "[semantic-release] › ℹ  Published release 1.22.0 on default channel";

/**
 * A package with NOTHING in its own range — captured from a real dry run of
 * `@12-apps/auth` on `main`, and captured rather than written for a reason.
 *
 * The `Found 43 commits` line is the CORE's, printed before
 * semantic-release-monorepo narrows the range to this package's directory, so
 * it counts the whole repository and is large and non-zero here even though
 * nothing touched `packages/auth`. The plugin's `Analysis of 0 commits` is the
 * count that means anything.
 *
 * An earlier version of this fixture was inferred and left the core's line out.
 * That made "no commits in range" look distinguishable by a line's absence when
 * it is not, and the detector written against it fired on every package of
 * every release. Both lines belong here so that can never read as clean again.
 */
export const NOTHING = [
  "[semantic-release] › ℹ  Found git tag auth-v1.22.0 associated with version 1.22.0 on branch main",
  "[semantic-release] › ℹ  Found 43 commits since last release",
  "[semantic-release] [[Function: semantic-release-monorepo]] › ℹ  Analysis of 0 commits complete: no release",
  "[semantic-release] › ℹ  There are no relevant changes, so no new version is released.",
].join("\n");

/**
 * The OTHER exit-0-and-shipped-nothing, captured from a real dry run of
 * `@12-apps/prisma` on `main`: one commit DID touch the package and produced no
 * version. semantic-release prints the same closing line as NOTHING and exits 0
 * either way, which is how `fix(prisma)!: …` released nothing for five packages
 * while the job stayed green.
 *
 * Only `Analysis of N commits` separates this from NOTHING above — 1 against 0.
 * The core's `Found N` line is 15 here and 43 there, and says nothing about
 * either package.
 */
export const CHANGED_BUT_SILENT = [
  "[semantic-release] › ℹ  Found git tag prisma-v5.1.0 associated with version 5.1.0 on branch main",
  "[semantic-release] › ℹ  Found 15 commits since last release",
  "[semantic-release] [[Function: semantic-release-monorepo]] › ℹ  Analysis of 1 commits complete: no release",
  "[semantic-release] › ℹ  There are no relevant changes, so no new version is released.",
].join("\n");

/**
 * The mirror: a MAJOR from prose. Taken from the run that shipped
 * `@12-apps/request-scope` 2.0.0 — the commit only ADDED a `.releaserc.json`,
 * and its body explained a breaking change that had happened elsewhere. The
 * commit guard wraps bodies at 100 characters, the wrap landed on the phrase,
 * and `BREAKING CHANGE` at column 0 is the footer whatever the sentence meant.
 */
export const ACCIDENTAL_MAJOR = [
  "[semantic-release] › ℹ  Found git tag request-scope-v1.0.0 associated with version 1.0.0 on branch main",
  "BREAKING CHANGE footer on a fix(app-shell) commit belonging to another package. The release job has",
  "[semantic-release] › ℹ  The next release version is 2.0.0",
].join("\n");

/** A bump that is not a major: the warning must stay off. */
export const DELIBERATE_MINOR = [
  "[semantic-release] › ℹ  Found git tag ui-v1.4.0 associated with version 1.4.0 on branch main",
  "[semantic-release] › ℹ  The next release version is 1.5.0",
].join("\n");
