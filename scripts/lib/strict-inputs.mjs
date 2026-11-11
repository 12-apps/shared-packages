// The core of the strict-inputs gate: finds REQUEST input schemas in shipped
// package source and says which of them still strip an unknown key instead of
// refusing it (FUT-4729, owner 2026-11-11).
//
// THE RULE. Every request input (body, query, route params) is parsed by a
// strict Zod schema: an unknown key at any depth is a 422 with every problem
// and its path, never a field the parser quietly drops. `z.object` STRIPS, so
// an input that is a plain `z.object` is the exact shape the rule exists to
// retire. A strict one is `z.strictObject(…)` or `z.object(…).strict()`.
//
// WHAT IS AN INPUT SCHEMA. The gate cannot know which schemas a host will
// mount, so it reads the three signals the packages already give:
//
//   1. the NAME — a declaration (or an object key) ending in Body, Params,
//      Query, Input, Request or Payload, optionally with an `Of` factory
//      suffix (`roleWriteBodyOf`, `rbacMcpParams`, `createSearchInput`);
//   2. a `@request-input` tag in the comment above a declaration, for the
//      schemas whose name says "Schema" (`reportSpecSchema` is an input
//      because `saveReportBody` embeds it, and the name cannot say so);
//   3. REACH — everything an input schema names inside the same file is an
//      input schema too (`createDiscountBody` → `comboRequirementSchema`),
//      because a strict top level over a stripping nested object is the
//      half-measure that lets an unknown key through at depth.
//
// A response schema is none of these, so it is never read: the rule is about
// what a package ACCEPTS. Third-party inbound payloads are the one declared
// exception, listed by path below and in the ledger with the owner's reason.
import { stripComments } from "../copy-portability-gate.mjs";

/** A declaration or key whose name says it is something the package ACCEPTS. */
const INPUT_NAME = /(?:Body|Params|Query|Input|Request|Payload)(?:Of)?$/;
/** An inline route-definition key (`body: z.object({…})`) is an input by position. */
const INPUT_KEY = /^(?:body|params|query)$/;
const TAG = "@request-input";

/**
 * Files that parse a payload a THIRD PARTY wrote. They are exempt from the rule
 * for now and listed in the ledger with the reason: a strict schema there
 * refuses a payment notification the day a provider adds a field, so the owner
 * decided (FUT-4733, 2026-11-11) on a week of observation first.
 */
const THIRD_PARTY_INBOUND = [
  /^packages\/payments\/backend\/src\/providers\/[^/]*webhook[^/]*\.ts$/,
  /^packages\/payments\/backend\/src\/providers\/pagbank-legacy-notifications\.ts$/,
  /^packages\/payments\/backend\/src\/providers\/pagbank-oauth\.ts$/,
  /^packages\/payments\/backend\/src\/core\/(?:provider-webhook|webhook-pipeline|webhook-public)\.ts$/,
  /^packages\/auth\/src\/server\/auth-handler\.ts$/,
];

/** Whether a path parses a third party's payload and is exempt for now. */
export function isThirdPartyInbound(path) {
  return THIRD_PARTY_INBOUND.some((pattern) => pattern.test(path));
}

/** The leading whitespace width of a line. */
function indentOf(line) {
  return line.length - line.trimStart().length;
}

/** A line that continues the statement above it rather than starting a new one. */
const CONTINUATION = /^\s*[)}\]:.?|&]/;

/**
 * The last line (0-based, inclusive) of the statement starting at `start`: it
 * runs while the next non-blank line is indented deeper, or closes what the
 * statement opened.
 */
function statementEnd(lines, start) {
  const indent = indentOf(lines[start]);
  let end = start;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "") continue;
    if (indentOf(lines[i]) > indent || (indentOf(lines[i]) === indent && CONTINUATION.test(lines[i]))) {
      end = i;
      continue;
    }
    break;
  }
  return end;
}

/** Whether a comment block directly above `line` carries the request-input tag. */
function taggedAbove(rawLines, line) {
  for (let i = line - 1; i >= 0; i -= 1) {
    const text = rawLines[i].trim();
    if (text === "") return false;
    if (text.includes(TAG)) return true;
    if (!/^(?:\/\*|\*|\/\/)/.test(text)) return false;
  }
  return false;
}

const DECLARATION = /^(\s*)(?:export\s+)?(?:const|let|function)\s+(\w+)/;
const KEY = /^(\s*)(\w+)\s*:\s*\S/;

/**
 * Every declaration and object key in a source that could be an input schema,
 * with the statement text it spans.
 */
function candidates(source) {
  const rawLines = source.split("\n");
  const lines = stripComments(source).split("\n");
  const found = [];
  lines.forEach((text, line) => {
    const declared = DECLARATION.exec(text);
    const keyed = declared ? null : KEY.exec(text);
    const name = declared?.[2] ?? keyed?.[2];
    if (!name) return;
    const isDeclaration = declared !== null;
    const input =
      INPUT_NAME.test(name) || (!isDeclaration && INPUT_KEY.test(name)) || taggedAbove(rawLines, line);
    const end = statementEnd(lines, line);
    found.push({
      name,
      line: line + 1,
      isDeclaration,
      input,
      text: lines.slice(line, end + 1).join("\n"),
    });
  });
  return found;
}

/** The text with the inside of every string blanked, so prose in a `.describe()` is not code. */
function maskStrings(text) {
  let out = "";
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote === null) {
      if (QUOTES.includes(ch)) quote = ch;
      out += ch;
    } else if (ch === "\\") {
      out += "  ";
      i += 1;
    } else if (ch === quote) {
      quote = null;
      out += ch;
    } else out += ch === "\n" ? ch : " ";
  }
  return out;
}

const QUOTES = ["'", '"', "`"];

/** Index of the `)` matching the `(` at `open` in string-masked text; -1 when unbalanced. */
function closingParen(masked, open) {
  let depth = 0;
  for (let i = open; i < masked.length; i += 1) {
    if (masked[i] === "(") depth += 1;
    if (masked[i] === ")") depth -= 1;
    if (depth === 0) return i;
  }
  return -1;
}

/**
 * The ways a statement lets an unknown key through: a `.object(` not followed
 * directly by `.strict()`, `.passthrough()`, `.loose()`, `.catchall(` and
 * `looseObject(`. Returns one short reason per occurrence.
 */
function stripsOrAllows(source) {
  const text = maskStrings(source);
  const reasons = [];
  for (const match of text.matchAll(/\.object\s*\(/g)) {
    const close = closingParen(text, match.index + match[0].length - 1);
    const after = close === -1 ? "" : text.slice(close + 1);
    if (!/^\s*\.strict\s*\(\s*\)/.test(after)) reasons.push("z.object strips unknown keys");
  }
  for (const match of text.matchAll(/\.(passthrough|loose|catchall)\s*\(|\blooseObject\s*\(/g)) {
    reasons.push(`${match[1] ?? "looseObject"} lets unknown keys through`);
  }
  return reasons;
}

/** The in-file declarations an entry names, other than itself. */
function referencedDeclarations(entry, byName) {
  return [...byName.values()].filter(
    (declaration) =>
      declaration.name !== entry.name && new RegExp(`\\b${declaration.name}\\b`).test(entry.text),
  );
}

/**
 * The input schemas of one source file that are not strict: a Map of
 * `name` -> `{ line, reasons }`. A schema is reported under its OWN name, so a
 * nested object an input reaches is a finding of its own.
 */
export function nonStrictInputs(source) {
  if (!/from\s+["']zod["']|\bzod\b/.test(source)) return new Map();
  const all = candidates(source);
  const declarations = all.filter((entry) => entry.isDeclaration);
  const byName = new Map(declarations.map((entry) => [entry.name, entry]));

  const reached = new Map();
  const queue = all.filter((entry) => entry.input);
  while (queue.length > 0) {
    const entry = queue.pop();
    const key = `${entry.name}:${entry.line}`;
    if (reached.has(key)) continue;
    reached.set(key, entry);
    queue.push(...referencedDeclarations(entry, byName));
  }

  const findings = new Map();
  for (const entry of reached.values()) {
    const reasons = stripsOrAllows(entry.text);
    if (reasons.length === 0) continue;
    const taken = [...findings.keys()].filter((name) => name === entry.name || name.startsWith(`${entry.name}#`));
    const name = taken.length === 0 ? entry.name : `${entry.name}#${taken.length + 1}`;
    findings.set(name, { line: entry.line, reasons: [...new Set(reasons)] });
  }
  return findings;
}

/**
 * The shrink-only rule against a base ledger: an entry that is `grandfathered`
 * now and was not before is new debt.
 */
export function newDebt({ baseLedger, headLedger, ledgerPath }) {
  if (!baseLedger) return [];
  const failures = [];
  for (const [finding, entry] of headLedger) {
    if (entry.kind !== "grandfathered") continue;
    if (baseLedger.get(finding)?.kind === "grandfathered") continue;
    failures.push(
      `${ledgerPath} grew: "${finding}" is newly grandfathered — the debt may only shrink. ` +
        `Make the schema strict (z.strictObject) instead.`,
    );
  }
  return failures;
}

/**
 * Touch-must-fix: a diff that edits a file whose input schemas are still
 * `grandfathered` obliges the same PR to make them strict and delete the lines.
 */
export function touchMustFix({ changedFiles, headLedger, ledgerPath }) {
  const changed = new Set(changedFiles);
  const touched = new Set();
  for (const [finding, entry] of headLedger) {
    if (entry.kind !== "grandfathered") continue;
    const file = finding.split("::")[0];
    if (changed.has(file)) touched.add(file);
  }
  return [...touched].map(
    (file) =>
      `touch-must-fix: this change edits ${file}, which still has grandfathered input schemas in ` +
      `${ledgerPath} — make them strict and delete their lines in the same PR`,
  );
}
