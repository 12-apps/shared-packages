/**
 * Everything `@12-apps/rbac` needs from a HOST, in one object (12-13).
 *
 * What is genuinely the host's, and all that is here: who is calling (a
 * header-driven session stand-in — a browser cannot have a real one), which
 * tenant the slug names, what the user ids look like as people (the
 * directory), where the five owned tables live (the PGlite-backed seam in
 * `rbac-db.ts`), and the permission CATALOG — assembled in `rbac-catalog.ts`
 * from this host's own domain plus every package that owns a surface here.
 * Everything else — guards, governance, parsing, statuses, the envelope — is
 * the package's, which is the entire claim under test.
 */
import type { PGlite } from '@electric-sql/pglite';
import { rbacRouter } from '@12-apps/rbac/hono';
import type { RbacUserIdentity } from '@12-apps/rbac/server';

import { HARNESS_CATALOG } from './rbac-catalog';
import { rbacDb } from './rbac-db';

/** The mounted surface's type — inferred, so the guards keep their catalog. */
export type HarnessRbac = ReturnType<typeof rbacHost>;

/** The primary tenant — the one the SPA page and most specs drive. */
export const RBAC_TENANT_ID = 'harness';

/**
 * A second, minimally-populated tenant. Tenant isolation is the property with
 * the highest stakes in this package, and a harness with one tenant cannot
 * exercise it at the tarball level — every isolation proof would otherwise
 * live only in the package's in-memory unit suite.
 */
export const RBAC_TENANT_B_ID = 'harness-b';

/**
 * The people. A real host joins its user table; this one holds the roster in
 * code, which is exactly what the directory port exists to allow.
 */
export const RBAC_USERS: readonly (RbacUserIdentity & { baseRole: string; tenantId: string })[] = [
  { id: 'owner-1', email: 'ana@harness.dev', name: 'Ana Proprietária', image: null, baseRole: 'OWNER', tenantId: RBAC_TENANT_ID },
  { id: 'admin-1', email: 'otavio@harness.dev', name: 'Otávio Administrador', image: null, baseRole: 'ADMIN', tenantId: RBAC_TENANT_ID },
  { id: 'chef-1', email: 'camila@harness.dev', name: 'Camila Barbosa', image: null, baseRole: 'CHEF', tenantId: RBAC_TENANT_ID },
  { id: 'waiter-1', email: 'bruno@harness.dev', name: 'Bruno Carvalho', image: null, baseRole: 'WAITER', tenantId: RBAC_TENANT_ID },
  { id: 'role-target', email: 'target@harness.dev', name: 'Role Target', image: null, baseRole: 'CHEF', tenantId: RBAC_TENANT_ID },
  // The neighbour: one OWNER, so tenant B has a fully-entitled actor whose
  // reach must still end at its own rows.
  { id: 'owner-b', email: 'beatriz@harness-b.dev', name: 'Beatriz Vizinha', image: null, baseRole: 'OWNER', tenantId: RBAC_TENANT_B_ID },
];

const DIRECTORY = new Map(RBAC_USERS.map((user) => [user.id, user]));

/** The header a spec sets to act as someone else; the SPA's default is the owner. */
const ACTOR_HEADER = 'x-rbac-user';

/** Wipe + reseed the five owned tables — the `/__harness/reset` contract. */
export async function reseedRbac(pg: PGlite, rbac: HarnessRbac): Promise<void> {
  await pg.exec(
    'TRUNCATE TABLE membership_roles, role_assignments, resource_assignments, memberships, roles',
  );
  // The catalog first (the package's own seed — deterministic, idempotent),
  // then the roster the specs read, wiring the n:m join the resolver reads.
  await rbac.seedTenantRoles(RBAC_TENANT_ID);
  await rbac.seedTenantRoles(RBAC_TENANT_B_ID);
  const params: unknown[] = [];
  const values = RBAC_USERS.map((user, index) => {
    params.push(`m-${user.id}`, user.id, user.tenantId, user.baseRole);
    const base = index * 4;
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, TRUE, NOW(), NOW())`;
  }).join(', ');
  await pg.query(
    `INSERT INTO memberships (id, user_id, client_id, role, active, created_at, updated_at)
     VALUES ${values} ON CONFLICT DO NOTHING`,
    params,
  );
  await pg.query(
    `INSERT INTO membership_roles (id, membership_id, role_id)
     SELECT 'mr-' || m.id, m.id, r.id
     FROM memberships m JOIN roles r ON r.client_id = m.client_id AND r.name = m.role
     ON CONFLICT DO NOTHING`,
  );
  // Two seeded custom roles, so the roles grid has a catalog the search spec
  // can narrow (Barista stays, Estoquista goes).
  await pg.query(
    `INSERT INTO roles (id, client_id, name, permissions, description, is_template, kind, locked, updated_at)
     VALUES
       ('custom-barista', $1, 'Barista', $2, 'Prepara bebidas', FALSE, 'CUSTOM', FALSE, NOW()),
       ('custom-estoquista', $1, 'Estoquista', $3, 'Cuida do estoque', FALSE, 'CUSTOM', FALSE, NOW())
     ON CONFLICT DO NOTHING`,
    [
      RBAC_TENANT_ID,
      JSON.stringify(['products:read:all']),
      JSON.stringify(['stock:read', 'stock:move']),
    ],
  );
}

/** The mounted surface: the package's router behind this host's actor seam. */
export function rbacHost(pg: PGlite) {
  return rbacRouter({
    db: async () => rbacDb(pg),
    // The whole catalog, assembled by this host from three owners'
    // contributions (see `rbac-catalog.ts`) — one field, not four.
    catalog: HARNESS_CATALOG,
    directory: {
      getUsers: async (ids) =>
        ids.flatMap((id) => {
          const user = DIRECTORY.get(id);
          return user ? [user] : [];
        }),
      searchUsers: async (q) =>
        [...DIRECTORY.values()]
          .filter(
            (user) =>
              user.email.toLowerCase().includes(q.toLowerCase()) ||
              (user.name ?? '').toLowerCase().includes(q.toLowerCase()),
          )
          .map((user) => user.id),
    },
    resolveActor: (c) => {
      // Which tenant: resolved from the mounted path's own slug, the way a
      // real host resolves it — an unknown slug is an unauthenticated 401
      // here (a real host would 404 first).
      const tenantId = c.req.param('tenantSlug');
      if (tenantId !== RBAC_TENANT_ID && tenantId !== RBAC_TENANT_B_ID) return null;
      // Who: the SPA sends no header and acts as the seeded OWNER — the
      // arrangement the admin screens assume. A spec that needs another
      // vantage sets the header; `anonymous` exercises the 401 path.
      const userId = c.req.header(ACTOR_HEADER) ?? 'owner-1';
      if (userId === 'anonymous') return null;
      if (userId === 'superadmin') {
        return { tenantId, userId: null, isSuper: true };
      }
      return { tenantId, userId, isSuper: false };
    },
  });
}
