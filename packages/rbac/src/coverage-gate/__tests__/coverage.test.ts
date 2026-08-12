// The filesystem IS the subject here: the gate walks a route tree, and a
// mocked fs would test a fixture of the walker instead of the walker.
// Everything written lives in a fresh temp dir per test.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
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

  function run(exclusions: object = { actions: {}, routes: {} }) {
    return runRbacCoverage({
      appDir: join(dir, 'app'),
      webRoot: dir,
      exclusionsPath: writeExclusions(exclusions),
      rbacGuards: GUARDS,
      entitlementGuards: ['requireEntitlement'],
    });
  }

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
