/**
 * A linear scanner over the tags of an SVG document.
 *
 * Hand-written with `indexOf` and single character tests rather than regular
 * expressions: the SVG is uploaded by whoever owns the artwork, and a pattern
 * with nested or adjacent repetition (`<!--` … `-->`, a quoted attribute run,
 * a name followed by optional whitespace) backtracks polynomially on crafted
 * input. Every loop here advances the cursor on every step, so the whole
 * document is read in one pass whatever it contains.
 */

export interface XmlTag {
  name: string;
  /** The raw attribute text between the name and the closing `>`. */
  attrs: string;
  closing: boolean;
  selfClosing: boolean;
  /** Offset just past this tag's `>`. */
  end: number;
}

/** Constructs that are skipped whole: opener and terminator. */
const SKIPPED: readonly (readonly [string, string])[] = [
  ["<!--", "-->"],
  ["<![CDATA[", "]]>"],
  ["<?", "?>"],
  ["<!", ">"],
];

const isNameChar = (char: string): boolean => /^[\w:.-]$/.test(char);
const isSpace = (char: string): boolean => char === " " || char === "\n" || char === "\t" || char === "\r";

/** Offset of the `>` that ends a tag, skipping any `>` inside a quoted value, or -1. */
function tagEnd(source: string, from: number): number {
  let quote = "";
  for (let i = from; i < source.length; i += 1) {
    const char = source[i] ?? "";
    if (quote !== "") {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return i;
    }
  }
  return -1;
}

/** Where a skipped construct at `at` ends, or null when `at` is not one. -1 = unterminated. */
function skippedEnd(source: string, at: number): number | null {
  for (const [open, close] of SKIPPED) {
    if (!source.startsWith(open, at)) continue;
    const found = source.indexOf(close, at + open.length);
    return found === -1 ? -1 : found + close.length;
  }
  return null;
}

function readName(source: string, from: number): number {
  let i = from;
  while (i < source.length && isNameChar(source[i] ?? "")) i += 1;
  return i;
}

/**
 * The tag starting at `<` offset `at`; null when it is not an element tag;
 * "unterminated" when no `>` closes it — which is fatal to the document, as in
 * XML, and also what keeps this linear: retrying from the next `<` would scan
 * the same unterminated tail again for every one of them.
 */
function readTag(source: string, at: number): XmlTag | null | "unterminated" {
  const closing = source[at + 1] === "/";
  const nameStart = at + (closing ? 2 : 1);
  if (!/^[A-Za-z]$/.test(source[nameStart] ?? "")) return null;
  const nameEnd = readName(source, nameStart);
  const close = tagEnd(source, nameEnd);
  if (close === -1) return "unterminated";
  const inner = source.slice(nameEnd, close);
  const trimmed = inner.trimEnd();
  const selfClosing = trimmed.endsWith("/");
  return {
    name: source.slice(nameStart, nameEnd),
    attrs: selfClosing ? trimmed.slice(0, -1) : inner,
    closing,
    selfClosing,
    end: close + 1,
  };
}

/** Every element tag, in document order. Text, comments, CDATA and declarations are skipped. */
export function* xmlTags(source: string): Generator<XmlTag> {
  let at = source.indexOf("<");
  while (at !== -1) {
    const skipped = skippedEnd(source, at);
    if (skipped === -1) return;
    if (skipped !== null) {
      at = source.indexOf("<", skipped);
      continue;
    }
    const tag = readTag(source, at);
    if (tag === "unterminated") return;
    if (tag !== null) yield tag;
    at = source.indexOf("<", tag === null ? at + 1 : tag.end);
  }
}

function skipSpace(source: string, from: number): number {
  let i = from;
  while (i < source.length && isSpace(source[i] ?? "")) i += 1;
  return i;
}

/** `name="value"` pairs from a tag's attribute text; anything malformed is stepped over. */
export function scanAttributes(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < source.length) {
    const nameEnd = readName(source, i);
    if (nameEnd === i) {
      i += 1;
      continue;
    }
    const eq = skipSpace(source, nameEnd);
    const quoteAt = skipSpace(source, eq + 1);
    const quote = source[quoteAt];
    if (source[eq] !== "=" || (quote !== '"' && quote !== "'")) {
      i = nameEnd;
      continue;
    }
    const valueEnd = source.indexOf(quote, quoteAt + 1);
    if (valueEnd === -1) break;
    out[source.slice(i, nameEnd)] = source.slice(quoteAt + 1, valueEnd);
    i = valueEnd + 1;
  }
  return out;
}

/** `name(args)` pairs from a `transform` attribute, in order. */
export function scanFunctions(source: string): { name: string; args: string }[] {
  const out: { name: string; args: string }[] = [];
  let i = 0;
  while (i < source.length) {
    const open = source.indexOf("(", i);
    if (open === -1) break;
    const close = source.indexOf(")", open + 1);
    if (close === -1) break;
    const name = source.slice(i, open).replace(/,/g, " ").trim();
    out.push({ name, args: source.slice(open + 1, close) });
    i = close + 1;
  }
  return out;
}
