import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ROLE_TEMPLATES,
  FUTURE_PAY_PERMISSIONS,
  FUTURE_PAY_SOD_PAIRS,
} from '../templates';
import { futurePayTenantRoleSeeds } from '../tenant-role-seeds';

/**
 * FUT-354 — the template half of the staff access foundations for Cozinha.
 *
 * The role matrix is a CONTRACT, not an implementation detail: the seed, the
 * backfill migration and the runtime engine all derive from it, so a grant
 * silently added or dropped here changes who can open a screen on every
 * existing store. These assertions state the matrix in full for the roles the
 * kitchen involves.
 */

function rolePermissions(name: string): readonly string[] | '*' {
  const role = DEFAULT_ROLE_TEMPLATES.find((candidate) => candidate.name === name);
  if (!role) throw new Error(`Missing role ${name}`);
  if (role.permissions === '*') return '*';
  return role.permissions.map((entry) =>
    typeof entry === 'string' ? entry : entry.permission,
  );
}

describe('staff-safe config read', () => {
  it('is a CLASS permission — there is no instance of a feature switch', () => {
    expect(FUTURE_PAY_PERMISSIONS.kind('config:read:operational')).toBe('class');
    expect(FUTURE_PAY_PERMISSIONS.list).toContain('config:read:operational');
  });

  it('is granted to every role that has to gate a service screen on it', () => {
    for (const role of ['MANAGER', 'WAITER', 'CHEF']) {
      expect(rolePermissions(role)).toContain('config:read:operational');
    }
    expect(rolePermissions('OWNER')).toBe('*');
  });

  /**
   * A SEPARATE key, not a widening of `config:read`. ADMIN keeps the wide read
   * and does NOT collect the narrow one: read surfaces accept either as a tier,
   * so a second grant would only make the catalog say the same thing twice.
   */
  it('leaves the ADMIN read alone, and grants nobody the wide read by accident', () => {
    expect(rolePermissions('ADMIN')).toContain('config:read');
    expect(rolePermissions('ADMIN')).not.toContain('config:read:operational');
    for (const role of ['MANAGER', 'WAITER', 'CHEF', 'FINANCIAL', 'BUYER']) {
      expect(rolePermissions(role)).not.toContain('config:read');
    }
  });

  it('is not granted to roles with no service screen to gate', () => {
    for (const role of ['FINANCIAL', 'BUYER']) {
      expect(rolePermissions(role)).not.toContain('config:read:operational');
    }
  });
});

describe('kitchen role matrix', () => {
  it('CHEF reads its own stations and never the tenant', () => {
    expect(rolePermissions('CHEF')).toContain('kitchen:read:station');
    expect(rolePermissions('CHEF')).not.toContain('kitchen:read:all');
    expect(FUTURE_PAY_PERMISSIONS.kind('kitchen:read:station')).toBe('instance');
    expect(FUTURE_PAY_PERMISSIONS.kind('kitchen:read:all')).toBe('class');
  });

  /**
   * A line stuck on an absent cook is the manager's to move. WHICH line — the
   * open-shift/station ownership rule — is enforced transactionally with the
   * mutation in FUT-447; this grant only puts the manager in scope.
   */
  it('MANAGER reads the whole kitchen and may unblock work', () => {
    expect(rolePermissions('MANAGER')).toEqual(
      expect.arrayContaining(['kitchen:read:all', 'kitchen:update']),
    );
  });

  /**
   * A garçom is assigned to a MESA, not to a ticket — so their reach into the
   * kitchen derives from `tables:read:assigned` and no kitchen key is minted.
   * Deliberate: a new key would need an SoD review it does not deserve.
   */
  it('WAITER derives its reach from mesas — no kitchen key at all', () => {
    const waiter = rolePermissions('WAITER');
    expect(waiter).toContain('tables:read:assigned');
    expect(waiter).not.toContain('kitchen:read:all');
    expect(waiter).not.toContain('kitchen:read:station');
    expect(waiter).not.toContain('kitchen:update');
  });

  it('adds no separation-of-duties pair — none of these is an approval gate', () => {
    const involved = FUTURE_PAY_SOD_PAIRS.flatMap((pair) => [...pair]);
    expect(involved).not.toContain('config:read:operational');
    expect(involved).not.toContain('kitchen:update');
  });
});

describe('tenant role seeds carry the new grants', () => {
  it('projects the template matrix into the rows every new tenant gets', () => {
    const seeds = new Map(futurePayTenantRoleSeeds().map((seed) => [seed.name, seed.permissions]));
    for (const role of ['MANAGER', 'WAITER', 'CHEF']) {
      expect(JSON.parse(seeds.get(role) as string)).toContain('config:read:operational');
    }
    expect(JSON.parse(seeds.get('MANAGER') as string)).toContain('kitchen:update');
    // Owner stays the wildcard; the seed must not enumerate it.
    expect(seeds.get('OWNER')).toBe('*');
  });
});
