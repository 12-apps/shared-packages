// What semantic-release's output says a package's next version is, and whether
// that is a MAJOR.
//
// One definition, read twice: scripts/next-versions.mjs asks BEFORE the release
// to decide whether a human has to approve it, and scripts/release-tags.mjs asks
// AFTER to name what was just cut. Two copies would eventually disagree, and the
// disagreement is silent in the worst direction — the gate would wave through
// exactly the bump the warning still reports.
//
// Both readings come from the log rather than from git, deliberately: the
// version floor semantic-release used is the one it PRINTS, so a comparison
// against it cannot drift from the decision it describes the way a separate
// `git tag --list` could.

const NEXT_VERSION = /The next release version is ((\d+)\.\d+\.\d+)/;
const LAST_VERSION = /associated with version ((\d+)\.\d+\.\d+)/;

// A footer, not a mention: anchored to the start of a line, which is exactly
// the test conventional-commits-parser applies when deciding a commit breaks.
//
// It no longer DECIDES the major — every `.releaserc.json` maps `breaking` to
// `minor` — so reaching a major with only this present means the config and this
// module have drifted apart, and `whyMajor` says so rather than inventing a
// cause.
const BREAKING_FOOTER = /^BREAKING CHANGE/m;

// What actually spends a major, kept in step with the `releaseRules` entry in
// every `.releaserc.json`.
const MAJOR_MARKER = /^RELEASE-MAJOR/m;

/**
 * The bump one package's run reports, or null when it releases nothing.
 *
 * `major` needs a LAST version to compare against, so a package with no prior
 * release is never one: semantic-release cuts 1.0.0 for it, and calling a
 * package's own arrival a breaking change would put an approval in front of
 * every genuinely new package.
 *
 * `why` exists because a major here is decided by PROSE, and the reviewer
 * approving it needs to know which prose. `BREAKING CHANGE` at the start of any
 * line in the body IS the footer — the parser does not care whether the
 * sentence around it was describing one or merely mentioning it.
 *
 * That is not hypothetical. The commit that fixed 12-53 explained the bug it
 * was fixing, and its body said "The major came from the BREAKING CHANGE footer
 * on a fix(app-shell) commit …". The commit guard wraps bodies at 100
 * characters, the wrap landed on that phrase, and a sentence ABOUT a breaking
 * change became one — `@12-apps/request-scope` went out as 2.0.0 for a change
 * that adds a `.releaserc.json` the tarball does not even ship.
 */
function whyMajor(output) {
  if (MAJOR_MARKER.test(output)) return "a RELEASE-MAJOR marker";
  // A major with no marker should not be reachable under the current
  // releaseRules. Name that rather than guess: an unexplained major is config
  // drift worth chasing, and a confident wrong answer would bury it.
  if (BREAKING_FOOTER.test(output)) {
    return "a BREAKING CHANGE footer, which should cut a MINOR — check .releaserc.json";
  }
  return "the commit analysis";
}

export function bumpFor(output) {
  const next = output.match(NEXT_VERSION);
  if (!next) return null;

  const last = output.match(LAST_VERSION);
  const major = Boolean(last) && Number(next[2]) > Number(last[2]);

  return {
    next: next[1],
    last: last ? last[1] : null,
    major,
    why: major ? whyMajor(output) : null,
  };
}
