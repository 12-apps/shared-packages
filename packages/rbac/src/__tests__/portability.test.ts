/**
 * The TOY SECOND HOST (FUT-146 acceptance): a complete, runnable "blog"
 * application wired to the library with ONLY a permission catalog,
 * roles-as-data, a resolver and the entity-gate hooks. If this suite compiles
 * and passes, the core is portable: nothing in it presumes restaurants,
 * tenants named `Client`, Prisma, or Next.js.
 *
 * IT USED TO PROVE LESS THAN IT LOOKED LIKE IT DID. "Zero imports from the
 * origin host's templates" was the whole claim, and it held — because a suite
 * chooses its own imports. What it could not see is that the package it
 * vouched for SHIPPED those templates: a second host installing
 * `@12-apps/rbac` received 61 ids and eight roles of somebody else's
 * application, and `createWebRbac` fell back to them when the host said
 * nothing. Portability was a discipline this file kept, not a property the
 * package had.
 *
 * The last two blocks are what it was missing: the blog composing this
 * package's OWN contribution beside its own (the arrangement a real host now
 * uses), and an assertion about what the package contains rather than about
 * what this suite imports.
 */
import { describe, it, expect } from 'vitest';
import { composePermissions } from '../core/compose';
import { isActiveAssignment } from '../core/caveats';
import { definePermissionContribution } from '../core/contribution';
import { createRbac } from '../core/engine';
import { definePermissions } from '../core/registry';
import type { RoleAssignment, RoleDef } from '../core/types';
import { validateGrant, type GovernanceCatalog } from '../governance';
import { RBAC_PERMISSIONS } from '../permissions';
import { createApiRbac } from '../server/create-api-rbac';
import { PT_BR_RBAC_MESSAGES } from '../server/pt-BR';
import { createFakeRbacDb, enrolMember } from '../server/__tests__/fake-db';

// ── The blog's own catalog (nothing shared with any other host) ─────────────
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

// ── The blog as a REAL host: composing the package's ids with its own ───────

/** The blog's contribution, declared the way a host declares one. */
const BLOG_CONTRIBUTION = definePermissionContribution({
  source: 'toy-blog',
  permissions: {
    'posts:read': { kind: 'class' },
    'posts:write:own': { kind: 'instance' },
    'posts:publish': { kind: 'class', separateFrom: ['posts:write:own'] },
    'site:configure': { kind: 'class', ownerMarker: true },
  },
  labels: { domains: { posts: 'Posts', site: 'Site' } },
});

/** The blog's whole catalog: this package's ids plus the blog's own. */
const blogCatalog = () =>
  composePermissions(RBAC_PERMISSIONS, BLOG_CONTRIBUTION).withRoles({
    roles: [
      { name: 'AUTHOR', permissions: ['posts:read', 'posts:write:own'] },
      { name: 'STAFF_ADMIN', permissions: ['team:read', 'team:manage'] },
      // A role the blog happens to spell `SUPERADMIN`, meaning nothing more
      // than "senior moderator": an ordinary admin, deliberately NOT an owner.
      // The package used to compare an actor's role against that exact string
      // to recognise a PLATFORM operator, so this name — a host's own word —
      // bought an owner-removal bypass. It is here to make that a red test.
      { name: 'SUPERADMIN', permissions: ['team:read', 'team:manage'] },
      { name: 'SITE_OWNER', permissions: '*' },
    ],
    ownerRoles: ['SITE_OWNER'],
    leafOnlyRoles: ['AUTHOR'],
    platformOnlyRoles: [],
  });

describe('toy second host — composing this package beside its own domain', () => {
  it('installs the package\'s own screens without adopting anyone\'s domain', () => {
    const catalog = blogCatalog();
    // The three ids the packaged roles/team surface gates itself with are the
    // ONLY ones the blog inherits. Everything else on this list is the blog's.
    expect(catalog.permissions.list).toEqual([
      'roles:manage',
      'team:read',
      'team:manage',
      'posts:read',
      'posts:write:own',
      'posts:publish',
      'site:configure',
    ]);
    expect(catalog.sourceOf('team:read')).toBe('@12-apps/rbac');
    expect(catalog.sourceOf('posts:publish')).toBe('toy-blog');
  });

  it('governs with both halves — the package\'s markers and the blog\'s roles', () => {
    const catalog = blogCatalog();
    expect(catalog.governance.ownerPermissions).toEqual([
      'roles:manage',
      'site:configure',
    ]);
    expect(catalog.governance.sodPairs).toEqual([['posts:publish', 'posts:write:own']]);

    const composed = validateGrant({
      granterPermissions: catalog.permissions.list,
      roleBeingGranted: {
        name: 'custom',
        permissions: ['posts:write:own', 'posts:publish'],
      },
      targetScope: { isLeaf: true },
      catalog: catalog.governance,
    });
    expect(composed.ok).toBe(false);
    if (!composed.ok) expect(composed.reason).toMatch(/^SEPARATION_OF_DUTIES/);
  });

  it('seeds every blog tenant with the blog\'s own roles', () => {
    const catalog = blogCatalog();
    expect(catalog.tenantRoleSeeds.map((seed) => seed.name)).toEqual([
      'AUTHOR',
      'STAFF_ADMIN',
      'SUPERADMIN',
      'SITE_OWNER',
    ]);
    expect(catalog.tenantRoleSeeds.find((seed) => seed.name === 'SITE_OWNER')).toMatchObject({
      permissions: '*',
      locked: true,
    });
  });
});

// ── The blog MOUNTS the server half, in its own words ──────────────────────
//
// Everything above this line is the engine, the governance validator and the
// composition — halves a suite can exercise without ever constructing a
// server config. That is why this file used to prove less about PORTABILITY
// than its name claims: `ownerRoles`, `customerRole` and `adminRoles` live
// only on the server config, so a suite that never calls `createApiRbac`
// cannot reach them, and every one of them shipped a default in the extracted
// application's vocabulary. A blog whose owner is `SITE_OWNER` is precisely
// the host `['OWNER']` breaks; the suite said "portable" because it never
// mounted the thing that breaks.

/** The blog's server mount, over the in-memory seam. Its words, throughout. */
function mountBlog() {
  const { db, state } = createFakeRbacDb();
  const identities = new Map(
    [
      { id: 'ada', email: 'ada@blog.test', name: 'Ada', image: null },
      { id: 'bo', email: 'bo@blog.test', name: 'Bo', image: null },
      { id: 'cy', email: 'cy@blog.test', name: 'Cy', image: null },
      { id: 'dee', email: 'dee@blog.test', name: 'Dee', image: null },
      { id: 'reader', email: 'reader@blog.test', name: 'Reader', image: null },
    ].map((identity) => [identity.id, identity]),
  );
  const api = createApiRbac({
    db: async () => db,
    catalog: blogCatalog(),
    // `ownerRoles` is deliberately ABSENT: it derives from the catalog's own
    // `['SITE_OWNER']`. The other two have no catalog answer, so the blog
    // states them — in words the package has never heard of.
    adminRoles: ['SITE_OWNER', 'STAFF_ADMIN', 'SUPERADMIN'],
    customerRole: 'SUBSCRIBER',
    // Copy is required config too — nothing here asserts a sentence, so the
    // blog reuses the named pack; what matters is that the choice is a line
    // in ITS wiring, not a default it never saw.
    messages: PT_BR_RBAC_MESSAGES,
    directory: {
      getUsers: async (ids) =>
        ids.flatMap((id) => {
          const identity = identities.get(id);
          return identity ? [identity] : [];
        }),
    },
  });
  return { api, state };
}

const blogSite = 'blog-1';

/** Drive one route descriptor as a given member. */
function asMember(
  api: ReturnType<typeof mountBlog>['api'],
  method: string,
  path: string,
  userId: string | null,
  extra: { params?: Record<string, string>; body?: unknown; isSuper?: boolean } = {},
) {
  const route = api.routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`No route ${method} ${path}`);
  return route.handle({
    actor: { tenantId: blogSite, userId, isSuper: extra.isSuper ?? false },
    params: extra.params ?? {},
    query: {},
    body: extra.body,
  });
}

describe('toy second host — the SERVER half, in the blog\'s vocabulary', () => {
  it('protects SITE_OWNER by the catalog, with no ownerRoles config at all', async () => {
    const blog = mountBlog();
    await blog.api.seedTenantRoles(blogSite);
    enrolMember(blog.state, blogSite, 'ada', 'SITE_OWNER');
    enrolMember(blog.state, blogSite, 'bo', 'STAFF_ADMIN');

    // Last owner: neither demotable nor disableable nor removable. Under the
    // old `ownerRoles ?? ['OWNER']` every one of these succeeded, because no
    // membership in this host is ever spelled `OWNER`.
    await expect(
      blog.api.team.setMemberRole(blogSite, 'ada', 'STAFF_ADMIN'),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      blog.api.team.setMembershipActive(blogSite, 'ada', false),
    ).rejects.toMatchObject({ status: 403 });
    // Removal is refused twice over: a non-owner may not remove an owner…
    await expect(
      blog.api.team.removeTenantMemberGuarded(blogSite, 'ada', {
        role: 'STAFF_ADMIN',
        isPlatformActor: false,
      }),
    ).rejects.toMatchObject({ status: 403 });
    // …and the owner themself is still the LAST one.
    await expect(
      blog.api.team.removeTenantMemberGuarded(blogSite, 'ada', {
        role: 'SITE_OWNER',
        isPlatformActor: false,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(blog.state.memberships.find((row) => row.userId === 'ada')?.role).toBe('SITE_OWNER');

    // A SECOND owner lifts the last-owner rule, and only then does the removal
    // land — for an owner, and still not for the admin.
    enrolMember(blog.state, blogSite, 'cy', 'SITE_OWNER');
    await expect(
      blog.api.team.removeTenantMemberGuarded(blogSite, 'ada', {
        role: 'STAFF_ADMIN',
        isPlatformActor: false,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await blog.api.team.removeTenantMemberGuarded(blogSite, 'ada', {
      role: 'SITE_OWNER',
      isPlatformActor: false,
    });
    expect(blog.state.memberships.some((row) => row.userId === 'ada')).toBe(false);
  });

  it('never reads a host role NAMED SUPERADMIN as a platform grant', async () => {
    const blog = mountBlog();
    await blog.api.seedTenantRoles(blogSite);
    enrolMember(blog.state, blogSite, 'ada', 'SITE_OWNER');
    enrolMember(blog.state, blogSite, 'cy', 'SITE_OWNER');
    enrolMember(blog.state, blogSite, 'dee', 'SUPERADMIN');

    // The blog's senior moderator is an admin, not an owner — and the string
    // `'SUPERADMIN'` used to be the package's own sentinel for a platform
    // operator, so this removal went through.
    await expect(
      blog.api.team.removeTenantMemberGuarded(blogSite, 'ada', {
        role: 'SUPERADMIN',
        isPlatformActor: false,
      }),
    ).rejects.toMatchObject({ status: 403 });

    // The genuine platform operator — recognised by the DISCRIMINATOR, and
    // holding no membership row at all — still may.
    await blog.api.team.removeTenantMemberGuarded(blogSite, 'ada', {
      role: null,
      isPlatformActor: true,
    });
    expect(blog.state.memberships.some((row) => row.userId === 'ada')).toBe(false);
  });

  it('keeps SUBSCRIBERs out of the roster and out of the staff tier', async () => {
    const blog = mountBlog();
    await blog.api.seedTenantRoles(blogSite);
    enrolMember(blog.state, blogSite, 'ada', 'SITE_OWNER');
    enrolMember(blog.state, blogSite, 'reader', 'SUBSCRIBER');

    const roster = await blog.api.team.listTeamPage(blogSite, { page: 1, pageSize: 50 });
    expect(roster.data.map((row) => row.userId)).toEqual(['ada']);

    // …and the staff-tier read (`GET /permissions`) refuses them, which is the
    // half that used to admit every shopper when the default said 'CUSTOMER'.
    const denied = await asMember(blog.api, 'GET', '/permissions', 'reader');
    expect(denied.status).toBe(403);
    const allowed = await asMember(blog.api, 'GET', '/permissions', 'ada');
    expect(allowed.status).toBe(200);
  });

  it('gates the roster on the blog\'s OWN admin tier', async () => {
    const blog = mountBlog();
    await blog.api.seedTenantRoles(blogSite);
    enrolMember(blog.state, blogSite, 'ada', 'SITE_OWNER');
    enrolMember(blog.state, blogSite, 'bo', 'AUTHOR');

    expect((await asMember(blog.api, 'GET', '/team', 'bo')).status).toBe(403);
    expect((await asMember(blog.api, 'GET', '/team', 'ada')).status).toBe(200);
  });
});

// ── The tripwire: what the PACKAGE ships, not what this suite imports ───────

describe('the package ships no application catalog', () => {
  it('contributes only the permissions guarding its own surfaces', () => {
    // The regression this replaces: 61 ids of products, mesas, cozinha, stock
    // and payments, exported from here under a header that already called
    // itself "application DATA, not generic core". If a domain permission ever
    // shows up in this list again, it is the same mistake and this fails.
    expect(RBAC_PERMISSIONS.source).toBe('@12-apps/rbac');
    expect(RBAC_PERMISSIONS.ids).toEqual(['roles:manage', 'team:read', 'team:manage']);
    const domains = new Set(RBAC_PERMISSIONS.ids.map((id) => id.split(':')[0]));
    expect([...domains].sort()).toEqual(['roles', 'team']);
  });
});
