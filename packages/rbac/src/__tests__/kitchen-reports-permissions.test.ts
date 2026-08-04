import { describe, expect, it } from 'vitest';

import { futurePayTenantRoleSeeds } from '../tenant-role-seeds';
import {
  DEFAULT_ROLE_TEMPLATES,
  FUTURE_PAY_PERMISSIONS,
  FUTURE_PAY_GOVERNANCE,
  FUTURE_PAY_SOD_PAIRS,
} from '../templates';

/**
 * `reports:kitchen:read` (FUT-454) — who may open Cozinha › Análise.
 *
 * The NEGATIVE half is the whole point: the reports rank cooks by how long
 * their lines take, so the cook cannot be one of the readers. CHEF holds
 * `kitchen:read:station` and works the board all day; it must NOT pick up the
 * analytics tier as a side effect of that.
 */
const PERMISSION = 'reports:kitchen:read';

function rolePermissions(name: string): readonly string[] | '*' {
  const role = DEFAULT_ROLE_TEMPLATES.find((candidate) => candidate.name === name);
  if (!role) throw new Error(`Missing role ${name}`);
  if (role.permissions === '*') return '*';
  return role.permissions.map((entry) =>
    typeof entry === 'string' ? entry : entry.permission,
  );
}

describe('kitchen report permissions', () => {
  it('registers the read tier as class scoped', () => {
    // Class-kind, so a custom supervisor role may hold it at an org/parent
    // scope; an `instance` kind could not.
    expect(FUTURE_PAY_PERMISSIONS.kind(PERMISSION)).toBe('class');
    expect(FUTURE_PAY_PERMISSIONS.list).toContain(PERMISSION);
  });

  it('grants it to the roles that run and administer the store', () => {
    // OWNER holds everything by wildcard, so it needs no explicit entry.
    expect(rolePermissions('OWNER')).toBe('*');
    expect(rolePermissions('MANAGER')).toContain(PERMISSION);
    expect(rolePermissions('ADMIN')).toContain(PERMISSION);
  });

  it('withholds it from the roles that appear IN the report', () => {
    expect(rolePermissions('CHEF')).not.toContain(PERMISSION);
    expect(rolePermissions('WAITER')).not.toContain(PERMISSION);
    // …and the cook keeps the board reads the analytics tier is separate from.
    expect(rolePermissions('CHEF')).toContain('kitchen:read:station');
  });

  it('is not an owner marker, so a supervisor role can be composed with it', () => {
    // An owner-marker permission is un-composable into a custom role, which
    // would break "MANAGER, OWNER plus explicitly granted supervisor roles".
    expect(FUTURE_PAY_GOVERNANCE.ownerPermissions).not.toContain(PERMISSION);
  });

  it('takes no SoD pair — a read has no approval counterpart', () => {
    for (const pair of FUTURE_PAY_SOD_PAIRS) {
      expect(pair).not.toContain(PERMISSION);
    }
  });

  it('reaches a NEW tenant through the role seeds', () => {
    const manager = futurePayTenantRoleSeeds().find((role) => role.name === 'MANAGER');
    expect(manager?.permissions).toContain(PERMISSION);
  });
});
