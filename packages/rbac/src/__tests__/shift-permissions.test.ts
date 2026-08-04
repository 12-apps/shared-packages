import { describe, expect, it } from 'vitest';

import { DEFAULT_ROLE_TEMPLATES, FUTURE_PAY_PERMISSIONS } from '../templates';

function rolePermissions(name: string): readonly string[] | '*' {
  const role = DEFAULT_ROLE_TEMPLATES.find((candidate) => candidate.name === name);
  if (!role) throw new Error(`Missing role ${name}`);
  if (role.permissions === '*') return '*';
  return role.permissions.map((entry) => (typeof entry === 'string' ? entry : entry.permission));
}

describe('shift permissions', () => {
  it('keeps manage-own class scoped for host self checks', () => {
    expect(FUTURE_PAY_PERMISSIONS.kind('shift:manage:own')).toBe('class');
    expect(FUTURE_PAY_PERMISSIONS.kind('shift:read:all')).toBe('class');
    expect(FUTURE_PAY_PERMISSIONS.kind('shift:end:any')).toBe('class');
  });

  it('grants own management to workers and oversight to managers', () => {
    expect(rolePermissions('CHEF')).toContain('shift:manage:own');
    expect(rolePermissions('WAITER')).toContain('shift:manage:own');
    expect(rolePermissions('MANAGER')).toEqual(
      expect.arrayContaining(['shift:read:all', 'shift:end:any']),
    );
    expect(rolePermissions('OWNER')).toBe('*');
  });
});
