// The literal-copy gate: a rendered word in shipped package source comes from
// the HOST, and the check for that is structural rather than lexical.
//
// ## Why a third gate, when two already look at copy
//
// `copy-portability-gate.mjs` finds pt-BR by its DIACRITICS.
// `vocabulary-portability-gate.mjs` finds the origin host's domain NOUNS.
// Both ask "does this string look like it came from that product?", and both
// answer with a word list — which is the thing that cannot be made complete.
//
// Measured, on the same tree, over four widenings of the same scanner:
//
//   pass 1  diacritics only ................  0 in the files below
//   pass 2  + UI verbs ....................  39
//   pass 3  + inflections .................  51
//   pass 4  + gerunds, -mente, -ção, glue .  51, and a different 51
//
// Every one of those was reported as a floor at the time, and every one was
// wrong in the same direction. `Bloco`, `Marcar tudo`, `Publicar`, `Campo`,
// `Formato`, `Empilhado`, `Duplicar` — each shipped through at least one pass
// built to find exactly it. A fifth widening would find a fifth number.
//
// It also cannot see the OTHER half of the same defect at all. `@12-apps/ui`
// ships `aria-label="Zoom in"`, `title="No data available"`, `Next`, `Skip`.
// Those are just as unportable — a Brazilian host mounting `Lightbox` gets
// English read out to its blind users — and no Portuguese word list will ever
// name one. "Is this the origin host's language?" was never the question. The
// question is "did the package write a word instead of asking for it?", and
// that one is decidable.
//
// ## WHAT IS FLAGGED
//
// Two shapes, both narrow on purpose. A gate that cries wolf gets an ever
// longer exceptions file and then protects nothing.
//
//   1. A COPY PROP given a bare string literal. `label`, `title`,
//      `placeholder`, `aria-label`, `helperText`, `alt`, … — the props whose
//      value a person reads. Everything else on an element is structure,
//      styling or identity, and a literal there is not copy.
//
//   2. A JSX TEXT CHILD that is prose, alone on its line between an opening
//      and a closing tag. `<Button>Publicar</Button>` split across three
//      lines is how this repo's formatter writes it, and it is where the
//      leaks that hid the longest were: `draft-banner.tsx` read `copy.title`
//      on one line and rendered `Publicar` on the next.
//
// `isProse` then drops what is not a word a reader sees: camelCase tokens,
// kebab/snake ids, SCREAMING constants, URLs and paths, and anything under two
// characters or carrying no letter. Those are the false positives that would
// have made the ledger meaningless.
//
// Deliberately NOT flagged, each because the alternative is worse:
//
//   - `.ts` files. A rendered word lives in a component; a string in a plain
//     module is far more often a key, a header name or a developer-facing
//     `Error` message, which CLAUDE.md puts in English on purpose. The two
//     existing gates still sweep those files for language.
//   - A template literal or an expression. `{`${a}/${b}`}` may or may not be
//     copy, and guessing would put unanswerable entries in the ledger.
//   - Multi-line prose. Narrow beats complete here: this gate's value is that
//     every entry is real, so that the ledger is a work list rather than a
//     wall of noise to be exempted wholesale.
//
// ## THE RATCHET
//
// `.literal-copy-exceptions.json`, shrink-only in BOTH directions, keyed by
// `path:line — snippet` so one file's twelve findings burn down one at a
// time. A NEW finding fails (you cannot grandfather forward); an entry whose
// finding is gone fails as stale (delete the line). The count is what makes
// the class visible: it was invisible before, which is why it grew.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { inScope } from "./lib/shipped-source.mjs";
import { stripComments } from "./copy-portability-gate.mjs";

const LABEL = "[literal-copy]";
const EXCEPTIONS_PATH = ".literal-copy-exceptions.json";

/**
 * The props whose value a PERSON reads.
 *
 * Built fresh per call so no caller can mutate what a later one checks
 * against — the same rule the vocabulary gate's list follows.
 */
export function copyProps() {
  return new Set([
    "label", "title", "placeholder", "description", "helperText", "alt",
    "aria-label", "ariaLabel", "confirmText", "cancelText", "submitLabel",
    "emptyText", "caption", "heading", "subtitle", "tooltip", "hint",
    "removeLabel", "buttonLabel", "actionLabel", "message", "summary",
  ]);
}

/**
 * Is this literal a word a reader sees, rather than a token, an id or a path?
 *
 * Every rule here was measured against the whole tree before it was admitted.
 * The camelCase and kebab rules alone drop the bulk of what a naive "any
 * string literal" reading would report.
 */
export function isProse(text) {
  const t = text.trim();
  if (t.length < 2) return false;
  if (!/[A-Za-zÀ-ÿ]/.test(t)) return false;
  if (/^[a-z][a-z0-9]*([A-Z][a-z0-9]*)*$/.test(t)) return false;
  if (/^[a-z0-9]+([-_.][a-z0-9]+)*$/.test(t)) return false;
  if (/^[A-Z0-9_]+$/.test(t)) return false;
  if (/^(https?:|\/|\.\/|\.\.\/|data:|blob:|#)/.test(t)) return false;
  return true;
}

/** Shape 1: a copy prop given a bare string literal, on one line. */
function propFindings(line, props) {
  const out = [];
  for (const match of line.matchAll(/([A-Za-z-]+)=(?:"([^"\n]*)"|'([^'\n]*)')/g)) {
    const value = match[2] ?? match[3] ?? "";
    if (props.has(match[1]) && isProse(value)) out.push(`${match[1]}="${value}"`);
  }
  return out;
}

/**
 * Shape 2b: `<Tag>Prose</Tag>` on ONE line, short enough that the formatter
 * left it alone — which is how `Agrupar por` sat inside a `<SectionHeading>`
 * through the block rule below.
 *
 * A MATCHED tag pair, never a bare `>…<`: a TypeScript generic supplies both
 * characters, so `() => Promise<void>` reads as "prose between two angles" and
 * produced 62 false findings when this was first written the loose way.
 */
function inlineFindings(line) {
  const out = [];
  for (const match of line.matchAll(/<([A-Za-z][\w.]*)(?:\s[^<>]*)?>([^<>{}"'`]+)<\/\1>/g)) {
    const inner = match[2].trim();
    if (isProse(inner)) out.push(`(text) ${inner}`);
  }
  return out;
}

/**
 * Shape 2a: prose ALONE on its line, between an opening and a closing tag —
 * how this repo's formatter writes a button's own words, and where the leaks
 * that hid longest were.
 */
function blockFinding(lines, index) {
  const text = lines[index].trim();
  if (!/^[A-Za-zÀ-ÿ][^<>{}"'`=;()[\]]*$/.test(text) || !isProse(text)) return null;
  const opens = />$/.test(lines[index - 1]?.trim() ?? "");
  const closes = /^<\//.test(lines[index + 1]?.trim() ?? "");
  return opens && closes ? `(text) ${text}` : null;
}

/** Every literal-copy finding in one file's comment-stripped source. */
export function findLiterals(source) {
  const props = copyProps();
  const lines = stripComments(source).split("\n");
  return lines.flatMap((line, index) => {
    const block = blockFinding(lines, index);
    const snippets = block === null ? inlineFindings(line) : [block];
    return [...propFindings(line, props), ...snippets].map((snippet) => [index + 1, snippet]);
  });
}

/** How a finding is keyed in the ledger, and printed in the failure list. */
export function describe(path, line, snippet) {
  return `${path}:${line} — ${snippet}`;
}

function scanRepo() {
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
  // `.tsx` only: see the header on why a plain module's strings are not this
  // gate's business.
  const keyed = tracked
    .filter((path) => path.endsWith(".tsx") && inScope(path))
    .flatMap((path) =>
      findLiterals(readFileSync(path, "utf8")).map(([line, snippet]) => describe(path, line, snippet)),
    );
  return new Set(keyed);
}

function readExceptions() {
  if (!existsSync(EXCEPTIONS_PATH)) return {};
  return JSON.parse(readFileSync(EXCEPTIONS_PATH, "utf8"));
}

function selftest() {
  const cases = [
    [findLiterals('<Button label="Publicar" />').length === 1, "a copy prop with a literal is a finding"],
    [findLiterals('<Button label={copy.publish} />').length === 0, "a copy prop reading a contract is not"],
    [findLiterals('<Box data-testid="publish-button" />').length === 0, "a test id is not copy"],
    [findLiterals('<Box className="publish" />').length === 0, "a class name is not copy"],
    [findLiterals("<Button>\n  Publicar\n</Button>").length === 1, "a prose text child is a finding"],
    [findLiterals("<SectionHeading>Agrupar por</SectionHeading>").length === 1, "and the same words on one line"],
    [findLiterals("<Box>{copy.groupBy}</Box>").length === 0, "an inline expression is not"],
    [findLiterals("const f: () => Promise<void> = g;").length === 0, "a generic is not a tag pair"],
    [findLiterals("<Text>Publicar</Text> and <Text>Salvar</Text>").length === 2, "both pairs on a line"],
    [findLiterals("<Button>\n  {copy.publish}\n</Button>").length === 0, "an expression child is not"],
    [findLiterals('<img alt="Foto do produto" />').length === 1, "alt text is copy"],
    [findLiterals('// <Button label="Publicar" />\nconst a = 1;').length === 0, "comments are stripped"],
    [findLiterals('<A aria-label="Zoom in" />').length === 1, "English is a finding too — the leak is the literal, not the language"],
    [isProse("Zoom in") && isProse("Publicar"), "prose in either language"],
    [!isProse("dataTestId") && !isProse("publish-button") && !isProse("MAX_ROWS"), "tokens are not prose"],
    [!isProse("https://x.test") && !isProse("./a/b") && !isProse("x"), "paths and single letters are not prose"],
    [inScope("packages/ui/src/components/form/Button.tsx"), "shipped src is in scope"],
    [!inScope("packages/ui/src/components/form/__tests__/Button.test.tsx"), "tests are out of scope"],
  ];
  const failed = cases.filter(([ok]) => !ok);
  for (const [, name] of failed) console.error(`${LABEL} selftest FAILED: ${name}`);
  return failed.length === 0;
}

function main() {
  if (!selftest()) process.exit(1);
  const findings = scanRepo();
  const exceptions = readExceptions();
  const failures = [];
  for (const finding of findings) {
    if (finding in exceptions) continue;
    failures.push(
      `a word this package WROTE rather than asked for: ${finding} — user-facing copy is host ` +
        `config with no default. Add the key to the package's copy contract and its pt-BR pack, ` +
        `and read it here.`,
    );
  }
  for (const finding of Object.keys(exceptions)) {
    if (!findings.has(finding)) {
      failures.push(
        `stale exception: ${finding} is no longer a finding (fixed, moved or renamed) — delete its ` +
          `line from ${EXCEPTIONS_PATH}`,
      );
    }
  }
  if (failures.length > 0) {
    console.error(`${LABEL} ${failures.length} violation(s):`);
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    process.exit(1);
  }
  console.log(
    `${LABEL} clean — ${findings.size} literal(s) in shipped .tsx, all ${findings.size} ` +
      `grandfathered (shrink-only; the burn-down is each package's copy contract).`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
