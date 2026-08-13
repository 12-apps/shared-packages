/**
 * Guard detection for the RBAC coverage gate (12-13) — ported from
 * future-pay's `scripts/rbac/detect.ts`, with the guard identifier lists
 * turned into REQUIRED arguments. The host's guards are host vocabulary, so
 * there is no generic list to default to — a completeness gate cannot supply
 * its own subject. Defaulting them was the bug: a second host inherited
 * seventeen names it did not use, so every route it protected read the same
 * as every route it forgot.
 *
 * A route/action file counts as protected if its (comment/string-stripped)
 * source CALLS one of the accepted RBAC guards. The entitlement guards are
 * recognized SEPARATELY and never substitute for RBAC — they are the 402
 * "plan" axis, and the gate enforces the sequencing invariant that an
 * entitlement guard only ever runs AFTER an RBAC guard.
 */

/**
 * Require a CALL context (`name(`) — not a bare mention. `\s*` spans newlines.
 *
 * An EMPTY list compiles to `/\b(?:)\s*\(/` — an empty alternation, which
 * matches ANY `identifier(` — so every file would read as guarded and the gate
 * would report zero failures over a surface with zero coverage. `/(?!)/` is the
 * never-matching regex: with no accepted guard, nothing is guarded. That is the
 * fail-CLOSED direction, and it is a backstop rather than the contract —
 * {@link assertGuardsConfigured} refuses the empty list outright, because it is
 * always a configuration mistake rather than a host with no guards.
 */
function callRegex(guards: readonly string[]): RegExp {
  if (guards.length === 0) return /(?!)/;
  return new RegExp(`\\b(?:${guards.join('|')})\\s*\\(`);
}

/**
 * Refuse an empty `rbacGuards` before any file is read. Reached from
 * `runRbacCoverage`, and stated here so every entry point into detection shares
 * one message naming the option.
 */
export function assertGuardsConfigured(guards: readonly string[]): void {
  if (guards.length > 0) return;
  throw new Error(
    '[rbac:coverage] `rbacGuards` is empty — the gate greps your source for YOUR guard ' +
      'helpers, so an empty list accepts nothing and every route file would have to be ' +
      'excluded by hand. Name the identifiers this host accepts as an RBAC gate ' +
      '(e.g. rbacGuards: [\'requirePermission\']). There is no host with no guards: a ' +
      'surface with nothing to enforce has nothing for this gate to check.',
  );
}

/**
 * Blank out line comments, block comments and string literals (replaced with
 * spaces, newlines preserved) so no detection is ever fooled by a guard name
 * in prose or a string. A single linear character walk — the regex
 * alternation it replaces backtracked polynomially on adversarial input
 * (CodeQL js/polynomial-redos) — and a `//` INSIDE a string is still consumed
 * as string content because the walk enters the string first. An unterminated
 * comment or string blanks to end-of-file, which fails CLOSED: a guard call
 * swallowed by malformed source reads as unguarded, never as guarded.
 */
export function stripCommentsAndStrings(source: string): string {
  const out = source.split('');
  let i = 0;
  while (i < source.length) {
    const end = tokenEndAt(source, i);
    if (end > i) blankRange(source, out, i, end);
    i = end > i ? end : i + 1;
  }
  return out.join('');
}

/** End (exclusive) of the comment/string starting at `i`, or `i` when none. */
function tokenEndAt(source: string, i: number): number {
  const ch = source[i];
  if (ch === '/' && source[i + 1] === '/') return lineCommentEnd(source, i + 2);
  if (ch === '/' && source[i + 1] === '*') return blockCommentEnd(source, i + 2);
  if (ch === "'" || ch === '"' || ch === '`') return stringEnd(source, i + 1, ch);
  return i;
}

function lineCommentEnd(source: string, from: number): number {
  const newline = source.indexOf('\n', from);
  return newline === -1 ? source.length : newline;
}

function blockCommentEnd(source: string, from: number): number {
  const close = source.indexOf('*/', from);
  return close === -1 ? source.length : close + 2;
}

/** Past the closing quote, honoring backslash escapes; EOF when unterminated. */
function stringEnd(source: string, from: number, quote: string): number {
  let i = from;
  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2;
    } else if (source[i] === quote) {
      return i + 1;
    } else {
      i += 1;
    }
  }
  return source.length;
}

/** Replace [from, to) with spaces in `out`, keeping newlines for line math. */
function blankRange(source: string, out: string[], from: number, to: number): void {
  for (let j = from; j < to; j += 1) {
    if (source[j] !== '\n') out[j] = ' ';
  }
}

/** Whether the file's source actually CALLS an accepted RBAC guard. */
export function isRbacProtected(source: string, guards: readonly string[]): boolean {
  return callRegex(guards).test(stripCommentsAndStrings(source));
}

/**
 * Whether the source CALLS a throwing entitlement guard (sequencing only).
 *
 * `[]` is a legitimate value here — a host with no billing tier — and the
 * early return is only a fast path; `callRegex([])` already answers `false`
 * for every source.
 */
export function callsEntitlementGuard(
  source: string,
  entitlementGuards: readonly string[],
): boolean {
  if (entitlementGuards.length === 0) return false;
  return callRegex(entitlementGuards).test(stripCommentsAndStrings(source));
}

// ── Per-symbol guard attribution (piggyback defense) ─────────────────────────
// File-level detection answers "does this FILE guard at all", which is right
// for a route file (one URL surface). But a `*actions.ts` file exports MANY
// server actions, and a new UNGUARDED action added to an already-guarded file
// would inherit the file's verdict. So for actions, guards are attributed to
// the SPECIFIC exported symbol via a transitive closure over the module's
// top-level declarations.

interface TopLevelSymbol {
  name: string;
  body: string;
}

// A top-level declaration starts at column 0 (Prettier-formatted; nested
// declarations are indented and so never match `^`).
const TOP_LEVEL_DECL =
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;

function topLevelSymbols(source: string): TopLevelSymbol[] {
  const marks: { name: string; index: number }[] = [];
  for (const match of source.matchAll(TOP_LEVEL_DECL)) {
    marks.push({ name: match[1] as string, index: match.index ?? 0 });
  }
  return marks.map((mark, i) => ({
    name: mark.name,
    body: source.slice(mark.index, marks[i + 1]?.index ?? source.length),
  }));
}

/**
 * Escape a name for literal use inside a regex. `$` is the only metachar a
 * JS identifier can carry, but the class is the COMPLETE metachar set — the
 * backslash included, in one pass so nothing double-escapes — because CodeQL
 * js/incomplete-sanitization rightly rejects the `$`-only version.
 */
function escapeIdent(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function referencesName(body: string, name: string): boolean {
  return new RegExp(`(?<![\\w$])${escapeIdent(name)}(?![\\w$])`).test(body);
}

/** One propagation pass toward the fixpoint; returns whether anything changed. */
function propagateGuarding(
  symbols: readonly TopLevelSymbol[],
  guarding: Set<string>,
): boolean {
  let changed = false;
  for (const symbol of symbols) {
    if (guarding.has(symbol.name)) continue;
    const reaches = [...guarding].some(
      (name) => name !== symbol.name && referencesName(symbol.body, name),
    );
    if (reaches) {
      guarding.add(symbol.name);
      changed = true;
    }
  }
  return changed;
}

function symbolsReaching(source: string, seed: RegExp): Set<string> {
  const symbols = topLevelSymbols(stripCommentsAndStrings(source));
  const guarding = new Set(
    symbols.filter((symbol) => seed.test(symbol.body)).map((s) => s.name),
  );
  while (propagateGuarding(symbols, guarding)) {
    // iterate to fixpoint
  }
  return guarding;
}

/**
 * The top-level symbol names that transitively reach an RBAC guard — either
 * by calling one directly or by delegating to another reaching symbol.
 */
export function guardedSymbols(source: string, guards: readonly string[]): Set<string> {
  return symbolsReaching(source, callRegex(guards));
}

/** The per-symbol counterpart of {@link callsEntitlementGuard}. */
export function entitlementGuardedSymbols(
  source: string,
  entitlementGuards: readonly string[],
): Set<string> {
  if (entitlementGuards.length === 0) return new Set();
  return symbolsReaching(source, callRegex(entitlementGuards));
}

/** Whether a specific exported action transitively reaches a guard. */
export function isActionProtected(
  source: string,
  action: string,
  guards: readonly string[],
): boolean {
  return guardedSymbols(source, guards).has(action);
}
