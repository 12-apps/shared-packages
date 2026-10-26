// The shapes the literal-copy gate reads, and the words it counts as copy.
//
// Split out of `scripts/literal-copy-gate.mjs` so the gate stays a gate (its
// argument, its exemptions, its ledger) and this stays a reader. Every rule
// here is argued in that file's header, where a reader deciding whether to
// widen one looks first.
import { stripComments } from "../copy-portability-gate.mjs";

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
  const scan = { out: [], depth: 0, sawTernary: false };
  for (let i = 0; i < expr.length; i += 1) {
    if (scan.depth === 0 && stops.includes(expr[i])) break;
    i = scanStep(expr, i, scan);
  }
  return scan.out;
}

/** One character of `valueLiterals`' scan; returns the index the scan resumes from. */
function scanStep(expr, i, scan) {
  const ch = expr[i];
  if (ch === "'" || ch === '"' || ch === "`") {
    const end = skipString(expr, i);
    if (scan.depth === 0 && inValuePosition(expr.slice(0, i), scan.sawTernary)) scan.out.push(expr.slice(i, end));
    return end - 1;
  }
  if (OPENERS.has(ch)) scan.depth += 1;
  else if (CLOSERS.has(ch)) scan.depth -= 1;
  else if (scan.depth === 0 && isTernaryMark(expr, i)) scan.sawTernary = true;
  return i;
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
 * that hid longest were. A leading `+ ` is the add-row glyph (`+ Medida`),
 * part of the words rather than a reason to stop reading them.
 */
function blockFinding(lines, index) {
  const text = lines[index].trim();
  if (!/^(?:[+] )?[A-Za-zÀ-ÿ][^<>{}"'`=;()[\]]*$/.test(text) || !isProse(text)) return null;
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

