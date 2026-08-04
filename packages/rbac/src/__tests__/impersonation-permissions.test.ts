import { describe, expect, it } from 'vitest';

import { validateGrant } from '../governance';
import {
  DEFAULT_ROLE_TEMPLATES,
  FUTURE_PAY_GOVERNANCE,
  FUTURE_PAY_PERMISSIONS,
} from '../templates';

/**
 * `impersonation:preview` (FUT-460) — the permission gate on "Ver como", the
 * read-only preview of the admin as one of the tenant's own roles or members.
 *
 * The NEGATIVE half is the whole test. This is the one grant that lets a human
 * read the admin through someone else's permissions, so "OWNER only" has to be
 * structural, not merely a template that happens to omit it: a tenant must not
 * be able to compose a custom role that holds it, and a template override must
 * not be able to inject it into a role whose seed lacks it.
 */
function rolePermissions(name: string): readonly string[] | '*' {
  const role = DEFAULT_ROLE_TEMPLATES.find((candidate) => candidate.name === name);
  if (!role) throw new Error(`Missing role ${name}`);
  if (role.permissions === '*') return '*';
  return role.permissions.map((entry) =>
    typeof entry === 'string' ? entry : entry.permission,
  );
}

describe('impersonation permissions', () => {
  it('registers entering a preview as CLASS scoped', () => {
    // Class, not instance: what is gated is entering a preview at all, decided
    // before any target exists. "May I preview THIS member" would need a
    // resource assignment per colleague — a table nothing writes.
    expect(FUTURE_PAY_PERMISSIONS.kind('impersonation:preview')).toBe('class');
  });

  it('reaches OWNER (and only OWNER) through the wildcard, never an enumeration', () => {
    expect(rolePermissions('OWNER')).toBe('*');
    expect(rolePermissions('SUPERADMIN')).toBe('*');
    for (const role of DEFAULT_ROLE_TEMPLATES) {
      if (role.permissions === '*') continue;
      expect(rolePermissions(role.name)).not.toContain('impersonation:preview');
    }
  });

  it('is an owner marker, so no inline custom role can carry it', () => {
    expect(FUTURE_PAY_GOVERNANCE.ownerPermissions).toContain(
      'impersonation:preview',
    );
    const result = validateGrant({
      // A granter who holds everything — proving the refusal is owner
      // protection and not the escalation guard firing first.
      granterPermissions: ['*'],
      roleBeingGranted: {
        name: 'Supervisão',
        permissions: ['team:read', 'impersonation:preview'],
      },
      targetScope: { isLeaf: true },
      catalog: FUTURE_PAY_GOVERNANCE,
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toContain('OWNER_PROTECTED');
  });

  it('cannot be injected into a system template by a curated override', () => {
    // FUT-217 lets a tenant re-cut a SYSTEM role. `checkCuratedMarkers` allows
    // preserving a seed's intrinsic markers but never adding one, so an ADMIN
    // override cannot quietly grow "Ver como".
    const result = validateGrant({
      granterPermissions: ['*'],
      roleBeingGranted: {
        name: 'ADMIN',
        permissions: ['team:read', 'roles:manage', 'impersonation:preview'],
      },
      targetScope: { isLeaf: true },
      catalog: FUTURE_PAY_GOVERNANCE,
      curatedTemplate: true,
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toContain('impersonation:preview');
  });
});
