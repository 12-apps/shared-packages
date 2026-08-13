import { readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

/**
 * Static-scan helpers for the RBAC coverage gate (12-13) — the discovery half
 * of future-pay's `scripts/lib/surface-scan.ts`, shipped with the package so
 * the gate and the guards it looks for version together.
 *
 * THE SCAN ROOT IS THE WHOLE `app` FOLDER, never `app/api`, and that is
 * load-bearing: a completeness gate rooted below the surface it claims to
 * cover does not fail when it misses something — it simply never looks.
 *
 * Detection is deliberately regex-over-source (no TS compiler): fast,
 * dependency-free, and matching how the app router keys routes off file paths
 * plus exported names.
 */

/** Recursively collect every `route.ts` under `dir` (skipping node_modules). */
export function walkRouteFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walkRouteFiles(full);
    return entry.name === 'route.ts' ? [full] : [];
  });
}

/** Recursively collect every `*actions.ts` under `dir`. */
export function walkActionFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walkActionFiles(full);
    return /(^|-)actions\.ts$/.test(entry.name) ? [full] : [];
  });
}

/**
 * `app/api/checkout/[id]/route.ts` → `/api/checkout/{id}` (catch-alls too).
 * Relative to `appDir`, so it is agnostic about the first segment.
 */
export function urlPathOf(routeFile: string, appDir: string): string {
  const segments = relative(appDir, dirname(routeFile)).split(sep);
  const mapped = segments.map((segment) =>
    segment.startsWith('[')
      ? `{${segment.replace(/^\[(\.\.\.)?/, '').replace(/\]$/, '')}}`
      : segment,
  );
  return `/${mapped.join('/')}`;
}

/** Any `\w+` run — the default `accept`, and what `readWord` can return. */
const IDENTIFIER = /^\w+$/;

/**
 * How one caller's export heads differ. THE GRAMMAR IS THE ONLY THING TWO
 * COVERAGE GATES MAY DISAGREE ABOUT — the walk itself is shared, so they can
 * never disagree about what an export head IS.
 */
export interface ExportHeadGrammar {
  /**
   * Accept a bare `export function NAME`. Route handlers come in that form;
   * server actions cannot (a use-server export must be async), so the actions
   * grammar leaves this off and a sync `export function` is then not a match.
   */
  syncFunctions?: boolean;
  /** Keep only the names this accepts. Default: any `\w+`. */
  accept?: (name: string) => boolean;
}

/**
 * Every name an `export` head declares, for the two forms a static coverage
 * gate cares about: the single declarations (`export const NAME`,
 * `export async function NAME`, and — with `syncFunctions` —
 * `export function NAME`) and the brace lists (`export {A, B as C}` /
 * `export const {A, B: C}`, where the exported name is each item's LAST
 * identifier). An `export type { … }` head declares nothing.
 *
 * Hand-parsed from each `export` keyword outward, in linear time — the
 * `\s+`-joined regexes this replaces backtracked polynomially on adversarial
 * whitespace runs (CodeQL js/polynomial-redos), and a completeness gate must
 * stay O(n) on whatever source it is pointed at.
 *
 * Two costs used to repeat per head, which is why the regexes were quadratic in
 * the number of OPENERS rather than in file length: the forward scan for `}`
 * (memoized below — the first `}` at-or-after a position is shared by every head
 * before it), and parsing a giant "list" slice that actually swallows LATER
 * heads. A brace list containing another `export` keyword is not legal JS, so
 * such a head contributes nothing and the later heads parse themselves — real
 * modules are unaffected, and a malformed one can only lose the illegal list,
 * never a real standalone export. That direction is deliberate: a completeness
 * gate that loses a declaration fails CLOSED (more work reported, never less).
 */
export function exportedNamesOf(source: string, grammar: ExportHeadGrammar = {}): string[] {
  const walk: Walk = {
    source,
    names: new Set<string>(),
    scan: { searchedFrom: Number.POSITIVE_INFINITY, close: -2 },
    syncFunctions: grammar.syncFunctions ?? false,
    accept: grammar.accept ?? ((name) => IDENTIFIER.test(name)),
  };
  const heads = [...source.matchAll(/\bexport\b/g)].map((m) => m.index ?? 0);
  heads.forEach((index, k) => {
    collectExport(walk, index + 'export'.length, heads[k + 1] ?? Number.POSITIVE_INFINITY);
  });
  return [...walk.names];
}

/**
 * Exported server-action names in a `"use server"` module. Every runtime
 * export of a use-server module IS a server action. Returns [] for a
 * non-use-server file.
 */
export function exportedActionsOf(source: string): string[] {
  if (!/^[\t ]*["']use server["']/m.test(source)) return [];
  return exportedNamesOf(source);
}

/** One walk's mutable state: what it found, the `}` memo, and the grammar. */
interface Walk {
  source: string;
  names: Set<string>;
  scan: BraceScan;
  syncFunctions: boolean;
  accept: (name: string) => boolean;
}

/** Memo for the forward `}` search that keeps repeated list parsing linear. */
interface BraceScan {
  /** The position the memoized search started from. */
  searchedFrom: number;
  /** First `}` at or after {@link searchedFrom} (-1: none to end of file). */
  close: number;
}

/** First `}` at or after `from`, reusing the previous search when valid. */
function memoClose(source: string, from: number, scan: BraceScan): number {
  // A previous search from an earlier position found its first `}` at
  // `scan.close`; if `from` sits inside that gap, the answer is unchanged.
  if (scan.searchedFrom <= from && (scan.close === -1 || scan.close >= from)) {
    return scan.close;
  }
  scan.searchedFrom = from;
  scan.close = source.indexOf('}', from);
  return scan.close;
}

/** Parse one `export …` head starting just past the keyword. */
function collectExport(walk: Walk, after: number, nextHead: number): void {
  const { source } = walk;
  const i = skipWs(source, after);
  if (i === after) return; // `export` glued to what follows is not the keyword head
  if (source[i] === '{') {
    collectBraceList(walk, i + 1, nextHead);
    return;
  }
  const word = readWord(source, i);
  // `export type { NAME }` is deliberately absent: a type declares no runtime
  // export, so it is neither an action nor a handler.
  if (word === 'const') collectAfterConst(walk, i + word.length, nextHead);
  else if (word === 'async') collectAsyncFunction(walk, i + word.length);
  else if (walk.syncFunctions && word === 'function') addNameAfterWs(walk, i + word.length);
}

/** `export const NAME = …` and `export const { A, B } = …`. */
function collectAfterConst(walk: Walk, after: number, nextHead: number): void {
  const i = skipWs(walk.source, after);
  if (i === after) return;
  if (walk.source[i] === '{') {
    collectBraceList(walk, i + 1, nextHead);
    return;
  }
  addName(walk, readWord(walk.source, i));
}

/** `export async function NAME` — the `function` keyword must actually follow. */
function collectAsyncFunction(walk: Walk, after: number): void {
  const i = skipWs(walk.source, after);
  if (i === after || readWord(walk.source, i) !== 'function') return;
  addNameAfterWs(walk, i + 'function'.length);
}

/** The identifier after at least one space at `from` (`function‸ NAME`). */
function addNameAfterWs(walk: Walk, from: number): void {
  const i = skipWs(walk.source, from);
  if (i === from) return;
  addName(walk, readWord(walk.source, i));
}

/** Record `name` when the grammar accepts it. */
function addName(walk: Walk, name: string): void {
  if (walk.accept(name)) walk.names.add(name);
}

/** `{A, B as C, D: E}` — up to the FIRST `}`, as the regex it replaces did. */
function collectBraceList(walk: Walk, from: number, nextHead: number): void {
  const close = memoClose(walk.source, from, walk.scan);
  if (close === -1) return;
  // A "list" whose close sits past the next `export` keyword swallowed later
  // heads — illegal JS, and parsing it would re-walk their slices. Skip it;
  // the later heads parse themselves.
  if (close > nextHead) return;
  for (const item of walk.source.slice(from, close).split(',')) addName(walk, itemName(item));
}

/**
 * The name an export-list item resolves to: the token after the last
 * whitespace-delimited `as` alias or `:` rename — the `.pop()` of the
 * original split on `\s+as\s+` / `\s*:\s*`, computed with backward scans.
 * An item carrying neither (e.g. `type Foo`) resolves to itself and is then
 * dropped by the grammar's `accept` — the default `^\w+$`, exactly as before.
 */
function itemName(item: string): string {
  const trimmed = item.trim();
  const colonFrom = trimmed.lastIndexOf(':') + 1;
  const from = Math.max(colonFrom, lastAsAliasEnd(trimmed));
  return from === 0 ? trimmed : trimmed.slice(from).trim();
}

/** Index just past the last whitespace-surrounded `as`, or 0 when absent. */
function lastAsAliasEnd(item: string): number {
  for (let i = item.length - 3; i >= 1; i -= 1) {
    const isAlias =
      item[i] === 'a' &&
      item[i + 1] === 's' &&
      isWs(item[i - 1] as string) &&
      isWs(item[i + 2] as string);
    if (isAlias) return i + 2;
  }
  return 0;
}

function skipWs(source: string, from: number): number {
  let to = from;
  while (to < source.length && isWs(source[to] as string)) to += 1;
  return to;
}

/** Longest `\w+` run at `from` — `$` excluded, as in the regexes replaced. */
function readWord(source: string, from: number): string {
  let to = from;
  while (to < source.length && /\w/.test(source[to] as string)) to += 1;
  return source.slice(from, to);
}

function isWs(ch: string): boolean {
  return /\s/.test(ch);
}

/**
 * Match `urlPath` against a set of prefixes on SEGMENT boundaries only:
 * `/api/mcp` covers itself and `/api/mcp/status`, never a sibling
 * `/api/mcp-admin`. Returns the matching prefix, or undefined.
 */
export function segmentPrefixMatch(
  urlPath: string,
  prefixes: readonly string[],
): string | undefined {
  return prefixes.find((prefix) => {
    const base = prefix.replace(/\/$/, '');
    return urlPath === base || urlPath.startsWith(`${base}/`);
  });
}
