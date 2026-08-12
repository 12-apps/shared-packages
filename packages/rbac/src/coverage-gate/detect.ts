/**
 * Guard detection for the RBAC coverage gate (12-13) — ported from
 * future-pay's `scripts/rbac/detect.ts`, with the guard identifier lists
 * turned into ARGUMENTS (the host's guards are host vocabulary; the
 * future-pay lists ship as defaults in `index.ts`).
 *
 * A route/action file counts as protected if its (comment/string-stripped)
 * source CALLS one of the accepted RBAC guards. The entitlement guards are
 * recognized SEPARATELY and never substitute for RBAC — they are the 402
 * "plan" axis, and the gate enforces the sequencing invariant that an
 * entitlement guard only ever runs AFTER an RBAC guard.
 */

/** Require a CALL context (`name(`) — not a bare mention. `\s*` spans newlines. */
function callRegex(guards: readonly string[]): RegExp {
  return new RegExp(`\\b(?:${guards.join('|')})\\s*\\(`);
}

/**
 * Blank out line comments, block comments and string literals (replaced with
 * spaces, newlines preserved) so no detection is ever fooled by a guard name
 * in prose or a string. Single-pass alternation, so a `//` INSIDE a string is
 * consumed as string content and never mistaken for a comment.
 */
export function stripCommentsAndStrings(source: string): string {
  const token =
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g;
  return source.replace(token, (match) => match.replace(/[^\n]/g, ' '));
}

/** Whether the file's source actually CALLS an accepted RBAC guard. */
export function isRbacProtected(source: string, guards: readonly string[]): boolean {
  return callRegex(guards).test(stripCommentsAndStrings(source));
}

/** Whether the source CALLS a throwing entitlement guard (sequencing only). */
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

/** `$` is the only identifier char that is also a regex metachar — escape it. */
function escapeIdent(name: string): string {
  return name.replace(/[$]/g, '\\$&');
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
