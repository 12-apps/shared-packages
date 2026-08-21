// Flags a pull request that would cut a MAJOR, while its commit message is
// still editable.
//
// The approval gate in ci.yml is the safety net and this is the feedback. They
// answer the same question at different moments, and the difference matters: by
// the time `detect-majors` runs, the commit is on `main` and the only remaining
// choices are "approve" or "leave the package unreleased". Here the message can
// simply be reworded.
//
// TWO SYNTAXES CUT A MAJOR HERE, and they are equals: a `BREAKING CHANGE:`
// footer, and the `!` shorthand in the header. Both are gated the same way,
// because both say the same thing.
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
//   PR_LABELS      comma-separated label names
//   COMMIT_FILE    path to a JSON array of the PR's commit messages
//
// The commits arrive through a FILE rather than a variable because a commit
// message is multi-line and an environment variable cannot hold a NUL: execve
// forbids it, and bash's `$(...)` strips it before that. Any single-character
// separator that CAN survive is a character a commit body may legitimately
// contain, so the boundary would be guesswork. JSON has no such ambiguity.
import { appendFileSync, readFileSync } from "node:fs";

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
 * What this PR would do, as `{ breaking, bang, footer, allowed }`.
 *
 * `breaking` is the union: either syntax cuts a major, so either one needs
 * consent. `bang` and `footer` are kept apart only so the message can name
 * which one the author wrote.
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

  const footer = all.some((message) => BREAKING_FOOTER.test(message));
  const bang = all.some((message) => BANG_HEADER.test(message.split("\n")[0] ?? ""));

  return { breaking: footer || bang, bang, footer, allowed: labelsOf(env).includes(ESCAPE_LABEL) };
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
      undo: "drop the `!` and remove the footer — either one alone still cuts the major",
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

/** The lines to print, and whether to fail. Pure, so the selftest can read it. */
export function report(env = process.env) {
  const { breaking, bang, footer, allowed } = inspect(env);
  const lines = [];
  let failed = false;

  const { declaration, undo } = phrasing(bang, footer);

  if (breaking && !allowed) {
    lines.push(
      `::error::This pull request carries ${declaration}, so merging it cuts a MAJOR. ` +
        `Consumers pin @12-apps/* exactly, so a major is a migration someone has to ` +
        `schedule — not a number. If that is intended, add the \`${ESCAPE_LABEL}\` label ` +
        `and re-run. If it is not, ${undo}.`,
    );
    failed = true;
  }

  if (breaking && allowed) {
    lines.push(
      `::notice::Major release intended — \`${ESCAPE_LABEL}\` is set, declared by ` +
        `${declaration}. It still needs approval in the \`release-major\` environment ` +
        `after merge.`,
    );
  }

  if (!breaking) lines.push("::notice::No breaking change declared — this PR cuts no major");

  return { lines, failed };
}

/**
 * Hand the VERDICT to the workflow, separately from this check's own outcome.
 *
 * The two are not the same question any more. This check going red is feedback —
 * a human can still clear it, and an agent holding the repo's token can clear it
 * too, by adding the `allow-major` label through the API. That is not a
 * hypothetical: it is how the label got onto #319.
 *
 * So the label no longer decides whether the MERGE is possible. `major-guard.yml`
 * reads this output and, when it is true, starts a job bound to the
 * `major-approval` environment, which sits waiting for a deployment approval that
 * an App installation token cannot give. The label silences the red; only a human
 * clicking Review deployments unblocks the merge.
 *
 * Written unconditionally — on a major the step below also exits 1, and a job's
 * outputs must survive that, which is why the workflow reads them under
 * `always()`.
 */
function publishVerdict(major) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  appendFileSync(file, `major=${major ? "true" : "false"}\n`);
}

// Guarded so the selftest can import report() without the module deciding
// anything on the way in.
if (process.argv[1] && process.argv[1].endsWith("breaking-change-guard.mjs")) {
  const { lines, failed } = report();
  for (const line of lines) console.log(line);
  publishVerdict(inspect().breaking);
  process.exitCode = failed ? 1 : 0;
}
