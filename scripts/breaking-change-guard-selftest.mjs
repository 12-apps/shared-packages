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

// ── The real major ──────────────────────────────────────────────────────────
const breaking = run({
  PR_TITLE: "feat(ui): replace the Button API",
  commits: ["feat(ui): replace the Button API\n\nBREAKING CHANGE: `kind` is replaced by `variant`."],
});
check(
  "a BREAKING CHANGE footer fails the PR",
  breaking.failed && breaking.lines.join(" ").includes("cuts a"),
  `Lines:\n    ${breaking.lines}`,
);

check(
  "and the message says how to proceed deliberately",
  breaking.lines.join(" ").includes("allow-major"),
  `an error that does not name its escape hatch just blocks people. Lines:\n    ${breaking.lines}`,
);

const labelled = run({
  PR_TITLE: "feat(ui): replace the Button API",
  commits: ["feat(ui): replace the Button API\n\nBREAKING CHANGE: `kind` is replaced by `variant`."],
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

// ── The silent one: `!`, which this preset cannot read ──────────────────────
const bang = run({ PR_TITLE: "fix(prisma)!: correct the migration order" });
check(
  "the `!` shorthand fails, because it releases NOTHING under the angular preset",
  bang.failed && bang.lines.join(" ").includes("NOT release"),
  `\`fix(prisma)!:\` on main was the only commit in range for five packages and\n    ` +
    `released none of them, silently. Lines:\n    ${bang.lines}`,
);

check(
  "and allow-major does not excuse it, because it is not a major — it is nothing",
  run({ PR_TITLE: "fix(prisma)!: correct the migration order", PR_LABELS: "allow-major" }).failed,
  `the label says "yes, cut the major"; this header cuts no release at all, so\n    ` +
    `the label cannot be consent to it`,
);

// ── Multi-commit PRs ────────────────────────────────────────────────────────
const buried = run({
  PR_TITLE: "feat(ui): several changes",
  commits: ["feat(ui): one", "feat(ui): two\n\nBREAKING CHANGE: gone"],
});
check(
  "a footer in any commit of a multi-commit PR is found",
  buried.failed,
  `the squash keeps every commit's body, so a footer anywhere in the PR lands\n    ` +
    `on main. Lines:\n    ${buried.lines}`,
);

console.log(
  failures === 0
    ? "\nbreaking-change-guard.mjs fails on real majors and stays quiet otherwise"
    : `\n${failures} case(s) failed`,
);
process.exitCode = failures === 0 ? 0 : 1;
