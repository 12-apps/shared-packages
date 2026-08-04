import { describe, it, expect } from 'vitest';
import { createRbac } from '../core/engine';
import { resourceTypeOf } from '../core/adapter';
import { definePermissions } from '../core/registry';
import type { RoleAssignment, RoleDef } from '../core/types';

const PERMS = definePermissions({
  'orders:read:all': 'class',
  'orders:read:own': 'instance',
  'orders:read:assigned': 'instance',
} as const);
type P = (typeof PERMS.list)[number];

const ROLES: readonly RoleDef<P>[] = [
  { name: 'ADMIN', permissions: ['orders:read:all'] },
  { name: 'OWNER_READER', permissions: ['orders:read:own'] },
  { name: 'WAITER', permissions: ['orders:read:assigned'] },
];

const assignments: Record<string, RoleAssignment[]> = {
  admin: [{ role: 'ADMIN', scope: 'S' }],
  ownerReader: [{ role: 'OWNER_READER', scope: 'S' }],
  waiter: [{ role: 'WAITER', scope: 'S' }],
};

function engine(over: Partial<Parameters<typeof createRbac<P>>[0]> = {}) {
  return createRbac<P>({
    permissions: PERMS,
    roles: ROLES,
    resolver: (id) => assignments[id] ?? [],
    defaultScope: 'S',
    ...over,
  });
}

describe('resourceTypeOf', () => {
  it('takes the segment before the first colon', () => {
    expect(resourceTypeOf('orders:read:own')).toBe('orders');
    expect(resourceTypeOf('products')).toBe('products');
  });
});

describe('default adapter — class permission', () => {
  it('check() ignores resource id for a class permission', async () => {
    const rbac = engine();
    await expect(rbac.can('admin', 'orders:read:all', 'anything')).resolves.toBe(
      true,
    );
  });

  it('visible() returns all when the class permission is held', async () => {
    const rbac = engine();
    await expect(
      rbac.visibleResources('admin', 'orders:read:all', 'orders'),
    ).resolves.toEqual({ kind: 'all' });
  });

  it('visible() returns none when not held', async () => {
    const rbac = engine();
    await expect(
      rbac.visibleResources('waiter', 'orders:read:all', 'orders'),
    ).resolves.toEqual({ kind: 'none' });
  });
});

describe('default adapter — instance permission via assignment relation', () => {
  function mk() {
    return engine({
      assignmentResolver: (_s, type) => (type === 'orders' ? ['o1', 'o2'] : []),
    });
  }

  it('grants an assigned instance', async () => {
    const rbac = mk();
    await expect(
      rbac.can('waiter', 'orders:read:assigned', 'o1'),
    ).resolves.toBe(true);
  });

  it('denies an unassigned instance', async () => {
    const rbac = mk();
    await expect(
      rbac.can('waiter', 'orders:read:assigned', 'o9'),
    ).resolves.toBe(false);
  });

  it('visible() returns the assigned ids', async () => {
    const rbac = mk();
    await expect(
      rbac.visibleResources('waiter', 'orders:read:assigned', 'orders'),
    ).resolves.toEqual({ kind: 'ids', ids: ['o1', 'o2'] });
  });
});

describe('default adapter — instance permission via ownership', () => {
  function mk() {
    return engine({
      ownership: (_s, type) =>
        type === 'orders'
          ? { kind: 'predicate', test: (id) => id.startsWith('mine-') }
          : null,
    });
  }

  it('grants an owned instance (predicate ownership)', async () => {
    const rbac = mk();
    await expect(
      rbac.can('ownerReader', 'orders:read:own', 'mine-1'),
    ).resolves.toBe(true);
  });

  it('denies a non-owned instance', async () => {
    const rbac = mk();
    await expect(
      rbac.can('ownerReader', 'orders:read:own', 'theirs-1'),
    ).resolves.toBe(false);
  });

  it('visible() hands back the ownership predicate', async () => {
    const rbac = mk();
    const v = await rbac.visibleResources(
      'ownerReader',
      'orders:read:own',
      'orders',
    );
    expect(v.kind).toBe('predicate');
  });
});

describe('default adapter — field ownership becomes a predicate for the LIST seam', () => {
  function mk() {
    return engine({
      ownership: (_s, type) =>
        type === 'orders' ? { kind: 'field', field: 'owner_id' } : null,
      assignmentResolver: () => ['o1'],
    });
  }

  it('visible() returns a predicate carrying the owner field + subject + orIds', async () => {
    const rbac = mk();
    const v = await rbac.visibleResources(
      'ownerReader',
      'orders:read:own',
      'orders',
    );
    expect(v).toEqual({
      kind: 'predicate',
      predicate: { ownerField: 'owner_id', subject: 'ownerReader', orIds: ['o1'] },
    });
  });
});

describe('default adapter — instance denied when RBAC denies', () => {
  it('no instance grant reached if the actor lacks the RBAC permission', async () => {
    const rbac = engine({ assignmentResolver: () => ['o1'] });
    await expect(
      rbac.can('admin', 'orders:read:assigned', 'o1'),
    ).resolves.toBe(false);
  });
});
