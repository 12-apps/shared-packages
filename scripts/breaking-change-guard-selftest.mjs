#!/usr/bin/env node
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { report } from "./breaking-change-guard.mjs";

/**
 * Proves scripts/breaking-change-guard.mjs fails a PR for the reason it claims.
 *
 * The two cases that must stay QUIET carry as much weight as the ones that must
 * fail. This check runs on every pull request in the repo, so a guard that
 * fired on an ordinary `feat` — or on a sentence that merely mentions a breaking
 * change mid-line — would be bypassed by habit within a week, and the real one
 * would go with it.
 */

let failures = 0;
function check(what, ok, detail) {
  console.log(`${ok ? "ok" : "FAIL"} — ${what}`);
  if (!ok) {
    failures += 1;
    console.log(`    ${detail}`);
  }
}

/** Write the PR's commit messages where the guard reads them from. */
function commitFile(messages) {
  const file = join(mkdtempSync(join(tmpdir(), "major-guard-")), "commits.json");
  writeFileSync(file, JSON.stringify(messages));
  return file;
}

const run = ({ commits = [], ...env }) =>
  report({ PR_TITLE: "", PR_LABELS: "", COMMIT_FILE: commitFile(commits), ...env });

// ── The ordinary case has to stay silent ────────────────────────────────────
const ordinary = run({ PR_TITLE: "feat(ui): add a compact variant" });
check(
  "an ordinary feat does not fail",
  !ordinary.failed,
  `a guard that fires on every PR is a guard people route around. Lines:\n    ${ordinary.lines}`,
);

const mention = run({
  PR_TITLE: "docs(ui): explain the release rules",
  commits: ["docs(ui): explain the release rules\n\nA commit whose body BREAKING CHANGE: is quoted mid-sentence is not a footer."],
});
check(
  "a mid-line mention of a breaking change is not a footer",
  !mention.failed,
  `conventional-commits-parser anchors the footer to a line start, and so must\n    ` +
    `this. Lines:\n    ${mention.lines}`,
);

// ── An ordinary breaking change: a MINOR, and not a failure ─────────────────
//
// These assertions are INVERTED from what they said before, deliberately. Every
// `.releaserc.json` now maps `breaking` to `minor`, so a footer no longer spends
// a major and must no longer block the PR. A test still demanding a failure here
// would be pinning in place the version inflation this replaces — five majors
// were pending at once, all of them from routine "this config is required now"
// tightenings.
const breaking = run({
  PR_TITLE: "feat(ui): replace the Button API",
  commits: ["feat(ui): replace the Button API\n\nBREAKING CHANGE: `kind` is replaced by `variant`."],
});
check(
  "a BREAKING CHANGE footer does NOT fail the PR — it cuts a minor",
  !breaking.failed,
  `a required-config tightening is not a migration anyone schedules.\n    Lines:\n    ${breaking.lines}`,
);

check(
  "and it says so, because that is the opposite of the angular default",
  breaking.lines.join(" ").includes("MINOR"),
  `silence would let someone who wrote the footer expecting a major discover it\n    ` +
    `on npm instead. Lines:\n    ${breaking.lines}`,
);

// ── The real major: an explicit marker nobody types by accident ─────────────
const major = run({
  PR_TITLE: "feat(ui): rebuild the component API",
  commits: ["feat(ui): rebuild the component API\n\nRELEASE-MAJOR: every component takes copy."],
});
check(
  "a RELEASE-MAJOR marker fails the PR without the label",
  major.failed && major.lines.join(" ").includes("MAJOR"),
  `Lines:\n    ${major.lines}`,
);

check(
  "and the message says how to proceed deliberately",
  major.lines.join(" ").includes("allow-major"),
  `an error that does not name its escape hatch just blocks people. Lines:\n    ${major.lines}`,
);

const labelled = run({
  PR_TITLE: "feat(ui): rebuild the component API",
  commits: ["feat(ui): rebuild the component API\n\nRELEASE-MAJOR: every component takes copy."],
  PR_LABELS: "needs-review, allow-major",
});
check(
  "the allow-major label lets a deliberate major through",
  !labelled.failed,
  `Lines:\n    ${labelled.lines}`,
);

check(
  "and it still says the release itself needs approving after merge",
  labelled.lines.join(" ").includes("release-major"),
  `the label is consent to CUT the major, not to publish it unreviewed.\n    Lines:\n    ${labelled.lines}`,
);

// ── The `!` shorthand, which is a MINOR like any other breaking change ──────
//
// It used to be the SILENT one: the angular headerPattern rejects `!`, so
// `fix(prisma)!:` parsed to no type and released nothing at all — it was once
// the only commit in range for five packages and released none of them. Every
// `.releaserc.json` overrides the parser so the shorthand is legible, and then
// maps `breaking` to `minor` like the footer. So `!` now means what its author
// meant — this breaks — and spends a minor saying it.
// `scripts/release-bump-selftest.mjs` holds the parser end.
const bang = run({ PR_TITLE: "fix(prisma)!: correct the migration order" });
check(
  "the `!` shorthand does not fail the PR — it cuts a MINOR",
  !bang.failed && bang.lines.join(" ").includes("MINOR"),
  `\`!\` and a footer say the same thing, so they are treated the same way.\n    ` +
    `Lines:\n    ${bang.lines}`,
);

check(
  "and it never repeats the old advice that `!` releases nothing",
  !/NOT release|no release at all|worth no release/i.test(bang.lines.join(" ")),
  `that advice was true against the angular preset and is now exactly backwards:\n    ` +
    `following it would have someone strip the \`!\` from a real major.\n    Lines:\n    ${bang.lines}`,
);

check(
  "it names the `!`, not a footer the author never wrote",
  /`!`/.test(bang.lines.join(" ")) && !/remove the footer/.test(bang.lines.join(" ")),
  `"remove the footer" is unfollowable for someone who wrote \`feat(x)!:\` — the\n    ` +
    `message has to name the syntax actually used. Lines:\n    ${bang.lines}`,
);

// The marker is what the label and the environment are for now, so a `!` needs
// neither — and must not silently acquire a major by carrying the label for some
// other reason.
const bangAllowed = run({
  PR_TITLE: "fix(prisma)!: correct the migration order",
  PR_LABELS: "allow-major",
});
check(
  "allow-major does not turn a `!` into a major on its own",
  !bangAllowed.failed && bangAllowed.lines.join(" ").includes("MINOR"),
  `the label is consent to spend a major, not a declaration of one. Only the\n    ` +
    `RELEASE-MAJOR marker declares it. Lines:\n    ${bangAllowed.lines}`,
);

// ── Multi-commit PRs ────────────────────────────────────────────────────────
const buried = run({
  PR_TITLE: "feat(ui): several changes",
  commits: ["feat(ui): one", "feat(ui): two\n\nRELEASE-MAJOR: gone"],
});
check(
  "a marker in any commit of a multi-commit PR is found",
  buried.failed,
  `the squash keeps every commit's body, so a marker anywhere in the PR lands\n    ` +
    `on main. Lines:\n    ${buried.lines}`,
);

console.log(
  failures === 0
    ? "\nbreaking-change-guard.mjs fails on real majors and stays quiet otherwise"
    : `\n${failures} case(s) failed`,
);
process.exitCode = failures === 0 ? 0 : 1;
