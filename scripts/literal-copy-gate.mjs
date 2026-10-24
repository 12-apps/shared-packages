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

import { checkLedger, readLedger, summarize } from "./lib/exception-ledger.mjs";
import { inScope } from "./lib/shipped-source.mjs";
import { stripComments } from "./copy-portability-gate.mjs";

const LABEL = "[literal-copy]";
const EXCEPTIONS_PATH = ".literal-copy-exceptions.json";

/**
 * Surfaces whose reader is a DEVELOPER, exempted as whole files.
 *
 * A file-level rule, not a per-line grandfather, because the claim is about
 * what the surface IS rather than about which words it currently holds — so it
 * does not go stale when a line moves, and it cannot quietly cover a product
 * string that drifts into the same file later without someone reading this
 * list again.
 *
 * The test is not "is it technical", it is "would a host ever write different
 * words here?". CLAUDE.md puts everything a developer reads in English
 * deliberately; a pack for one of these would be every adopter copying the
 * same English sentence to satisfy a type, which is ceremony rather than
 * portability — and ceremony is how a gate loses the argument the next time
 * someone wants an exemption.
 */
const DEV_SURFACES = new Map([
  [
    "packages/observability-frontend/src/react/self-check.tsx",
    "The Sentry diagnostics page. It names window.onerror, source maps and the DSN, " +
      "is mounted at a fixed runbook URL, and exists to be opened by whoever is debugging " +
      "that deployment — never by its users.",
  ],
  [
    "packages/ui/src/components/utility/Portal/Portal.button-container.example.tsx",
    "A worked example of mounting a Portal into an HTMLButtonElement. Nothing " +
      "imports it and it is not in the package's exports — it exists to be READ, " +
      "by someone deciding whether Portal does what they need. Its sentences are " +
      "the demonstration itself ('This portal is rendered inside the button " +
      "element!'), so porting them to a copy table would ask every host to " +
      "supply words for a screen no host mounts.",
  ],
]);

/**
 * The props whose value a PERSON reads.
 *
 * Built fresh per call so no caller can mutate what a later one checks
 * against — the same rule the vocabulary gate's list follows. The native
 * spellings (`accessibilityLabel`, `accessibilityHint`) and the ARIA attributes
 * that are read out (`aria-description`, `aria-valuetext`, …) are copy for the
 * same reason `aria-label` is: a screen reader says them.
 */
export function copyProps() {
  return new Set([
    "label", "title", "placeholder", "description", "helperText", "alt",
    "aria-label", "ariaLabel", "confirmText", "cancelText", "submitLabel",
    "emptyText", "caption", "heading", "subtitle", "tooltip", "hint",
    "removeLabel", "buttonLabel", "actionLabel", "message", "summary",
    "accessibilityLabel", "accessibilityHint", "aria-description",
    "aria-roledescription", "aria-valuetext", "aria-placeholder", "titleAccess",
  ]);
}

/**
 * A name that says its value is copy even when the list above does not know
 * it: `closeLabel`, `emptyTitle`, `loadingText`, `searchPlaceholder`. The
 * lower-case letter before the suffix keeps a bare `Label` type out.
 */
const COPY_SUFFIX = /[a-z](?:Label|Title|Text|Placeholder|Message|Hint|Tooltip|Caption|Heading|Subtitle)$/;

/**
 * Three keys an OBJECT LITERAL uses for a developer's sentence far more often
 * than for copy: an error body's `message`, a manifest env var's
 * `description` and an MCP tool's `summary`, which a model reads. Measured:
 * every `message:` with prose in shipped source was an HTTP error body, a log
 * record or a test stub; every `description:` a manifest line or a mock
 * address; every `summary:` an MCP tool. As props and as parameter defaults
 * they stay copy.
 */
const OBJECT_KEY_DEV = new Set(["message", "description", "summary"]);

/** Is this name one whose value a person reads? */
export function isCopyName(name, props = copyProps()) {
  return props.has(name) || COPY_SUFFIX.test(name);
}

/**
 * Files that hold sample data rather than the package's own words: a story's
 * fixture table, a `*.fixtures.ts` file a test and a story share. Their strings
 * are what a HOST would pass — the other side of the question this gate asks.
 * Local to this gate on purpose: the copy and vocabulary gates ask about the
 * language of anything in the tarball, and a fixture is in the tarball.
 */
const SAMPLE_DATA = /(?:^|\/)(?:stories|fixtures)\/|(?:^|\/)fixtures\.[jt]sx?$|\.fixtures\.[jt]sx?$/;

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
  return !isCodeOrName(t);
}

/**
 * Two shapes that read like words and are not COPY, admitted when the gate
 * learned to read object literals and parameter defaults:
 *
 *  - a CSS function value, `minmax(0, 1fr)` — a grid track under a key that
 *    happens to be called `caption`;
 *  - a product or format NAME: a compound like `OpenAI`, or a name with its
 *    file extension or its maker in parentheses, `Excel (.xlsx)`,
 *    `Claude (Anthropic)`. No host writes different words for those.
 */
function isCodeOrName(t) {
  if (/^[a-z][\w-]*\(.*\)$/.test(t)) return true;
  if (/^[A-Z][a-z]+[A-Z]\w*$/.test(t)) return true;
  return /^[A-Z]\w*\s\((?:\.[a-z0-9]+|[A-Z][a-z]+)\)$/.test(t);
}

/**
 * Inside a COPY slot, a single lower-case dictionary word is copy too:
 * `aria-label="close"`. Outside one, `^[a-z]+$` is the commonest identifier
 * shape there is, which is why `isProse` drops it.
 */
export function isCopyWord(text) {
  return isProse(text) || /^[a-zà-ÿ]{2,}$/.test(text.trim());
}

/** A placeholder's stand-in: no word survives being glued to one. */
const HOLE = "\u0000";

/** The literal text of a template body, each `${…}` replaced by `HOLE`. */
function templateText(body) {
  let out = "";
  let depth = 0;
  for (let i = 0; i < body.length; i += 1) {
    if (depth === 0 && body[i] === "$" && body[i + 1] === "{") {
      depth = 1;
      out += HOLE;
      i += 1;
    } else if (depth > 0) {
      if (body[i] === "{") depth += 1;
      if (body[i] === "}") depth -= 1;
    } else out += body[i];
  }
  return out;
}

/**
 * Does a template literal's LITERAL part carry a word? `Go to slide ${n}` and
 * `+${n} more` do; `${a}/${b}`, `tab-${id}`, `${n}px` and `v${n}` do not — a
 * token glued to a placeholder is a unit, an id or a prefix, never a word.
 */
export function templateHasWords(body) {
  return templateText(body)
    .split(/\s+/)
    .some((token) => !token.includes(HOLE) && /^[(["“]?[A-Za-zÀ-ÿ]*[a-zà-ÿ][A-Za-zÀ-ÿ]*[.,:;!?…)\]"”]*$/.test(token) && /[A-Za-zÀ-ÿ]{2}/.test(token));
}

const OPENERS = new Set(["(", "[", "{"]);
const CLOSERS = new Set([")", "]", "}"]);

/** Index just past the string/template opening at `start`, escapes and `${}` honoured. */
function skipString(text, start) {
  const quote = text[start];
  let depth = 0;
  for (let i = start + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "\\") i += 1;
    else if (quote === "`" && ch === "$" && text[i + 1] === "{") depth += 1;
    else if (depth > 0 && ch === "}") depth -= 1;
    else if (depth === 0 && ch === quote) return i + 1;
  }
  return text.length;
}

/** The operator tokens after which a literal is a VALUE the slot can take. */
const VALUE_POSITION = /(?:^|\?\?|\?|:|\|\||&&)$/;

/**
 * Is the literal at `start` of a depth-0 expression in value position: the
 * whole expression, a ternary branch, or the right side of `??`, `||`, `&&`?
 * A `:` branch only counts after a `?` — otherwise it is an object key's.
 */
function inValuePosition(before, sawTernary) {
  const op = before.trimEnd();
  if (!VALUE_POSITION.test(op)) return false;
  if (op.endsWith("?") && !op.endsWith("??")) return true;
  return !op.endsWith(":") || sawTernary;
}

/**
 * The literals an expression can EVALUATE TO, read at bracket depth 0 up to
 * the first `stop` character. `open ? 'Collapse' : 'Expand'` yields both;
 * `copy[open ? 'a' : 'b']` yields nothing (a key lookup), and so do
 * `x === 'start'` and `t('close')` (a comparison and an argument).
 */
export function valueLiterals(expr, stops = "") {
  const out = [];
  let depth = 0;
  let sawTernary = false;
  for (let i = 0; i < expr.length; i += 1) {
    const ch = expr[i];
    if (depth === 0 && stops.includes(ch)) break;
    if (ch === "'" || ch === '"' || ch === "`") {
      const end = skipString(expr, i);
      if (depth === 0 && inValuePosition(expr.slice(0, i), sawTernary)) out.push(expr.slice(i, end));
      i = end - 1;
    } else if (OPENERS.has(ch)) depth += 1;
    else if (CLOSERS.has(ch)) depth -= 1;
    else if (depth === 0 && isTernaryMark(expr, i)) sawTernary = true;
  }
  return out;
}

/** A `?` that opens a ternary, not half of `??` or an optional chain `?.`. */
function isTernaryMark(expr, i) {
  return expr[i] === "?" && expr[i - 1] !== "?" && expr[i + 1] !== "?" && expr[i + 1] !== ".";
}

/** Is a quoted literal (quotes included) copy, judged by `isWord` for plain strings? */
function literalIsCopy(literal, isWord) {
  const body = literal.slice(1, -1);
  return literal[0] === "`" ? templateHasWords(body) : isWord(body);
}

/** The copy literals of one slot, rendered as ledger snippets. */
function slotFindings(prefix, expr, { stops, isWord }) {
  return valueLiterals(expr, stops)
    .filter((literal) => literalIsCopy(literal, isWord))
    .map((literal) => `${prefix}${literal}`);
}

/** Shape 1: a copy prop given a bare string literal, on one line. */
function propFindings(line, props) {
  const out = [];
  for (const match of line.matchAll(/([A-Za-z-]+)=(?:"([^"\n]*)"|'([^'\n]*)')/g)) {
    const value = match[2] ?? match[3] ?? "";
    if (isCopyName(match[1], props) && isCopyWord(value)) out.push(`${match[1]}="${value}"`);
  }
  return out;
}

/**
 * Shape 3: a copy prop given an EXPRESSION — `aria-label={`Go to slide ${n}`}`,
 * `title={open ? 'Collapse' : 'Expand'}`, `alt={label ?? 'Image'}`. Only the
 * literals the expression can evaluate to count, so `label={copy[key]}` and
 * `aria-current={x ? 'page' : undefined}` (not a copy prop) never reach it.
 */
function propExpressionFindings(line, props) {
  return [...line.matchAll(/([A-Za-z-]+)=\{/g)]
    .filter((match) => isCopyName(match[1], props))
    .flatMap((match) =>
      slotFindings(`${match[1]}=`, line.slice(match.index + match[0].length), { stops: "}", isWord: isCopyWord }),
    );
}

/**
 * Shape 4: an expression TEXT CHILD — a line that is only `{…}`, or `>{…}<`
 * inline — whose value is a literal: `{error.message || 'Something failed'}`,
 * `{`+${n} more`}`. `{' '}` and `{active ? ` (${n})` : ''}` carry no word.
 */
function textExpressionFindings(line) {
  const trimmed = line.trim();
  const whole = /^\{(?!\.\.\.)(.*)\}$/.exec(trimmed);
  const inline = [...line.matchAll(/>\{(?!\.\.\.)([^{}]*)\}</g)].map((m) => m[1]);
  const exprs = whole ? [whole[1], ...inline] : inline;
  return exprs.flatMap((expr) => slotFindings("(text) ", expr, { stops: "", isWord: isCopyWord }));
}

/**
 * Shape 5: an OBJECT LITERAL key that names copy — `{ label: 'Phone Number' }`,
 * `'aria-label': `Go to slide ${n}``, a component's `*_DEFAULTS` table. No
 * space before the colon, which is how a key is written and a ternary's `:`
 * is not. Plain prose only: a lone `label: 'bold'` here is a lookup key.
 */
function objectKeyFindings(line, props) {
  return [...line.matchAll(/(?<![\w$.?-])(['"]?)([A-Za-z][\w-]*)\1:\s/g)]
    .filter((match) => isCopyName(match[2], props) && !OBJECT_KEY_DEV.has(match[2]))
    .flatMap((match) =>
      slotFindings(`${match[2]}=`, line.slice(match.index + match[0].length), { stops: ",;}", isWord: isProse }),
    );
}

/**
 * Is line `index` inside a class constructor's parameter list? A default
 * there is an `Error` subclass's developer message (`message = 'Webhook
 * verification failed'`): components are functions, and a constructor's words
 * are read by whoever catches it.
 */
function inConstructor(lines, index) {
  for (let i = index; i >= Math.max(0, index - 8); i -= 1) {
    if (/\bconstructor\s*\(/.test(lines[i])) return true;
    if (i < index && /[;{]\s*$/.test(lines[i]) && !/\(\s*\{\s*$/.test(lines[i])) return false;
  }
  return false;
}

/**
 * Shape 6: a DEFAULT VALUE for a copy-named parameter or destructured prop —
 * `({ label = 'Phone Number' })`, `(message = 'This field is required')`. The
 * spaces around `=` are how the formatter writes a default and never a JSX
 * attribute; `const x = …` declarations and `a.b = …` writes are left out.
 */
function defaultFindings(lines, index, props) {
  const line = lines[index];
  const matches = [...line.matchAll(/(?<![\w$.])(?<!\b(?:const|let|var)\s+)([A-Za-z]\w*) = (?!=)/g)].filter(
    (match) => isCopyName(match[1], props),
  );
  if (matches.length === 0 || inConstructor(lines, index)) return [];
  return matches.flatMap((match) =>
    slotFindings(`${match[1]}=`, line.slice(match.index + match[0].length), { stops: ",;)}", isWord: isProse }),
  );
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

/** The JSX-only shapes: props, prop expressions and text children. */
function jsxFindings(lines, index, props) {
  const line = lines[index];
  const block = blockFinding(lines, index);
  const text = block === null ? inlineFindings(line) : [block];
  return [
    ...propFindings(line, props),
    ...propExpressionFindings(line, props),
    ...text,
    ...textExpressionFindings(line),
  ];
}

/**
 * Every literal-copy finding in one file's comment-stripped source. `jsx` is
 * false for a plain `.ts` module, which gets only the two shapes that are
 * unambiguous there: copy-key object literals and copy-named defaults.
 */
export function findLiterals(source, { jsx = true } = {}) {
  const props = copyProps();
  const lines = stripComments(source).split("\n");
  return lines.flatMap((line, index) => {
    const shared = [...objectKeyFindings(line, props), ...defaultFindings(lines, index, props)];
    const snippets = jsx ? [...jsxFindings(lines, index, props), ...shared] : shared;
    return [...new Set(snippets)].map((snippet) => [index + 1, snippet]);
  });
}

/** How a finding is keyed in the ledger, and printed in the failure list. */
export function describe(path, line, snippet) {
  return `${path}:${line} — ${snippet}`;
}

/**
 * `.tsx` and plain `.ts`, never a declaration file. A `copy/*.ts` contract is
 * types plus doc comments, and the packs (`en-US.*.ts`, `pt-BR.*.ts`,
 * `locales/`) are out of scope by `inScope` already: they are where the words
 * are SUPPOSED to be.
 */
const SCANNED = /(?<!\.d)\.tsx?$/;

function scanRepo() {
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
  const keyed = tracked
    .filter((path) => SCANNED.test(path) && inScope(path) && !DEV_SURFACES.has(path) && !SAMPLE_DATA.test(path))
    .flatMap((path) =>
      findLiterals(readFileSync(path, "utf8"), { jsx: path.endsWith(".tsx") }).map(([line, snippet]) =>
        describe(path, line, snippet),
      ),
    );
  return new Set(keyed);
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
    [[...DEV_SURFACES.values()].every((why) => why.length > 40), "every dev surface states why"],
    [!inScope("packages/ui/src/components/form/__tests__/Button.test.tsx"), "tests are out of scope"],
  ];
  const failed = cases.filter(([ok]) => !ok);
  for (const [, name] of failed) console.error(`${LABEL} selftest FAILED: ${name}`);
  return failed.length === 0;
}

function main() {
  if (!selftest()) process.exit(1);
  const findings = scanRepo();
  const ledger = readLedger(EXCEPTIONS_PATH, { existsSync, readFileSync });
  const { failures, counts } = checkLedger({
    findings,
    ledger,
    ledgerPath: EXCEPTIONS_PATH,
    unlisted: (finding) =>
      `a word this package WROTE rather than asked for: ${finding} — user-facing copy is host ` +
      `config with no default. Add the key to the package's copy contract and its pt-BR pack, ` +
      `and read it here.`,
  });
  if (failures.length > 0) {
    console.error(`${LABEL} ${failures.length} violation(s):`);
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    process.exit(1);
  }
  console.log(
    summarize({
      label: LABEL,
      total: findings.size,
      noun: "literal(s) in shipped .tsx",
      counts,
      burndown: "the burn-down is each package's copy contract",
    }),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
