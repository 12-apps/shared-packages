// Flags a pull request that would cut a MAJOR, while its commit message is
// still editable.
//
// The approval gate in ci.yml is the safety net and this is the feedback. They
// answer the same question at different moments, and the difference matters: by
// the time `detect-majors` runs, the commit is on `main` and the only remaining
// choices are "approve" or "leave the package unreleased". Here the message can
// simply be reworded.
//
// WHAT ACTUALLY CUTS A MAJOR HERE is the `BREAKING CHANGE:` footer, not the `!`
// shorthand. `.releaserc.json` runs the ANGULAR preset, whose headerPattern does
// not accept `!` — so `fix(prisma)!: …` does not parse AT ALL and is worth NO
// release rather than the major its author intended. Both are reported, with
// opposite advice, because both are failures of the same expectation and the
// second one is silent: the commit merges, CI is green, and the package on npm
// simply does not have the change.
//
// A footer is anchored to the start of a line — exactly the test
// conventional-commits-parser applies. A sentence that merely MENTIONS a
// breaking change mid-line is not one, and this guard must not claim otherwise
// or it becomes noise people learn to bypass.
//
// Reads its inputs from the environment so the whole decision is testable
// without a GitHub API call:
//   PR_TITLE       the pull request title
//   PR_LABELS      comma-separated label names
//   COMMIT_FILE    path to a JSON array of the PR's commit messages
//
// The commits arrive through a FILE rather than a variable because a commit
// message is multi-line and an environment variable cannot hold a NUL: execve
// forbids it, and bash's `$(...)` strips it before that. Any single-character
// separator that CAN survive is a character a commit body may legitimately
// contain, so the boundary would be guesswork. JSON has no such ambiguity.
import { readFileSync } from "node:fs";

const ESCAPE_LABEL = "allow-major";

// Anchored to a line start, matching conventional-commits-parser's own test.
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:/m;

// `type(scope)!:` or `type!:` — the shorthand the angular preset cannot read.
const BANG_HEADER = /^[a-z]+(\([^)]*\))?!:/;

/** Every message this PR could land on main: the title, and each commit. */
export function messagesOf(env = process.env) {
  const file = env.COMMIT_FILE;
  const bodies = file
    ? JSON.parse(readFileSync(file, "utf8")).filter((body) => String(body).trim() !== "")
    : [];
  return { title: (env.PR_TITLE ?? "").trim(), bodies };
}

export function labelsOf(env = process.env) {
  return (env.PR_LABELS ?? "")
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
}

/**
 * What this PR would do, as `{ breaking, bang, allowed }`.
 *
 * `breaking` reads the commit BODIES and the title alike. GitHub squashes with
 * COMMIT_OR_PR_TITLE — the single commit's subject when there is one commit and
 * the PR title when there are several — so either can be what lands, and a
 * footer in a body survives the squash into the merge commit's message either
 * way.
 */
export function inspect(env = process.env) {
  const { title, bodies } = messagesOf(env);
  const all = [title, ...bodies];

  return {
    breaking: all.some((message) => BREAKING_FOOTER.test(message)),
    bang: all.some((message) => BANG_HEADER.test(message.split("\n")[0] ?? "")),
    allowed: labelsOf(env).includes(ESCAPE_LABEL),
  };
}

/** The lines to print, and whether to fail. Pure, so the selftest can read it. */
export function report(env = process.env) {
  const { breaking, bang, allowed } = inspect(env);
  const lines = [];
  let failed = false;

  if (bang) {
    lines.push(
      "::error::A `!` breaking-change shorthand will NOT release this package at all. " +
        ".releaserc.json runs the angular preset, whose headerPattern rejects `!`, so the " +
        "header does not parse and the commit is worth no release. Use a `BREAKING CHANGE:` " +
        "footer in the body instead.",
    );
    failed = true;
  }

  if (breaking && !allowed) {
    lines.push(
      `::error::This pull request carries a \`BREAKING CHANGE:\` footer, so merging it cuts a ` +
        `MAJOR. Consumers pin @12-apps/* exactly, so a major is a migration someone has to ` +
        `schedule — not a number. If that is intended, add the \`${ESCAPE_LABEL}\` label and ` +
        `re-run. If it is not, remove the footer (a line that merely MENTIONS a breaking ` +
        `change still counts when it starts the line — the body wrap can put it there).`,
    );
    failed = true;
  }

  if (breaking && allowed) {
    lines.push(
      `::notice::Major release intended — \`${ESCAPE_LABEL}\` is set. It still needs approval ` +
        `in the \`release-major\` environment after merge.`,
    );
  }

  if (!breaking && !bang) lines.push("::notice::No breaking change declared — this PR cuts no major");

  return { lines, failed };
}

// Guarded so the selftest can import report() without the module deciding
// anything on the way in.
if (process.argv[1] && process.argv[1].endsWith("breaking-change-guard.mjs")) {
  const { lines, failed } = report();
  for (const line of lines) console.log(line);
  process.exitCode = failed ? 1 : 0;
}
