/* eslint-disable test-flakiness/no-unmocked-fs -- the filesystem IS the
   subject: the gate walks a route tree, and a mocked fs would test a fixture
   of the walker instead of the walker. Everything written lives in a fresh
   temp dir per test. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  exportedActionsOf,
  exportedNamesOf,
  guardedSymbols,
  isRbacProtected,
  runRbacCoverage,
} from '../index';

/**
 * The rbac:coverage gate (12-13) — ported behaviors from future-pay's
 * `scripts/rbac/coverage.ts` + `detect.ts`: guard detection over stripped
 * source, per-symbol attribution (the piggyback defense), exclusion matching
 * on segment boundaries, stale-exclusion pruning and the entitlement
 * sequencing invariant.
 */

const GUARDS = ['requirePermission', 'requireTenantAdminBySlug'];

describe('guard detection', () => {
  it('requires a CALL, not a mention in a comment or string', () => {
    expect(isRbacProtected('await requirePermission("x", {});', GUARDS)).toBe(true);
    expect(isRbacProtected('// requirePermission("x")', GUARDS)).toBe(false);
    expect(isRbacProtected('const s = "requirePermission(";', GUARDS)).toBe(false);
    expect(isRbacProtected('import { requirePermission } from "x";', GUARDS)).toBe(false);
  });

  it('accepts NOTHING when the guard list is empty (never an empty alternation)', () => {
    // `new RegExp('\\b(?:)\\s*\\(')` matches ANY `identifier(`, so an empty
    // list used to make every file read as guarded — the whole gate green over
    // a surface with zero coverage. Both entry points must answer "unguarded".
    expect(isRbacProtected('await requirePermission("x", {});', [])).toBe(false);
    expect(isRbacProtected('export const GET = () => fetchThing();', [])).toBe(false);
    expect(guardedSymbols('export async function a() { anything(); }', []).size).toBe(0);
  });

  it('attributes guards per exported symbol, transitively', () => {
    const source = [
      '"use server";',
      'async function authorize() { await requirePermission("x", {}); }',
      'export async function guardedAction() { await authorize(); }',
      'export async function nakedAction() { return 1; }',
    ].join('\n');
    const guarded = guardedSymbols(source, GUARDS);
    expect(guarded.has('guardedAction')).toBe(true);
    expect(guarded.has('nakedAction')).toBe(false);
  });
});

describe('adversarial input stays linear (CodeQL js/polynomial-redos)', () => {
  // The pathological family for the replaced regexes is MANY UNCLOSED OPENERS,
  // not one long run: each opener restarts a match attempt that scans to EOF,
  // so the old code was quadratic in the opener count (measured ~4x per input
  // doubling). At the sizes below the old implementations blow far past the
  // suite's per-test timeout, which IS the time bound; the linear walkers
  // finish in milliseconds.
  it('strips an unterminated escape-run string linearly, failing closed', () => {
    const openerStorm = `'${'\\a'.repeat(40)}`.repeat(12_001); // odd count: last string never closes
    const source = `requirePermission("x", {}); ${openerStorm}`;
    // A guard call BEFORE the malformed literal is still seen…
    expect(isRbacProtected(source, GUARDS)).toBe(true);
    // …and one swallowed BY it reads as unguarded — the unterminated string
    // blanks to end-of-file on purpose, so malformed source can only ever
    // under-claim protection, never over-claim it.
    const swallowed = `${openerStorm}; requirePermission("x", {});`;
    expect(isRbacProtected(swallowed, GUARDS)).toBe(false);
  });

  it('strips an unterminated block comment linearly, failing closed', () => {
    const source = `${`/*${'x'.repeat(40)}`.repeat(24_000)} requirePermission("x", {})`;
    expect(isRbacProtected(source, GUARDS)).toBe(false);
  });

  it('scans export heads over adversarial brace and whitespace runs linearly', () => {
    const braceNoise = `export {{${'export {{|'.repeat(20_000)}`;
    const spacedNoise = `export${' '.repeat(50_000)}notAnActionKeyword`;
    const source = [
      '"use server";',
      braceNoise,
      spacedNoise,
      'export async function realAction() {}',
    ].join('\n');
    expect(exportedActionsOf(source)).toEqual(['realAction']);
  });
});

describe('exportedNamesOf grammar', () => {
  // The walk is SHARED with `@12-apps/mcp`'s route-method gate (12-23), which was
  // a copy of it until the copy drifted into a second ReDoS fix. Only the grammar
  // differs, so only the grammar is a parameter — and these are the two knobs.
  it('takes a sync `export function` only when the grammar allows it', () => {
    const source = 'export function GET() {}';
    // A server action must be async, so the default grammar sees nothing here…
    expect(exportedNamesOf(source)).toEqual([]);
    // …while a route handler may be sync.
    expect(exportedNamesOf(source, { syncFunctions: true })).toEqual(['GET']);
    // `async function` is taken either way, and still requires the keyword.
    expect(exportedNamesOf('export async function POST() {}')).toEqual(['POST']);
    expect(exportedNamesOf('export async notFunction() {}')).toEqual([]);
  });

  it('reads a list whose COMMENT mentions export, in BOTH grammars', () => {
    // The linearity skip asks whether another `export` keyword sits inside the list,
    // so a comment saying so used to make the walk drop the whole list. Legal JS,
    // and for the route-method gate the loss direction is fail-OPEN. Comments and
    // strings are blanked before the walk, so both grammars see the real names.
    const withComment = "'use server';\nexport { // export the two below\n  a, b };";
    expect(exportedActionsOf(withComment).sort()).toEqual(['a', 'b']);
    expect(exportedNamesOf('export { /* export */ GET, POST };').sort()).toEqual(['GET', 'POST']);
    // And the converse: a name only ever mentioned inside a comment or a string is
    // not an export, which the raw-source walk used to claim it was.
    expect(exportedNamesOf('/* export { GET } */ export const POST = h;')).toEqual(['POST']);
    expect(exportedNamesOf('const sql = "export { GET }";')).toEqual([]);
    // A use-server module still needs its directive on the RAW source: the strip
    // blanks string literals, so the check has to run before it (and does).
    expect(exportedActionsOf("'use server';\nexport const a = 1;")).toEqual(['a']);
  });

  it('filters every discovered name through `accept`, whichever form found it', () => {
    const onlyUpper = { accept: (name: string) => /^[A-Z]+$/.test(name) };
    const source = [
      'export const GET = h;',
      'export const lower = h;',
      'export const { POST, alsoLower } = h;',
      'export { h as DELETE, h as nope };',
      'export async function PUT() {}',
    ].join('\n');
    expect(exportedNamesOf(source, { ...onlyUpper, syncFunctions: true }).sort()).toEqual([
      'DELETE',
      'GET',
      'POST',
      'PUT',
    ]);
    // Default `accept` is any `\w+`, so the same source yields the lot — every
    // form the walk understands, sync `export function` excepted.
    expect(exportedNamesOf(source).sort()).toEqual([
      'DELETE',
      'GET',
      'POST',
      'PUT',
      'alsoLower',
      'lower',
      'nope',
    ]);
  });
});

describe('runRbacCoverage', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rbac-cov-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeRoute(path: string, source: string): void {
    const full = join(dir, 'app', path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, source);
  }

  function writeExclusions(exclusions: object): string {
    const path = join(dir, 'exclusions.json');
    writeFileSync(path, JSON.stringify(exclusions));
    return path;
  }

  function run(
    exclusions: object = { actions: {}, routes: {} },
    rbacGuards: readonly string[] = GUARDS,
  ) {
    return runRbacCoverage({
      appDir: join(dir, 'app'),
      webRoot: dir,
      exclusionsPath: writeExclusions(exclusions),
      rbacGuards,
      entitlementGuards: ['requireEntitlement'],
    });
  }

  it('refuses an empty rbacGuards rather than passing over an unguarded surface', () => {
    writeRoute('api/naked/route.ts', 'export const GET = () => 1;');
    // The blocker this replaces: `[]` compiled to an empty alternation, every
    // route file read as protected, and the CLI exited 0 with no coverage at
    // all — as a PRE-PUSH gate in the adopting host.
    expect(() => run({ actions: {}, routes: {} }, [])).toThrow(/rbacGuards/);
  });

  it('reports an unguarded route as unprotected under the never-matching regex', () => {
    // The regex backstop, reached past the option assertion: even if a future
    // caller bypasses `runRbacCoverage`, detection with no accepted guard says
    // "unguarded" rather than "guarded".
    writeRoute('api/naked/route.ts', 'export const GET = () => 1;');
    const source = 'export const GET = () => 1;';
    expect(isRbacProtected(source, [])).toBe(false);
    const { failures } = run();
    expect(failures.some((failure) => failure.includes('unprotected route'))).toBe(true);
  });

  it('passes a guarded route and fails an unguarded one', () => {
    writeRoute('api/safe/route.ts', 'export const GET = () => requirePermission("x", {});');
    writeRoute('api/naked/route.ts', 'export const GET = () => 1;');
    const { failures } = run();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('/api/naked');
  });

  it('honors route exclusions on segment boundaries only', () => {
    writeRoute('api/public/route.ts', 'export const GET = () => 1;');
    writeRoute('api/public-admin/route.ts', 'export const GET = () => 1;');
    const { failures } = run({ actions: {}, routes: { '/api/public': 'storefront' } });
    // The sibling does NOT inherit the prefix.
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('/api/public-admin');
  });

  it('flags a stale exclusion', () => {
    writeRoute('api/safe/route.ts', 'export const GET = () => requirePermission("x", {});');
    const { failures } = run({ actions: {}, routes: { '/api/gone': 'removed' } });
    expect(failures.some((failure) => failure.includes('stale route exclusion'))).toBe(true);
  });

  it('fails an entitlement guard without an RBAC guard, even when excluded', () => {
    writeRoute('api/public/route.ts', 'export const GET = () => requireEntitlement("t", "f");');
    const { failures } = run({ actions: {}, routes: { '/api/public': 'storefront' } });
    expect(failures.some((failure) => failure.includes('entitlement guard without'))).toBe(true);
  });

  it('judges each server action on its own body', () => {
    writeRoute(
      'admin/team-actions.ts',
      [
        '"use server";',
        'export async function safeAction() { await requirePermission("x", {}); }',
        'export async function nakedAction() { return 1; }',
      ].join('\n'),
    );
    const { failures } = run();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('nakedAction');
  });
});
