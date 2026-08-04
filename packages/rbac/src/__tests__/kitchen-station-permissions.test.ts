import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ROLE_TEMPLATES,
  FUTURE_PAY_PERMISSIONS,
  FUTURE_PAY_SOD_PAIRS,
} from '../templates';

/**
 * `kitchen-stations:manage` (FUT-448) — who may configure the places dishes are
 * prepared. The NEGATIVE half is the point: station config decides where every
 * new order is routed, so the roles that WORK the kitchen must not also be able
 * to reshape it.
 */
function rolePermissions(name: string): readonly string[] | '*' {
  const role = DEFAULT_ROLE_TEMPLATES.find((candidate) => candidate.name === name);
  if (!role) throw new Error(`Missing role ${name}`);
  if (role.permissions === '*') return '*';
  return role.permissions.map((entry) =>
    typeof entry === 'string' ? entry : entry.permission,
  );
}

describe('kitchen-station permissions', () => {
  it('registers the write gate as class scoped, beside the existing decider', () => {
    expect(FUTURE_PAY_PERMISSIONS.kind('kitchen-stations:manage')).toBe('class');
    expect(FUTURE_PAY_PERMISSIONS.kind('kitchen-stations:approve')).toBe('class');
  });

  it('grants station config to the roles that run the store', () => {
    // OWNER holds everything by wildcard, so it needs no explicit entry.
    expect(rolePermissions('OWNER')).toBe('*');
    expect(rolePermissions('MANAGER')).toContain('kitchen-stations:manage');
    expect(rolePermissions('ADMIN')).toContain('kitchen-stations:manage');
  });

  it('withholds it from the roles that only WORK the kitchen', () => {
    // A cook claims and cooks lines; a waiter takes orders. Neither decides
    // where the store's dishes get routed.
    expect(rolePermissions('CHEF')).not.toContain('kitchen-stations:manage');
    expect(rolePermissions('WAITER')).not.toContain('kitchen-stations:manage');
    // …and they keep the queue permissions the station config is separate from.
    expect(rolePermissions('CHEF')).toContain('kitchen:update');
  });

  it('pairs write against approve so one custom role cannot hold both', () => {
    expect(FUTURE_PAY_SOD_PAIRS).toContainEqual([
      'kitchen-stations:manage',
      'kitchen-stations:approve',
    ]);
  });
});
