#!/usr/bin/env node
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { report } from "./breaking-change-guard.mjs";

/**
 * Proves scripts/breaking-change-guard.mjs arms the human gate for the reason
 * it claims, and leaves it alone otherwise.
 *
 * `report().major` is not a log line: `major-guard.yml` reads it as the job
 * output that starts `Major approval`, the environment-bound job that holds the
 * pull request. So the cases that must return `major: false` carry as much
 * weight as the one that must return true. This check runs on every pull
 * request in the repo, and a gate that fired on an ordinary `feat` — or on a
 * routine "this config is required now" tightening — would be clicked through
 * by habit within a week, and the real one would go with it.
 *
 * Nothing here fails the CHECK any more. The guard prints and hands over a
 * verdict; the block lives in the environment, which is the one thing this
 * repo's token cannot reach. There is no escape label to test, deliberately —
 * `allow-major` was applied through the API by an agent holding that token.
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
  report({ PR_TITLE: "", COMMIT_FILE: commitFile(commits), ...env });

// ── The ordinary case has to stay silent ────────────────────────────────────
const ordinary = run({ PR_TITLE: "feat(ui): add a compact variant" });
check(
  "an ordinary feat does not arm the gate",
  ordinary.major === false,
  `a gate that waits on every PR is a gate people click through. Lines:\n    ${ordinary.lines}`,
);

const mention = run({
  PR_TITLE: "docs(ui): explain the release rules",
  commits: ["docs(ui): explain the release rules\n\nA commit whose body BREAKING CHANGE: is quoted mid-sentence is not a footer."],
});
check(
  "a mid-line mention of a breaking change is not a footer",
  mention.major === false,
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
  "a BREAKING CHANGE footer does NOT arm the gate — it cuts a minor",
  breaking.major === false,
  `a required-config tightening is not a migration anyone schedules, so it must\n    ` +
    `not sit waiting for a click. The verdict handed to major-guard.yml used to be\n    ` +
    `\`breaking\` rather than the marker, which held every one of them.\n    Lines:\n    ${breaking.lines}`,
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
  "a RELEASE-MAJOR marker arms the gate",
  major.major === true && major.lines.join(" ").includes("MAJOR"),
  `this verdict IS the block — major-guard.yml starts \`Major approval\` on it.\n    ` +
    `Lines:\n    ${major.lines}`,
);

check(
  "and the message names both ways out, neither of which is a label",
  /Review deployments/.test(major.lines.join(" ")) &&
    /drop the marker/.test(major.lines.join(" ")) &&
    !/allow-major/.test(major.lines.join(" ")),
  `a block that does not say how to clear it just stops people — and the two\n    ` +
    `exits are a person's: approve the deployment, or reword the message. The\n    ` +
    `label was neither: an agent holding this repo's token added it on #319.\n    ` +
    `Lines:\n    ${major.lines}`,
);

check(
  "and it never sends anyone to a post-merge gate that no longer exists",
  !/release-major|after merge/.test(major.lines.join(" ")),
  `the \`release-major\` environment went with ci.yml's release job (#351). Advice\n    ` +
    `pointing at it would have someone merge and then wait for a click nothing\n    ` +
    `is going to ask for. Lines:\n    ${major.lines}`,
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
  "the `!` shorthand does not arm the gate — it cuts a MINOR",
  bang.major === false && bang.lines.join(" ").includes("MINOR"),
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

// Both syntaxes at once is still one minor, and still no gate. Worth its own
// case because `breaking` is a union and a marker check written against it
// would look identical here and differ nowhere else.
const both = run({
  PR_TITLE: "fix(prisma)!: correct the migration order",
  commits: ["fix(prisma)!: correct the migration order\n\nBREAKING CHANGE: the order changed."],
});
check(
  "a `!` and a footer together are still a MINOR and still no gate",
  both.major === false && both.lines.join(" ").includes("MINOR"),
  `only the RELEASE-MAJOR marker declares a major; saying "this breaks" twice\n    ` +
    `does not add up to one. Lines:\n    ${both.lines}`,
);

check(
  "and it names both syntaxes, so the advice is followable either way",
  /`!`/.test(both.lines.join(" ")) && /footer/.test(both.lines.join(" ")),
  `Lines:\n    ${both.lines}`,
);

// ── Multi-commit PRs ────────────────────────────────────────────────────────
const buried = run({
  PR_TITLE: "feat(ui): several changes",
  commits: ["feat(ui): one", "feat(ui): two\n\nRELEASE-MAJOR: gone"],
});
check(
  "a marker in any commit of a multi-commit PR is found",
  buried.major === true,
  `the squash keeps every commit's body, so a marker anywhere in the PR lands\n    ` +
    `on main. Lines:\n    ${buried.lines}`,
);

console.log(
  failures === 0
    ? "\nbreaking-change-guard.mjs arms the gate on real majors and stays quiet otherwise"
    : `\n${failures} case(s) failed`,
);
process.exitCode = failures === 0 ? 0 : 1;
