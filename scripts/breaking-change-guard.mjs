// Says what a pull request would release, and arms the gate when that is a
// MAJOR — while the commit message is still editable.
//
// This script DECIDES NOTHING about whether the PR can merge. It prints, and it
// writes one output. The block lives in `major-guard.yml`'s `Major approval`
// job, which binds to the `major-approval` environment and simply waits; a
// pending required check is a pull request nobody can merge, and an App
// installation token cannot grant a deployment. So the only ways past a
// declared major are the two a human has: approve it, or reword the message so
// it is no longer one.
//
// THERE IS NO ESCAPE LABEL. `allow-major` used to silence the red, and that was
// the hole: a label is applied through the API exactly as easily as through the
// UI, and an agent holding this repo's token did precisely that on #319. Any
// consent expressed as repository CONTENT — a label, a tag, a magic line — is
// consent the automation can give itself. Repository settings are the one thing
// the token cannot reach (the branch-protection API answers `Resource not
// accessible by integration`), which is why the environment is the whole gate
// and this file is only the explanation.
//
// TWO SYNTAXES DECLARE A BREAKING CHANGE, and they are equals: a
// `BREAKING CHANGE:` footer, and the `!` shorthand in the header. Neither cuts
// a major here — every `.releaserc.json` maps a breaking note to `minor` — so
// neither arms the gate. They are read only so the log can name which one an
// author wrote and say what it actually bought.
//
// `!` did not always work. The angular preset's headerPattern is
// `^(\w*)(?:\((.*)\))?: (.*)$` — a `!` before the colon makes the whole header
// fail to parse, so `fix(prisma)!: …` came out with no type at all and
// @semantic-release/commit-analyzer returned NO RELEASE: not the major its
// author intended, not even a patch. It merged, CI was green, and the package
// on npm simply did not have the change. Every `.releaserc.json` now overrides
// `parserOpts.headerPattern` and `parserOpts.breakingHeaderPattern` so the
// shorthand parses and raises a breaking note, which is what makes the two
// syntaxes interchangeable. `scripts/release-bump-selftest.mjs` asserts that
// against the real analyzer and the committed config, so this comment cannot
// quietly stop being true.
//
// A footer is anchored to the start of a line — exactly the test
// conventional-commits-parser applies. A sentence that merely MENTIONS a
// breaking change mid-line is not one, and this guard must not claim otherwise
// or it becomes noise people learn to bypass.
//
// Reads its inputs from the environment so the whole decision is testable
// without a GitHub API call:
//   PR_TITLE       the pull request title
//   COMMIT_FILE    path to a JSON array of the PR's commit messages
//
// The commits arrive through a FILE rather than a variable because a commit
// message is multi-line and an environment variable cannot hold a NUL: execve
// forbids it, and bash's `$(...)` strips it before that. Any single-character
// separator that CAN survive is a character a commit body may legitimately
// contain, so the boundary would be guesswork. JSON has no such ambiguity.
import { appendFileSync, readFileSync } from "node:fs";

// Anchored to a line start, matching conventional-commits-parser's own test.
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:/m;

// `type(scope)!:` or `type!:` — the shorthand the angular preset cannot read.
const BANG_HEADER = /^[a-z]+(\([^)]*\))?!:/;

// The DELIBERATE major, and the only thing that spends one. Every
// `.releaserc.json` maps this marker to `major` and maps `breaking` to `minor`.
//
// A body marker rather than the footer or the `!`, because both of those are one
// keystroke or one line-wrap from being written by accident — `@12-apps/request-
// scope` shipped 2.0.0 because a wrapped sentence DESCRIBING a breaking change
// put the phrase at column 0 (12-53). Nobody types RELEASE-MAJOR by mistake.
const MAJOR_MARKER = /^RELEASE-MAJOR\b/m;

/** Every message this PR could land on main: the title, and each commit. */
export function messagesOf(env = process.env) {
  const file = env.COMMIT_FILE;
  const bodies = file
    ? JSON.parse(readFileSync(file, "utf8")).filter((body) => String(body).trim() !== "")
    : [];
  return { title: (env.PR_TITLE ?? "").trim(), bodies };
}

/**
 * What this PR would do, as `{ breaking, bang, footer, major }`.
 *
 * `breaking` is the union: either syntax says "this breaks", and here both buy
 * a minor. `bang` and `footer` are kept apart only so the message can name
 * which one the author wrote. `major` is separate and is the ONLY thing the
 * gate reads.
 *
 * All of it reads the commit BODIES and the title alike. GitHub squashes with
 * COMMIT_OR_PR_TITLE — the single commit's subject when there is one commit and
 * the PR title when there are several — so either can be what lands, and a
 * marker in a body survives the squash into the merge commit's message either
 * way.
 */
export function inspect(env = process.env) {
  const { title, bodies } = messagesOf(env);
  const all = [title, ...bodies];

  const footer = all.some((message) => BREAKING_FOOTER.test(message));
  const bang = all.some((message) => BANG_HEADER.test(message.split("\n")[0] ?? ""));
  const major = all.some((message) => MAJOR_MARKER.test(message));

  return { breaking: footer || bang, bang, footer, major };
}

/**
 * How to NAME the declaration, and how to undo it.
 *
 * Split out so the advice can be specific: "remove the footer" is unfollowable
 * for someone who wrote `feat(x)!:` and never typed a footer, and the reverse
 * sends a footer author hunting for a `!` that is not there.
 */
function phrasing(bang, footer) {
  if (bang && footer) {
    return {
      declaration: "a `!` in the header and a `BREAKING CHANGE:` footer",
      undo: "drop the `!` and remove the footer — either one alone still says it breaks",
    };
  }
  if (bang) return { declaration: "a `!` in the header", undo: "drop the `!`" };
  return {
    declaration: "a `BREAKING CHANGE:` footer",
    undo:
      "remove the footer (a line that merely MENTIONS a breaking change still " +
      "counts when it starts the line — the body wrap can put it there)",
  };
}

/**
 * The lines to print, and the verdict. Pure, so the selftest can read it.
 *
 * Nothing here fails. A `::warning::` on a declared major is FEEDBACK — the
 * author sees what the PR would spend, next to the `Major approval` check that
 * is holding it. Failing here as well would be a second red with no human way
 * to clear it, now that the label is gone, and "red until you edit the message"
 * is not the choice a deliberate major deserves.
 */
export function report(env = process.env) {
  const { breaking, bang, footer, major } = inspect(env);
  const lines = [];

  const { declaration } = phrasing(bang, footer);

  if (major) {
    lines.push(
      `::warning::This pull request carries a \`RELEASE-MAJOR\` marker, so merging it spends a ` +
        `MAJOR. Consumers pin @12-apps/* exactly, so a major is a migration someone has to ` +
        `schedule — not a number, and one nobody scheduled just stalls the pin. The ` +
        `\`Major approval\` check is now waiting on the \`major-approval\` environment: a ` +
        `maintainer clicks Review deployments → Approve to let this merge, or Reject to refuse ` +
        `it. If the major was not intended, drop the marker instead — an ordinary breaking ` +
        `change ships as a MINOR here, and the check goes away on its own.`,
    );
  }

  // Not a failure, and deliberately still said out loud: this is the opposite of
  // the angular default, so a contributor who wrote the footer expecting a major
  // needs to see that it bought a minor rather than discover it on npm.
  if (breaking && !major) {
    lines.push(
      `::notice::This pull request carries ${declaration}, which cuts a MINOR here — ` +
        `every .releaserc.json maps \`breaking\` to \`minor\`. If you meant to spend a ` +
        `major, add a \`RELEASE-MAJOR:\` line to the body; a maintainer then approves it ` +
        `on the \`major-approval\` environment before this can merge.`,
    );
  }

  if (!breaking && !major) {
    lines.push("::notice::No breaking change declared — this PR cuts no major");
  }

  return { lines, major };
}

/**
 * Hand the VERDICT to the workflow.
 *
 * The output is `major`, and it is the MARKER — not `breaking`. Those came
 * apart in #336, when a breaking change stopped cutting a major here, and this
 * line kept writing `breaking`: every routine "this config is required now"
 * tightening armed the human gate and sat waiting for a click it never needed.
 * A gate that fires on the ordinary case is one people learn to clear without
 * reading, which costs the case it exists for.
 *
 * `major-guard.yml` reads this and, when it is true, starts a job bound to the
 * `major-approval` environment, which sits waiting for a deployment approval an
 * App installation token cannot give.
 */
function publishVerdict(major) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  appendFileSync(file, `major=${major ? "true" : "false"}\n`);
}

// Guarded so the selftest can import report() without the module deciding
// anything on the way in.
if (process.argv[1] && process.argv[1].endsWith("breaking-change-guard.mjs")) {
  const { lines, major } = report();
  for (const line of lines) console.log(line);
  publishVerdict(major);
}
