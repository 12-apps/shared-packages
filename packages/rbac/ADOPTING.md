# Adopting @12-apps/rbac

This package is a **plug-and-play authorization plugin** (12-13): one library,
reusable across repositories, exposing standardized surfaces. A host repo only
*points* at these surfaces — when the library updates, every host updates with
**no app changes**. The contract is the same one `@12-apps/report-builder` and
`@12-apps/payments-*` established.

## The standardized plugin surfaces

| Surface | Export | What the host does |
|---|---|---|
| **Core engine** | `@12-apps/rbac` | Nothing to wire — the framework-free PDP (`createRbac`), registry (`definePermissions`), caveats, governance validator (`validateGrant`), role templates and tenant-role seeds. |
| **Server** | `@12-apps/rbac/server` | Call `createApiRbac(config)` and mount the `routes` it returns — role CRUD, template overrides, `GET /permissions` and the whole team roster, with parsing, statuses, governance and the envelope inside. Also returns the **guard helpers** (`guards.requirePermission`, `getActorPermissions`, `visibleResources`, `listVisibility`), the grant governance and the stores, so every OTHER host surface authorizes through the same wiring. |
| **Hono** | `@12-apps/rbac/hono` | `const rbac = rbacRouter({ ...serverConfig, resolveActor }); app.route('/api/admin/:tenantSlug', rbac.router)`. A one-call mount; `hono` is an OPTIONAL peer, so importing the root or `/server` never resolves it. |
| **React** | `@12-apps/rbac/react` | Call `createWebRbac({ apiBase })` and mount the `page` it returns (Papéis + Equipe), or route `RolesScreen` / `TeamScreen` yourself. Built on the same `RbacProvider`/`useCan` context the package always shipped. |
| **Coverage gate** | `@12-apps/rbac/coverage` | Your `rbac:coverage` script becomes a one-line re-export: `rbacCoverageCli({ appDir, exclusionsPath })`. The CI workflow that shells out to the consumer's package script keeps working unchanged. |
| **Prisma** | `prisma/rbac.prisma` + `prisma/migrations/*` | Run `pnpm --filter @12-apps/rbac prisma:sync -- <host schema dir>` (or wire your own copy script): the partial is **COPIED** into the host's multi-file schema folder — never symlinked (a symlinked migration is silently skipped by Prisma; a symlinked partial dangles under `turbo prune`). Migrations are discovered structurally from the installed package's `prisma/migrations` by the host's plugin-migration sync. |

## Host wiring rules (the ones that bite)

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
   in the host — in `resolveActor` or a wrapper — BEFORE the request reaches a
   descriptor. The package must not learn about money.
5. **Invites are an optional port.** Accountless invites need a table and a
   signup hook this package does not own. Pass `invites: { invite,
   listPending, cancel }` to enable `POST /team` + invite rows in
   `GET /team/context`; without it those routes answer 501 and the packaged
   screen hides the affordance.
6. **Audit is a sink, not a table.** Every write and every governance denial
   reports a `RbacAuditEntry` through `config.audit`. The sink must swallow
   its own failures — a failed log can never turn a DENIAL into a 500.
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

## The endpoints

Mounted under whatever prefix the host chooses (future-pay uses
`/api/admin/:tenantSlug`):

| Method | Path | Gate | Answers |
|---|---|---|---|
| GET | `/roles` | `roles:manage` | `{ data, pagination }` — `q`, `kind_in` (comma-sep), `sort`, `page`/`pageSize` |
| POST | `/roles` | `roles:manage` + governance | `{ data: role }`, 409 duplicate/reserved name, 400 governance |
| PATCH | `/roles/:id` | `roles:manage` + governance | `{ data: role }`, 404 stale/foreign id |
| DELETE | `/roles/:id` | `roles:manage` | `{ data: { status: 'deleted' } }` |
| PUT | `/roles/templates/:name` | `roles:manage` + curated governance | `{ data: role }` (copy-on-write override) |
| DELETE | `/roles/templates/:name` | `roles:manage` | `{ data: { status: 'reset' } }` (idempotent) |
| GET | `/permissions` | staff tier | `{ data: { permissions, ...permissionsExtras } }` |
| GET | `/team` | admin tier | `{ data, pagination }` — `q`, `role_in`, `status_in`, `sort`, paging |
| POST | `/team` | admin tier + invites port | `{ data: { status: 'added' \| 'invited' } }`, 501 without the port |
| GET | `/team/context` | admin tier + `team:read` | custom roles by member, assignable roles, pending invites |
| GET | `/team/:userId` | admin tier + `team:read` | member detail, 404 reveals nothing |
| PATCH | `/team/:userId` | admin tier + `team:manage` + governance | base-role set; 409 last owner |
| DELETE | `/team/:userId` | admin tier (owner rules inside) | `{ data: { status: 'removed' } }` |
| PATCH | `/team/:userId/status` | admin tier + `team:manage` | enable/disable; owner never disabled (TOCTOU-safe) |
| POST | `/team/:userId/roles` | `roles:manage` + governance | additive custom-role grant (idempotent) |
| DELETE | `/team/:userId/roles/:role` | `roles:manage` | revoke (idempotent) |
| DELETE | `/team/invites/:inviteId` | admin tier + `team:manage` + invites port | cancel a pending invite |

## Minimal host (Hono)

```ts
import { rbacRouter } from '@12-apps/rbac/hono';
import {
  DEFAULT_ROLE_TEMPLATES,
  FUTURE_PAY_GOVERNANCE,
  FUTURE_PAY_PERMISSIONS,
  futurePayTenantRoleSeeds,
} from '@12-apps/rbac';

const rbac = rbacRouter({
  db: async () => prisma,                    // structural RbacDb
  permissions: FUTURE_PAY_PERMISSIONS,       // or your own definePermissions()
  roleTemplates: DEFAULT_ROLE_TEMPLATES,     // or your own catalog
  governance: FUTURE_PAY_GOVERNANCE,
  tenantRoleSeeds: futurePayTenantRoleSeeds(),
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

const { page: RbacAdmin } = createWebRbac({
  apiBase: `/api/admin/${tenantSlug}`,
});
// <RbacAdmin /> renders Papéis + Equipe; or take RolesScreen / TeamScreen
// individually and put them behind your own routes.
```

## What deliberately did NOT move into the package

- **Entity-lifecycle wrapping of role writes** (drafts / versions / restore /
  approvals) — that surface belongs to `@12-apps/entity-lifecycle` (12-17).
  The package does plain CRUD with soft-delete-aware reads (`archived_at` is
  respected everywhere it grants).
- **Seat quotas and plan entitlements** — billing (host).
- **Invite storage and the signup hook** — the optional invites port.
- **The impersonation machinery** — 12-24; the ceiling seam here is its
  attachment point.
