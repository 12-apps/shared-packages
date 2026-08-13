# Adopting @12-apps/rbac

This package is a **plug-and-play authorization plugin** (12-13): one library,
reusable across repositories, exposing standardized surfaces. A host repo only
*points* at these surfaces — when the library updates, every host updates with
**no app changes**. The contract is the same one `@12-apps/report-builder` and
`@12-apps/payments-*` established.

## The standardized plugin surfaces

| Surface | Export | What the host does |
|---|---|---|
| **Core engine** | `@12-apps/rbac` | The framework-free PDP (`createRbac`), the contribution/composition API (`definePermissionContribution`, `composePermissions`), caveats, the governance validator (`validateGrant`) and the tenant-role-seed projection. The package declares the three permissions guarding its OWN surfaces (`RBAC_PERMISSIONS`) and ships no application catalog — you compose yours. |
| **Server** | `@12-apps/rbac/server` | Call `createApiRbac(config)` and mount the `routes` it returns — role CRUD, template overrides, `GET /permissions` and the whole team roster, with parsing, statuses, governance and the envelope inside. Also returns the **guard helpers** (`guards.requirePermission`, `getActorPermissions`, `visibleResources`, `listVisibility`), the grant governance and the stores, so every OTHER host surface authorizes through the same wiring. |
| **Hono** | `@12-apps/rbac/hono` | `const rbac = rbacRouter({ ...serverConfig, resolveActor }); app.route('/api/admin/:tenantSlug', rbac.router)`. A one-call mount; `hono` is an OPTIONAL peer, so importing the root or `/server` never resolves it. |
| **React** | `@12-apps/rbac/react` | Call `createWebRbac({ apiBase, catalog })` and mount the `page` it returns (Papéis + Equipe), or route `RolesScreen` / `TeamScreen` yourself. Pass the SAME catalog object the server mount got. Built on the same `RbacProvider`/`useCan` context the package always shipped. |
| **Coverage gate** | `@12-apps/rbac/coverage` | Your `rbac:coverage` script becomes a one-line call: `rbacCoverageCli({ appDir, exclusionsPath, rbacGuards, entitlementGuards })`. Name your OWN guard helpers — the gate greps your source for your identifiers, so there is no generic list to default to. The CI workflow that shells out to the consumer's package script keeps working unchanged. |
| **Prisma** | `prisma/rbac.prisma` + `prisma/migrations/*` | Run `pnpm --filter @12-apps/rbac prisma:sync -- <host schema dir>` (or wire your own copy script): the partial is **COPIED** into the host's multi-file schema folder — never symlinked (a symlinked migration is silently skipped by Prisma; a symlinked partial dangles under `turbo prune`). Migrations are discovered structurally from the installed package's `prisma/migrations` by the host's plugin-migration sync. |

## Host wiring rules (the ones that bite)

0. **The host ASSEMBLES the catalog; the package contributes to it.** Each
   package that owns a guarded surface exports a `PermissionContribution`
   declaring its own ids — including this one (`RBAC_PERMISSIONS`:
   `roles:manage`, `team:read`, `team:manage`). The host calls
   `composePermissions(...)`, binds its ROLE policy with `.withRoles({ roles,
   ownerRoles, leafOnlyRoles, platformOnlyRoles, roleLabels })`, and passes the
   ONE resulting `catalog` object to `createApiRbac` / `rbacRouter` /
   `createWebRbac`. No package imports a sibling to discover ids, and nothing
   registers itself globally — composition is an argument at one call site.

   Two ids from two sources is an `RbacCatalogError`, in either order. So is an
   SoD counterpart nothing contributes, a role granting an unknown id, and a
   policy naming an unknown role. All at assembly, never during a decision.

1. **The host resolves WHO and WHERE; the package resolves WHAT THEY MAY DO.**
   `resolveActor` answers `{ tenantId, userId, isSuper }` — auth, tenant
   resolution and the platform allowlist are host vocabulary. Everything after
   that (memberships, roles, grants, governance) is read from the five tables
   the package owns. An impersonating host passes `permissionCeiling` (a set
   the resolved permissions are intersected with — it can only ever narrow)
   and forces `isSuper: false`.
2. **Identity crosses a directory port.** The roster needs an email and a name
   for a `user_id`; those live in the host's user table, so
   `directory.getUsers(ids)` hands them over by value. The roster's `q`
   keyword search needs `directory.searchUsers(q)`; omit it and the keyword is
   ignored (the filter simply doesn't narrow).
3. **Duck-typed DB, never a generated client.** `db` is a lazy provider of the
   structural `RbacDb` seam — a Prisma client satisfies it directly; the
   harness satisfies it with hand-written SQL. The argument shapes are CLOSED
   (documented in `src/server/db.ts`), so a non-Prisma host has a finite
   surface to fill.
4. **Billing stays outside.** The future-pay `POST /roles` entitlement gate
   (`team.custom_roles`) and the seat quota on member activation are answered
   in the host BEFORE the request reaches a descriptor. `resolveActor`
   receives no route identity, so a host gates by wrapping the mount per
   method+path — e.g. a tiny Hono middleware in front of the router:
   `app.on('POST', '/api/admin/:tenantSlug/roles', requireEntitlement(...))`
   registered before `app.route(...)`. The package must not learn about money.
5. **Invites are an optional port.** Accountless invites need a table and a
   signup hook this package does not own. Pass `invites: { invite,
   listPending, cancel }` to enable `POST /team` + invite rows in
   `GET /team/context`; without it those routes answer 501 and the packaged
   screen hides the affordance. The package reports `team.invite` /
   `team.invite_cancel` around the port calls; any richer trail of the port's
   own storage (acceptance at signup, expiry) is the port's to write.
6. **Audit is a sink, not a table.** Every write and every governance denial
   reports a `RbacAuditEntry` through `config.audit`, and the package FENCES
   every call — a throwing sink never turns the write (or a DENIAL) into a
   500. The flip side: the entry rides AFTER the transaction commits, so a
   crashed process can lose it. A host that needs an atomic, in-transaction
   trail keeps writing its own rows next to its data — the @12-apps/audit
   package (12-14) owns that seam.
7. **Route order is part of the surface.** `/team/context` and
   `/team/invites/:inviteId` are registered before `/team/:userId`; the Hono
   adapter mounts descriptors in array order. Another framework's adapter must
   preserve it.
8. **Seed roles at tenant creation.** Call `api.seedTenantRoles(tenantId)` in
   the host's tenant-creation transaction — idempotent (deterministic ids +
   `skipDuplicates`), derived from `config.tenantRoleSeeds`.
9. **Scope chains are config.** Flat tenants need nothing. An `org:` hierarchy
   passes `scopeParent` (synchronous) and `warmScope` (the async pre-load the
   sync walk reads from) — future-pay's client→org cache is the reference.

## The config, field by field

| Field | Required | Default | Notes |
|---|---|---|---|
| `db` | yes | — | lazy provider of the structural `RbacDb` seam (closed shapes in `src/server/db.ts`) |
| `catalog` | yes | — | `composePermissions(...).withRoles(...)` — the registry, the role templates, the governance catalog, the per-tenant seed rows and the merged labels, as ONE object |
| `directory` | yes | — | `getUsers(ids)`; optional `searchUsers(q)` (without it the roster's `q` is ignored) |
| `resolveActor` (hono) | yes | — | `{ tenantId, userId, isSuper }`; `null` → 401 |
| `assignableBaseRoles` | no | non-owner `roleTemplates` names | ENFORCED on `PATCH /team/:userId` before governance |
| `adminRoles` | no | `['OWNER', 'ADMIN']` | the coarse roster tier — future-pay vocabulary; a host with its own role names MUST set it |
| `ownerRoles` | no | `['OWNER']` | protected from disable/removal invariants |
| `customerRole` | no | `'CUSTOMER'` | the storefront membership excluded from the roster and the staff tier |
| `gatePermissions` | no | `roles:manage` / `team:read` / `team:manage` | the permission ids gating each surface |
| `audit` | no | — | the fenced sink (see rule 6) |
| `invites` | no | — | the optional port (see rule 5) |
| `scopeParent` / `warmScope` | no | flat scopes | `org:` chains (see rule 9) |
| `ownership` | no | none | entity-gate owner map for INSTANCE permissions |
| `expandAssignments` | no | identity | e.g. future-pay's sector → mesas expansion |
| `permissionsExtras` | no | `{}` | merged into `GET /permissions` (e.g. an entitlement snapshot) |
| `messages` | no | pt-BR product copy | every user-facing string, overridable per host |

The remaining defaults (`adminRoles`, `customerRole`, `gatePermissions`,
`messages`) are pt-BR/restaurant vocabulary because that is what this surface's
first host spoke, and every one of them is a field a second host overrides in
one line. What is NOT a default any more is the catalog: it used to be
future-pay's, so a host that passed its own registry to the server and said
nothing to the browser got a screen governed by a different application's
policy. There is nothing to fall back to now, and `catalog` is required on both
halves.

## Phase B — adopting into a host that ALREADY has these tables (future-pay)

The package migration unconditionally `CREATE TABLE`s the five tables, so a
host whose schema already carries them must **baseline** it rather than run
it: after the plugin-migration sync copies
`20260812120000_add_rbac_tables` into the host's migrations folder, mark it
applied (`prisma migrate resolve --applied 20260812120000_add_rbac_tables`)
before the next `migrate deploy`. Then reconcile the deliberate deltas:

- **CHECK constraints are dropped.** future-pay's `memberships_role_check`
  and `roles_kind_check` are host vocabulary; the package enforces the base
  role in code (`assignableBaseRoles`) instead. Keep the host CHECKs — they
  are compatible with everything the package writes.
- **Two partial indexes are required.** `resource_assignments_active_unique_idx`
  and the `WHERE valid_to IS NULL` form of the `(user_id, resource_type)` read
  index ship in the package migration; future-pay already has both, so the
  baseline covers them.
- **`DELETE /roles/:id` archives** — the same behaviour future-pay's route has
  through entity-lifecycle, but WITHOUT drafts/versions/approvals (12-17). The
  host keeps its lifecycle routes mounted for those until 12-17 lands.
- **The permissions endpoint**: pass `permissionsExtras` to keep serving the
  entitlement snapshot beside the permission set (FUT-131's one-round-trip
  contract).

## The endpoints

Mounted under whatever prefix the host chooses (future-pay uses
`/api/admin/:tenantSlug`). Every "admin tier" and "staff tier" gate requires
an **ACTIVE** membership: a soft-disabled member ("Desativar") holds no tier,
exactly as their permissions already resolve to nothing.

| Method | Path | Gate | Answers |
|---|---|---|---|
| GET | `/roles` | `roles:manage` | `{ data, pagination }` — `q`, `kind_in` (comma-sep), `sort`, `page`/`pageSize` |
| POST | `/roles` | `roles:manage` + governance | `{ data: role }`, 409 duplicate/reserved name, 400 governance |
| PATCH | `/roles/:id` | `roles:manage` + governance | `{ data: role }`, 404 stale/foreign id |
| DELETE | `/roles/:id` | `roles:manage` | `{ data: { status: 'deleted' } }` — an ARCHIVE (`archived_at` stamped): grants stop at once, the row and its member links survive for a restore surface (12-17); repeat is 404 |
| PUT | `/roles/templates/:name` | `roles:manage` + curated governance | `{ data: role }` (copy-on-write override) |
| DELETE | `/roles/templates/:name` | `roles:manage` + curated governance | `{ data: { status: 'reset' } }` (idempotent) — governance judges the SEED the reset would write, so a resetter can never restore a permission they do not themselves hold |
| GET | `/permissions` | staff tier | `{ data: { permissions, ...permissionsExtras } }` |
| GET | `/team` | admin tier (ACTIVE membership) | `{ data, pagination }` — `q`, `role_in`, `status_in`, `sort`, paging |
| POST | `/team` | admin tier + invites port | `{ data: { status: 'added' \| 'invited' } }`, 501 without the port |
| GET | `/team/context` | admin tier + `team:read` | custom roles by member, assignable roles, pending invites |
| GET | `/team/:userId` | admin tier + `team:read` | member detail, 404 reveals nothing |
| PATCH | `/team/:userId` | admin tier + `team:manage` + governance | base-role set — the name must be in `assignableBaseRoles` (default: non-owner template names; a custom role is 400 — additive roles ride POST /team/:userId/roles); 409 last owner |
| DELETE | `/team/:userId` | admin tier (owner rules inside) | `{ data: { status: 'removed' } }` |
| PATCH | `/team/:userId/status` | admin tier + `team:manage` | enable/disable; owner never disabled (TOCTOU-safe) |
| POST | `/team/:userId/roles` | `roles:manage` + governance | additive custom-role grant (idempotent) |
| DELETE | `/team/:userId/roles/:role` | `roles:manage` | revoke (idempotent) |
| DELETE | `/team/invites/:inviteId` | admin tier + `team:manage` + invites port | cancel a pending invite |

## Minimal host (Hono)

```ts
import { rbacRouter } from '@12-apps/rbac/hono';
import {
  composePermissions,
  RBAC_PERMISSIONS,
  type PermissionOf,
} from '@12-apps/rbac';
import { SHOP_PERMISSIONS, SHOP_ROLES } from './authz/permissions';

// Assembled ONCE, and shared with the React mount below.
export const CATALOG = composePermissions(
  RBAC_PERMISSIONS,        // this package's own roles/team surface
  SHOP_PERMISSIONS,        // your domain (and any other package's contribution)
).withRoles({
  roles: SHOP_ROLES,
  ownerRoles: ['OWNER'],
  leafOnlyRoles: ['MANAGER'],
});
export type ShopPermission = PermissionOf<typeof CATALOG>;

const rbac = rbacRouter({
  db: async () => prisma,                    // structural RbacDb
  catalog: CATALOG,
  directory: {
    getUsers: (ids) => users.byIds(ids),
    searchUsers: (q) => users.searchIds(q),
  },
  audit: (entry) => auditLog.write(entry).catch(() => undefined),
  resolveActor: async (c) => {
    const session = await readSession(c);
    if (!session) return null;
    const tenantId = await tenantIdBySlug(c.req.param('tenantSlug'));
    return { tenantId, userId: session.userId, isSuper: session.isSuper };
  },
});

app.route('/api/admin/:tenantSlug', rbac.router);
// rbac.guards / rbac.engine / rbac.seedTenantRoles are the same wiring for
// the rest of the host's surfaces.
```

## Minimal host (React)

```tsx
import { createWebRbac } from '@12-apps/rbac/react';
import { CATALOG } from './authz/catalog';

const { page: RbacAdmin } = createWebRbac({
  apiBase: `/api/admin/${tenantSlug}`,
  catalog: CATALOG,   // the SAME object the server mount received
});
// <RbacAdmin /> renders Papéis + Equipe; or take RolesScreen / TeamScreen
// individually and put them behind your own routes.
```

The catalog is shared rather than re-declared on purpose: the picker's groups,
its labels, its owner markers and its SoD pairs must be the ones the endpoints
enforce, and one assembly is the only arrangement in which they cannot drift.

## What deliberately did NOT move into the package

- **Entity-lifecycle wrapping of role writes** (drafts / versions / restore /
  approvals) — that surface belongs to `@12-apps/entity-lifecycle` (12-17).
  The package does plain CRUD with soft-delete-aware reads (`archived_at` is
  respected everywhere it grants).
- **Seat quotas and plan entitlements** — billing (host).
- **Invite storage and the signup hook** — the optional invites port.
- **The impersonation machinery** — 12-24; the ceiling seam here is its
  attachment point. The guards treat a `permissionCeiling` as authoritative:
  an actor carrying one is never `isSuper`, even if the host forgot to force
  the flag off.
- **The member PROFILE page** (`member-details-tab`, `member-role`,
  `member-since`, `member-last-login`, `member-custom-roles` in the future-pay
  admin). `GET /team/:userId` returns all of its data; the screen itself did
  not move. Same for the loading/error/status test ids of the DataViews grids
  — the packaged screens render plain tables.

## Migrating from 1.x — the catalog left the package

`@12-apps/rbac` 1.x exported an application's permission catalog and role
matrix: `FUTURE_PAY_PERMISSIONS` (61 ids), `DEFAULT_ROLE_TEMPLATES` (eight
roles), `FUTURE_PAY_GOVERNANCE`, `FUTURE_PAY_SOD_PAIRS`,
`FUTURE_PAY_LEAF_ONLY_ROLES`, `FUTURE_PAY_PLATFORM_ONLY_ROLES`,
`CLIENT_CAPABILITIES`, `futurePayTenantRoleSeeds()` and the
`FuturePayPermission` union. All of it is gone in 2.0.0, and so is
`createWebRbac`'s habit of falling back to it.

**A deprecation shipment was the alternative and it was rejected**: keeping
those exports for one more minor would have kept the thing this release exists
to remove, on an unbounded timeline, for exactly one consumer — one that pins
EXACT versions and therefore cannot be surprised by a major. The pin is the
insulation; a `@deprecated` tag is not.

| 1.x | 2.0.0 |
| --- | --- |
| `FUTURE_PAY_PERMISSIONS` | your own `definePermissionContribution(...)`, composed with `RBAC_PERMISSIONS` |
| `DEFAULT_ROLE_TEMPLATES` | your own `RoleDef<P>[]`, passed to `.withRoles({ roles })` |
| `FUTURE_PAY_GOVERNANCE` | `CATALOG.governance` |
| `FUTURE_PAY_SOD_PAIRS` | `separateFrom` on the declaring permission |
| `FUTURE_PAY_LEAF_ONLY_ROLES` | `.withRoles({ leafOnlyRoles })` |
| `FUTURE_PAY_PLATFORM_ONLY_ROLES` | `.withRoles({ platformOnlyRoles })` |
| `futurePayTenantRoleSeeds()` | `CATALOG.tenantRoleSeeds` |
| `FuturePayPermission` | `PermissionOf<typeof CATALOG>` |
| `CLIENT_CAPABILITIES` | a host constant — it was never a role assignment |
| `config.permissions` / `roleTemplates` / `governance` / `tenantRoleSeeds` | `config.catalog` |
| `createWebRbac({ apiBase })` | `createWebRbac({ apiBase, catalog })` |
| `RbacLabelOverrides` | `RbacLabelVocabulary` (segment maps + `permissions` + `roles`) |
| `FUTURE_PAY_RBAC_GUARDS` / `FUTURE_PAY_ENTITLEMENT_GUARDS` | required `rbacGuards` / `entitlementGuards` options |

The pt-BR label dictionaries left with the catalog too: the words `Produtos`,
`Mesas`, `Cozinha` and `Comprador` describe a restaurant, not authorization.
The label COMPOSER stayed, unchanged in behaviour — labels are still built from
a permission's colon-separated segments, and an unlabelled segment still falls
back to its raw text, so a permission nobody has translated renders
untranslated rather than disappearing. Ship your vocabulary in your
contribution's `labels`, and your role names in `.withRoles({ roleLabels })`.
This package keeps only its own two domains (`Papéis`, `Equipe`).

Nothing about the DB changes: the five owned tables, their migrations and the
`roles.permissions` string codec are untouched, so 2.0.0 is a code migration
with no data migration behind it.
