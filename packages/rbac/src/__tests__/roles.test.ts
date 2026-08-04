import { describe, it, expect } from 'vitest';
import {
  expandRole,
  buildRoleIndex,
  caveatsPass,
  WILDCARD,
  type CaveatEntry,
} from '../core/roles';
import type { RoleDef } from '../core/types';

const index = (roles: RoleDef[]) =>
  new Map(roles.map((r) => [r.name, r]));

/** Sorted permission keys of an expanded (non-wildcard) role. */
const keys = (expanded: unknown) =>
  [...(expanded as Map<string, CaveatEntry[]>).keys()].sort();

describe('expandRole', () => {
  it('unions a role permissions with an inherited role', () => {
    const roles: RoleDef[] = [
      { name: 'BASE', permissions: ['a', 'b'] },
      { name: 'EXT', permissions: ['c'], inherits: ['BASE'] },
    ];
    const expanded = expandRole(roles[1]!, index(roles));
    expect(expanded).not.toBe(WILDCARD);
    expect(keys(expanded)).toEqual(['a', 'b', 'c']);
  });

  it('resolves multi-level inheritance', () => {
    const roles: RoleDef[] = [
      { name: 'L1', permissions: ['a'] },
      { name: 'L2', permissions: ['b'], inherits: ['L1'] },
      { name: 'L3', permissions: ['c'], inherits: ['L2'] },
    ];
    expect(keys(expandRole(roles[2]!, index(roles)))).toEqual(['a', 'b', 'c']);
  });

  it('guards against inheritance cycles without infinite looping', () => {
    const roles: RoleDef[] = [
      { name: 'X', permissions: ['x'], inherits: ['Y'] },
      { name: 'Y', permissions: ['y'], inherits: ['X'] },
    ];
    expect(keys(expandRole(roles[0]!, index(roles)))).toEqual(['x', 'y']);
  });

  it('short-circuits to WILDCARD when the role itself is *', () => {
    const roles: RoleDef[] = [{ name: 'ALL', permissions: '*' }];
    expect(expandRole(roles[0]!, index(roles))).toBe(WILDCARD);
  });

  it('short-circuits to WILDCARD when an inherited role is *', () => {
    const roles: RoleDef[] = [
      { name: 'ALL', permissions: '*' },
      { name: 'SUB', permissions: ['a'], inherits: ['ALL'] },
    ];
    expect(expandRole(roles[1]!, index(roles))).toBe(WILDCARD);
  });

  it('ignores unknown inherited role names', () => {
    const roles: RoleDef[] = [
      { name: 'R', permissions: ['a'], inherits: ['MISSING'] },
    ];
    expect(keys(expandRole(roles[0]!, index(roles)))).toEqual(['a']);
  });

  it('records a caveat entry for a { permission, caveat } grant', () => {
    const caveat = (c: Record<string, unknown>) => c.ok === true;
    const roles: RoleDef[] = [
      { name: 'C', permissions: [{ permission: 'a', caveat }] },
    ];
    const expanded = expandRole(roles[0]!, index(roles)) as Map<
      string,
      CaveatEntry[]
    >;
    const entries = expanded.get('a')!;
    expect(entries).toHaveLength(1);
    expect(caveatsPass(entries, { ok: true })).toBe(true);
    expect(caveatsPass(entries, { ok: false })).toBe(false);
  });

  it('a bare grant records an unconditional (null) entry', () => {
    const roles: RoleDef[] = [{ name: 'B', permissions: ['a'] }];
    const expanded = expandRole(roles[0]!, index(roles)) as Map<
      string,
      CaveatEntry[]
    >;
    expect(expanded.get('a')).toEqual([null]);
    expect(caveatsPass(expanded.get('a')!, {})).toBe(true);
  });
});

describe('caveatsPass', () => {
  it('an unconditional entry always passes', () => {
    expect(caveatsPass([null], {})).toBe(true);
  });
  it('ORs multiple entries', () => {
    const c1: CaveatEntry = (ctx) => ctx.a === 1;
    const c2: CaveatEntry = (ctx) => ctx.b === 2;
    expect(caveatsPass([c1, c2], { b: 2 })).toBe(true);
    expect(caveatsPass([c1, c2], { c: 3 })).toBe(false);
  });
});

describe('buildRoleIndex', () => {
  it('indexes every role by name with its expanded map', () => {
    const roles: RoleDef[] = [
      { name: 'BASE', permissions: ['a'] },
      { name: 'EXT', permissions: ['b'], inherits: ['BASE'] },
      { name: 'ALL', permissions: '*' },
    ];
    const idx = buildRoleIndex(roles);
    expect(idx.get('ALL')).toBe(WILDCARD);
    expect(keys(idx.get('EXT'))).toEqual(['a', 'b']);
  });
});
