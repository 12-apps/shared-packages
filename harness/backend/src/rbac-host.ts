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
import { rbacManifest } from '@12-apps/rbac/manifest';
import { rbacServerManifest } from '@12-apps/rbac/manifest/server';
import type { MountedRoute } from '@12-apps/wiring';
import { createWiringHost, type WiringReport } from '@12-apps/wiring/consumer';

import { harnessLoggerFor, honoRouterFor } from './wire-hono';
import { PT_BR_RBAC_MESSAGES, type createApiRbac, type RbacUserIdentity } from '@12-apps/rbac/server';

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
  { id: 'owner-1', email: 'ana@harness.dev', name: 'Ana Ribeiro', image: null, baseRole: 'DIRECTOR', tenantId: RBAC_TENANT_ID },
  { id: 'admin-1', email: 'otavio@harness.dev', name: 'Otávio Nunes', image: null, baseRole: 'HEAD_LIBRARIAN', tenantId: RBAC_TENANT_ID },
  { id: 'chef-1', email: 'camila@harness.dev', name: 'Camila Barbosa', image: null, baseRole: 'CONSERVATOR', tenantId: RBAC_TENANT_ID },
  { id: 'waiter-1', email: 'bruno@harness.dev', name: 'Bruno Carvalho', image: null, baseRole: 'CLERK', tenantId: RBAC_TENANT_ID },
  { id: 'role-target', email: 'target@harness.dev', name: 'Role Target', image: null, baseRole: 'CONSERVATOR', tenantId: RBAC_TENANT_ID },
  // A reader, not staff. `customerRole: 'PATRON'` below is what keeps this row
  // out of the roster and out of the staff tier — and `PATRON` is a word no
  // package-side default could have guessed, which is the point of it.
  { id: 'patron-1', email: 'lia@harness.dev', name: 'Lia Prado', image: null, baseRole: 'PATRON', tenantId: RBAC_TENANT_ID },
  // The neighbour: one DIRECTOR, so tenant B has a fully-entitled actor whose
  // reach must still end at its own rows.
  { id: 'owner-b', email: 'beatriz@harness-b.dev', name: 'Beatriz Vizinha', image: null, baseRole: 'DIRECTOR', tenantId: RBAC_TENANT_B_ID },
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
  // can narrow (Voluntário stays, Catalogador goes).
  await pg.query(
    `INSERT INTO roles (id, client_id, name, permissions, description, is_template, kind, locked, updated_at)
     VALUES
       ('custom-voluntario', $1, 'Voluntário', $2, 'Ajuda no balcão', FALSE, 'CUSTOM', FALSE, NOW()),
       ('custom-catalogador', $1, 'Catalogador', $3, 'Cuida do acervo', FALSE, 'CUSTOM', FALSE, NOW())
     ON CONFLICT DO NOTHING`,
    [
      RBAC_TENANT_ID,
      JSON.stringify(['titles:read:all']),
      JSON.stringify(['copies:read', 'copies:move']),
    ],
  );
}

/** The mounted surface: the package's router behind this host's actor seam. */
/** Where `mount-surfaces.ts` hangs it — the adoption's claim. */
export const RBAC_MOUNT_PATH = '/api/admin/:tenantSlug';

/**
 * The surface, adopted through `@12-apps/wiring/consumer`.
 *
 * `permissions` is a CONTRIBUTION here, which makes this the first adoption
 * where a collected capability is something the host actually consumes: the
 * package contributes ids, and `rbac-catalog.ts` composes them with two other
 * owners' into the one catalog this host passes back as config. The report is
 * what lets a host be asked whether it did that, rather than quietly shipping a
 * catalog missing a package's own ids.
 *
 * What does NOT come off the routes, and the manifest says so: `engine`,
 * `governance`, the two stores and `seedTenantRoles` are "the rest of
 * `ApiRbac`, and a host still reaches for it directly: this surface is the one
 * every OTHER host surface asks permission from, so the capability being
 * mounted does not make the guards stop being a library." `wired.http[name]`
 * is how the host keeps them beside the routes without building the surface
 * twice — two engines over one database is two answers to "may they".
 */
/**
 * The adoption itself, lifted out of {@link rbacHost} so that function stays
 * inside the size gate. Everything here is CONFIG — what this host answers for
 * each capability the manifest declares.
 */
function adoptRbac(host: ReturnType<typeof createWiringHost>, pg: PGlite): void {
  host.adoptServer({
    manifest: rbacManifest,
    server: rbacServerManifest,
    // The packaged journeys drive SCREENS — the roster grid, the role editor,
    // the member profile — so the world they ask for is a browser's, and this
    // process has no browser. `harness/frontend` binds it, as it does for
    // auth, impersonation and reports.
    e2e: { declined: 'the journeys drive screens — the web harness answers for the world' },
    bindings: {
      http: {
        mountPath: RBAC_MOUNT_PATH,
        config: {
          db: async () => rbacDb(pg),
          // The whole catalog, assembled by this host from three owners'
          // contributions (see `rbac-catalog.ts`) — one field, not four.
          catalog: HARNESS_CATALOG,
          // The roster's own vocabulary, stated because this host's words are
          // nobody else's. `ownerRoles` is deliberately NOT passed: it derives
          // from `catalog.governance.ownerRoles` (DIRECTOR + NETWORK_OPS), so
          // the disable/removal invariants run on exactly the set this host's
          // composed governance already names, rather than on a package default
          // that used to read `['OWNER']` and protected nothing here.
          adminRoles: ['DIRECTOR', 'HEAD_LIBRARIAN'],
          customerRole: 'PATRON',
          // The refusal sentences are required host config; this host is pt-BR.
          messages: PT_BR_RBAC_MESSAGES,
          directory: {
            getUsers: async (ids: readonly string[]) =>
              ids.flatMap((id) => {
                const user = DIRECTORY.get(id);
                return user ? [user] : [];
              }),
            searchUsers: async (q: string) =>
              [...DIRECTORY.values()]
                .filter(
                  (user) =>
                    user.email.toLowerCase().includes(q.toLowerCase()) ||
                    (user.name ?? '').toLowerCase().includes(q.toLowerCase()),
                )
                .map((user) => user.id),
          },
        },
      },
    },
  });
}

export function rbacHost(pg: PGlite): ReturnType<typeof createApiRbac> & {
  router: ReturnType<typeof honoRouterFor>;
  report: WiringReport;
  routes: readonly MountedRoute[];
} {
  const host = createWiringHost({
    name: 'harness-backend',
    kind: 'server',
    ports: { loggerFor: harnessLoggerFor },
  });

  adoptRbac(host, pg);

  const wired = host.assemble();
  const api = wired.http[rbacManifest.name] as ReturnType<typeof createApiRbac>;

  return {
    ...api,
    report: wired.report,
    routes: wired.routes,
    router: honoRouterFor(wired.routes, (c) => {
      // Which tenant: resolved from the mounted path's own slug, the way a real
      // host resolves it — an unknown slug is an unauthenticated 401 here (a
      // real host would 404 first).
      const tenantId = c.req.param('tenantSlug');
      if (tenantId !== RBAC_TENANT_ID && tenantId !== RBAC_TENANT_B_ID) return null;
      // Who: the SPA sends no header and acts as the seeded DIRECTOR — the
      // arrangement the admin screens assume. A spec that needs another vantage
      // sets the header; `anonymous` exercises the 401 path.
      const userId = c.req.header(ACTOR_HEADER) ?? 'owner-1';
      if (userId === 'anonymous') return null;
      if (userId === 'superadmin') {
        return { tenantId, userId: null, isSuper: true };
      }
      return { tenantId, userId, isSuper: false };
    }),
  };
}
