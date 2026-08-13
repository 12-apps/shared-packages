import { describe, expect, it } from 'vitest';

import { validateGrant } from '../governance';
import {
  DEFAULT_ROLE_TEMPLATES,
  FUTURE_PAY_GOVERNANCE,
  FUTURE_PAY_PERMISSIONS,
} from '../templates';

/**
 * The "Ver como" grants (FUT-460): `user:impersonate` to open a read-only
 * preview of the admin as one of the tenant's own roles or members, and
 * `user:impersonate:configure` to arm the store's switch over the feature.
 *
 * THE CONTRACT INVERTED HERE, and the cases say so on purpose. This suite used
 * to pin the opposite shape — one permission, `impersonation:preview`, listed in
 * `ownerPermissions` so that no custom role and no template override could ever
 * carry it. That made the feature undelegable: the administrator who configures
 * a store's roles could not check the result, and no role a store composed could
 * be given the job either.
 *
 * What replaces it is not "the protection was dropped". The property that makes
 * a preview safe is the never-widen INTERSECTION applied to the session, not the
 * marker — previewing resolves against the previewer's own set, so an ADMIN
 * previewing an OWNER sees an ADMIN's screen. These cases pin the delegation
 * that property permits, and the ESCALATION GUARD that still bites: nobody
 * grants what they do not hold.
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
  it('registers both grants as CLASS scoped', () => {
    // Class, not instance: what is gated is entering a preview at all, decided
    // before any target exists. "May I preview THIS member" would need a
    // resource assignment per colleague — a table nothing writes. Arming the
    // store's switch has no instance to speak of either.
    expect(FUTURE_PAY_PERMISSIONS.kind('user:impersonate')).toBe('class');
    expect(FUTURE_PAY_PERMISSIONS.kind('user:impersonate:configure')).toBe('class');
  });

  it('seeds both into ADMIN, and reaches OWNER through the wildcard', () => {
    expect(rolePermissions('OWNER')).toBe('*');
    expect(rolePermissions('SUPERADMIN')).toBe('*');
    expect(rolePermissions('ADMIN')).toContain('user:impersonate');
    expect(rolePermissions('ADMIN')).toContain('user:impersonate:configure');
  });

  it('leaves the operational roles out of the seed — delegation is the store\'s call', () => {
    // A MANAGER may be GRANTED either grant (the case below), but does not get
    // them by default: seeding them would hand every existing store's managers
    // the ability to read the admin as their colleagues, on a deploy nobody
    // asked for it in.
    for (const name of ['MANAGER', 'WAITER', 'CHEF', 'FINANCIAL', 'BUYER']) {
      expect(rolePermissions(name)).not.toContain('user:impersonate');
      expect(rolePermissions(name)).not.toContain('user:impersonate:configure');
    }
  });

  it('is no longer owner-protected, so a store may compose a role that holds it', () => {
    // The inversion, stated as the assertion that would have failed before.
    expect(FUTURE_PAY_GOVERNANCE.ownerPermissions).not.toContain('user:impersonate');
    expect(FUTURE_PAY_GOVERNANCE.ownerPermissions).not.toContain(
      'user:impersonate:configure',
    );
    const result = validateGrant({
      granterPermissions: ['team:read', 'user:impersonate', 'user:impersonate:configure'],
      roleBeingGranted: {
        name: 'Supervisão',
        permissions: ['team:read', 'user:impersonate'],
      },
      targetScope: { isLeaf: true },
      catalog: FUTURE_PAY_GOVERNANCE,
    });
    expect(result.ok).toBe(true);
  });

  it('still refuses a granter who does not hold it themselves', () => {
    // The guard that replaces the marker. Delegating "Ver como" is now allowed;
    // MINTING it out of nothing is not, so a manager cannot write themselves a
    // custom role that grants what their own set never had.
    const result = validateGrant({
      granterPermissions: ['team:read', 'config:read'],
      roleBeingGranted: {
        name: 'Supervisão',
        permissions: ['team:read', 'user:impersonate'],
      },
      targetScope: { isLeaf: true },
      catalog: FUTURE_PAY_GOVERNANCE,
    });
    expect(result.ok).toBe(false);
  });

  it('lets a curated ADMIN override keep the grants its seed now carries', () => {
    // FUT-217 lets a tenant re-cut a SYSTEM role. `checkCuratedMarkers` allows
    // preserving a seed's intrinsic markers and refuses ADDING one — with the
    // grants off the marker list and inside ADMIN's seed, an override that
    // keeps them is simply an ordinary re-cut.
    const result = validateGrant({
      granterPermissions: ['*'],
      roleBeingGranted: {
        name: 'ADMIN',
        permissions: ['team:read', 'roles:manage', 'user:impersonate'],
      },
      targetScope: { isLeaf: true },
      catalog: FUTURE_PAY_GOVERNANCE,
      curatedTemplate: true,
    });
    expect(result.ok).toBe(true);
  });
});
