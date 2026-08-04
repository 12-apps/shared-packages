/**
 * The TOY SECOND HOST (FUT-146 acceptance): a complete, runnable "blog"
 * application wired to the library with ONLY a permission catalog, roles-as-data,
 * a resolver and the entity-gate hooks — zero imports from the Future Pay
 * templates. If this suite compiles and passes, the core is portable: nothing in
 * it presumes restaurants, tenants named `Client`, Prisma, or Next.js.
 */
import { describe, it, expect } from 'vitest';
import { isActiveAssignment } from '../core/caveats';
import { createRbac } from '../core/engine';
import { definePermissions } from '../core/registry';
import type { RoleAssignment, RoleDef } from '../core/types';
import { validateGrant, type GovernanceCatalog } from '../governance';

// ── The blog's own catalog (nothing shared with Future Pay) ─────────────────
const BLOG_PERMISSIONS = definePermissions({
  'posts:read': 'class',
  'posts:write:own': 'instance',
  'posts:publish': 'class',
  'posts:review:assigned': 'instance',
  'site:configure': 'class',
} as const);

type BlogPermission = (typeof BLOG_PERMISSIONS.list)[number];

const BLOG_ROLES: readonly RoleDef<BlogPermission>[] = [
  { name: 'READER', permissions: ['posts:read'] },
  {
    name: 'AUTHOR',
    permissions: ['posts:write:own'],
    inherits: ['READER'],
  },
  {
    name: 'EDITOR',
    permissions: ['posts:publish', 'posts:review:assigned'],
    inherits: ['AUTHOR'],
  },
  { name: 'SITE_OWNER', permissions: '*' },
];

// ── The blog's "database": scopes are sites, org "network" is their parent ──
const NOW = Date.parse('2026-07-24T12:00:00Z');

const grants: Record<string, RoleAssignment[]> = {
  alice: [{ role: 'AUTHOR', scope: 'site-cooking' }],
  bob: [{ role: 'EDITOR', scope: 'network-food' }], // parent scope, inherits down
  carol: [{ role: 'SITE_OWNER', scope: 'site-cooking' }],
};

/** post id -> author (the ownership relation). */
const postAuthors: Record<string, string> = {
  'post-1': 'alice',
  'post-2': 'someone-else',
};

/** Review assignments (temporal, filter-not-delete — revoked rows stay). */
const reviewAssignments = [
  { user: 'bob', post: 'post-2', validFrom: NOW - 1000, validTo: null },
  { user: 'bob', post: 'post-1', validFrom: NOW - 1000, validTo: NOW - 10 },
];

const makeBlogEngine = () =>
  createRbac<BlogPermission>({
    permissions: BLOG_PERMISSIONS,
    roles: BLOG_ROLES,
    resolver: (actorId) => grants[actorId] ?? [],
    scopeParent: (scope) => (scope === 'site-cooking' ? 'network-food' : null),
    ownership: (subject, resourceType) =>
      resourceType === 'posts'
        ? { kind: 'predicate', test: (postId) => postAuthors[postId] === subject }
        : null,
    assignmentResolver: (subject, resourceType) =>
      resourceType === 'posts'
        ? reviewAssignments
            .filter((a) => a.user === subject && isActiveAssignment(a, NOW))
            .map((a) => a.post)
        : [],
  });

const ctx = { scope: 'site-cooking' };

describe('toy second host — point checks', () => {
  it('grants by the blog catalog, deny-by-default beyond it', async () => {
    const rbac = makeBlogEngine();
    expect(await rbac.can('alice', 'posts:read', null, ctx)).toBe(true); // inherited
    expect(await rbac.can('alice', 'posts:publish', null, ctx)).toBe(false);
    expect(await rbac.can('alice', 'site:configure', null, ctx)).toBe(false);
    expect(await rbac.can('carol', 'site:configure', null, ctx)).toBe(true); // wildcard
    expect(await rbac.can('nobody', 'posts:read', null, ctx)).toBe(false);
  });

  it('walks the scope parent: a network grant reaches the child site', async () => {
    const rbac = makeBlogEngine();
    expect(await rbac.can('bob', 'posts:publish', null, ctx)).toBe(true);
    expect(await rbac.can('bob', 'posts:publish', null, { scope: 'site-unrelated' })).toBe(false);
  });

  it('instance gate: ownership grants the author, assignment the reviewer', async () => {
    const rbac = makeBlogEngine();
    expect(await rbac.can('alice', 'posts:write:own', 'post-1', ctx)).toBe(true);
    expect(await rbac.can('alice', 'posts:write:own', 'post-2', ctx)).toBe(false);
    expect(await rbac.can('bob', 'posts:review:assigned', 'post-2', ctx)).toBe(true);
  });

  it('temporal filter: a revoked review assignment stops granting', async () => {
    const rbac = makeBlogEngine();
    expect(await rbac.can('bob', 'posts:review:assigned', 'post-1', ctx)).toBe(false);
  });
});

describe('toy second host — list seam', () => {
  it('class tier sees all, unauthorized sees none', async () => {
    const rbac = makeBlogEngine();
    expect((await rbac.visibleResources('alice', 'posts:read', 'posts', ctx)).kind).toBe('all');
    expect((await rbac.visibleResources('nobody', 'posts:read', 'posts', ctx)).kind).toBe('none');
  });

  it('instance tier narrows to the ownership predicate / assigned ids', async () => {
    const rbac = makeBlogEngine();
    const owned = await rbac.visibleResources('alice', 'posts:write:own', 'posts', ctx);
    expect(owned.kind).toBe('predicate');

    // Bob's reach = his (empty) ownership predicate plus the one live review
    // assignment — the revoked post-1 row is filtered out by the temporal
    // predicate, exactly the filter-not-delete behaviour the seam promises.
    const review = await rbac.visibleResources('bob', 'posts:review:assigned', 'posts', ctx);
    expect(review.kind).toBe('predicate');
    const { predicate } = review as {
      predicate: { test: (id: string) => boolean; orIds?: string[] };
    };
    expect(predicate.orIds).toEqual(['post-2']);
    expect(predicate.test('post-1')).toBe(false);
  });
});

describe('toy second host — governance with the blog catalog', () => {
  const governance: GovernanceCatalog = {
    permissions: BLOG_PERMISSIONS,
    roles: BLOG_ROLES,
    ownerRoles: ['SITE_OWNER'],
    ownerPermissions: ['site:configure'],
    leafOnlyRoles: ['AUTHOR'],
    sodPairs: [['posts:write:own', 'posts:publish']],
  };

  const allPermissions = [...BLOG_PERMISSIONS.list];

  it('escalation guard: a granter may only grant what they hold', () => {
    const result = validateGrant({
      granterPermissions: ['posts:read'],
      roleBeingGranted: { name: 'custom', permissions: ['posts:publish'] },
      targetScope: { isLeaf: true },
      catalog: governance,
    });
    expect(result.ok).toBe(false);
  });

  it('SoD: no single role may both write and publish', () => {
    const result = validateGrant({
      granterPermissions: allPermissions,
      roleBeingGranted: {
        name: 'custom',
        permissions: ['posts:write:own', 'posts:publish'],
      },
      targetScope: { isLeaf: true },
      catalog: governance,
    });
    expect(result.ok).toBe(false);
  });

  it('scope ceiling: a leaf-only role is not assignable at the network scope', () => {
    const result = validateGrant({
      granterPermissions: allPermissions,
      roleBeingGranted: 'AUTHOR',
      targetScope: { isLeaf: false },
      catalog: governance,
    });
    expect(result.ok).toBe(false);
  });

  it('a clean custom role passes', () => {
    const result = validateGrant({
      granterPermissions: allPermissions,
      roleBeingGranted: {
        name: 'custom',
        permissions: ['posts:read', 'posts:review:assigned'],
      },
      targetScope: { isLeaf: true },
      catalog: governance,
    });
    expect(result.ok).toBe(true);
  });
});
