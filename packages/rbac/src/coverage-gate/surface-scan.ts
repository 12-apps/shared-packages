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

/**
 * Exported server-action names in a `"use server"` module. Every runtime
 * export of a use-server module IS a server action. Returns [] for a
 * non-use-server file.
 *
 * Hand-parsed from each `export` keyword outward, in linear time — the
 * `\s+`-joined regexes this replaces backtracked polynomially on adversarial
 * whitespace runs (CodeQL js/polynomial-redos), and a completeness gate must
 * stay O(n) on whatever source it is pointed at. The grammar is unchanged:
 * `export async function NAME`, `export const NAME`, and the brace lists
 * `export {A, B as C}` / `export const {A, B: C}` (a bare `export function`
 * cannot appear in a use-server module — actions must be async).
 */
export function exportedActionsOf(source: string): string[] {
  if (!/^[\t ]*["']use server["']/m.test(source)) return [];
  const names = new Set<string>();
  // Linearity guards (CodeQL js/polynomial-redos, second round). Two costs
  // used to repeat per head: the forward scan for `}` (memoized below — the
  // first `}` at-or-after a position is shared by every head before it), and
  // parsing a giant "list" slice that actually swallows LATER heads. A brace
  // list containing another `export` keyword is not legal JS, so such a head
  // contributes nothing and the later heads parse themselves — real modules
  // are unaffected, and a malformed one can only lose the illegal list, never
  // a real standalone export (the gate stays fail-closed).
  const heads = [...source.matchAll(/\bexport\b/g)].map((m) => m.index ?? 0);
  const scan: BraceScan = { searchedFrom: Number.POSITIVE_INFINITY, close: -2 };
  heads.forEach((index, k) => {
    const nextHead = heads[k + 1] ?? Number.POSITIVE_INFINITY;
    collectExport(source, index + 'export'.length, names, scan, nextHead);
  });
  return [...names];
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
function collectExport(
  source: string,
  after: number,
  names: Set<string>,
  scan: BraceScan,
  nextHead: number,
): void {
  const i = skipWs(source, after);
  if (i === after) return; // `export` glued to what follows is not the keyword head
  if (source[i] === '{') {
    collectBraceList(source, i + 1, names, scan, nextHead);
    return;
  }
  const word = readWord(source, i);
  if (word === 'const') collectAfterConst(source, i + word.length, names, scan, nextHead);
  if (word === 'async') collectAsyncFunction(source, i + word.length, names);
}

function collectAfterConst(
  source: string,
  after: number,
  names: Set<string>,
  scan: BraceScan,
  nextHead: number,
): void {
  const i = skipWs(source, after);
  if (i === after) return;
  if (source[i] === '{') {
    collectBraceList(source, i + 1, names, scan, nextHead);
    return;
  }
  const name = readWord(source, i);
  if (name !== '') names.add(name);
}

function collectAsyncFunction(source: string, after: number, names: Set<string>): void {
  const i = skipWs(source, after);
  if (i === after || readWord(source, i) !== 'function') return;
  const j = skipWs(source, i + 'function'.length);
  if (j === i + 'function'.length) return;
  const name = readWord(source, j);
  if (name !== '') names.add(name);
}

/** `{A, B as C, D: E}` — up to the FIRST `}`, as the regex it replaces did. */
function collectBraceList(
  source: string,
  from: number,
  names: Set<string>,
  scan: BraceScan,
  nextHead: number,
): void {
  const close = memoClose(source, from, scan);
  if (close === -1) return;
  // A "list" whose close sits past the next `export` keyword swallowed later
  // heads — illegal JS, and parsing it would re-walk their slices. Skip it;
  // the later heads parse themselves.
  if (close > nextHead) return;
  for (const item of source.slice(from, close).split(',')) {
    const name = itemName(item);
    if (/^\w+$/.test(name)) names.add(name);
  }
}

/**
 * The name an export-list item resolves to: the token after the last
 * whitespace-delimited `as` alias or `:` rename — the `.pop()` of the
 * original split on `\s+as\s+` / `\s*:\s*`, computed with backward scans.
 * An item carrying neither (e.g. `type Foo`) resolves to itself and is then
 * dropped by the caller's `^\w+$` filter, exactly as before.
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
