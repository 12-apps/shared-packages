# Adopting @12-apps/entity-lifecycle

This package is a **plug-and-play lifecycle plugin** (12-17): one library,
reusable across repositories, exposing standardized surfaces. A host repo only
*points* at these surfaces — when the library updates, every host updates with
**no app changes**. The contract is the same one `@12-apps/report-builder`,
`@12-apps/rbac` and `@12-apps/payments-*` established.

What it gives a host, per registered collection: diff-based **version history**
with restore and retention, a **recycle bin** (soft delete with a dependent
tree), per-item **drafts**, and **change approvals** (writes by non-approvers
park as requests) — endpoints and screens included, GENERATED from one
declaration per collection rather than hand-written per entity.

## The standardized plugin surfaces

| Surface | Export | What the host does |
|---|---|---|
| **Core engine** | `@12-apps/entity-lifecycle` | Nothing to wire — the framework-free kernel: `createEntityLifecycle`, `resolveFeature`, diff/versioning, the store contracts and the in-memory adapters. |
| **Server** | `@12-apps/entity-lifecycle/server` | Call `createApiEntityLifecycle({ db, entities, directory })` and mount the `routes` it returns — the versions / restore / drafts / recycle-bin / approvals endpoints for EVERY registered collection, with parsing, statuses, feature gates, approvals interception and the `{ data }` envelope inside. Also returns `entity(type)` — the handle the host's OWN entity routes use to funnel create/update/delete through the same machinery — and the `stores` bundle. |
| **Hono** | `@12-apps/entity-lifecycle/hono` | `const lifecycle = entityLifecycleRouter({ ...serverConfig, resolveActor }); app.route('/api/admin/:tenantSlug', lifecycle.router)`. A one-call mount; `hono` is an OPTIONAL peer, so importing the root, `/server` or `/react` never resolves it. |
| **React** | `@12-apps/entity-lifecycle/react` | Call `createWebEntityLifecycle({ apiBase })` and mount the `page` it returns (Lixeira + Aprovações behind the package's own tabs), or route `RecycleBinScreen` / `ApprovalsScreen` yourself. `VersionHistoryDialog` and `DraftBanner` are per-entity pieces you drop INTO your own editors, already bound to the same wire client. pt-BR product copy and the future-pay test ids ship inside. |
| **Prisma** | `prisma/entity-lifecycle.prisma` + `prisma/migrations/*` | Run `pnpm --filter @12-apps/entity-lifecycle prisma:sync -- <host schema dir>`: the partial is **COPIED** into the host's multi-file schema folder — never symlinked (a symlinked migration is silently skipped by Prisma; a symlinked partial dangles under `turbo prune`). Migrations are discovered structurally from the installed package's `prisma/migrations` by the host's plugin-migration sync. |

## Host wiring rules (the ones that bite)

1. **The host resolves WHO and WHICH TENANT; the package resolves the rest.**
   `resolveActor` answers a `LifecycleActor`: `tenantId`, `userId`, the
   caller's resolved `permissions`, optional `isSuper` — and the tenant's two
   **feature layers** (`entitlements` = the plan layer, `settings` = the
   config-panel toggles). The layers ride the actor because they are tenant
   state the host owns (future-pay keeps them as two JSON columns on its
   tenant row); the package never reads a tenant table it cannot know the
   shape of. `null` → 401 before any handler runs.
2. **A registration is a DECLARATION.** future-pay wrote ~7 route files and a
   registration module per collection (eleven collections, 2.8k LOC); here a
   collection is one `LifecycleEntityRegistration` object and the endpoints
   are generated. A second collection is a second entry in `entities` and
   **zero** new host routes.
3. **Entity writes stay the host's, through `EntityOps`.** The package owns
   everything recorded ABOUT an entity (versions, bin entries, drafts,
   requests); the host owns the entity tables themselves. `readSnapshot` /
   `applySnapshot` / `archive` / `unarchive` / `hardDelete` (+ optional
   `collectChildren` for the bin tree and `onVersionRecorded` for a mirrored
   version column) are the closed seam. **Soft-delete visibility is the
   ops' job and must be explicit**: `readSnapshot` and every list the host
   feeds from its own tables filter `archived_at IS NULL` (or the host's
   equivalent) deliberately — the package cannot see the host's schema, so
   nothing here can add that filter for you.
4. **Duck-typed DB, never a generated client.** `db` is a lazy provider of the
   structural `LifecycleDb` seam over the four owned tables — a Prisma client
   satisfies it directly ($transaction included); the harness satisfies it
   with hand-written SQL. The argument shapes are CLOSED (documented in
   `src/server/db.ts`), so a non-Prisma host has a finite surface to fill.
   Reads on the owned tables are deliberate about visibility: the bin list
   filters `status = 'DELETED'` explicitly, drafts filter `status = 'OPEN'`
   explicitly — nothing relies on a host client's default filters.
5. **Billing stays outside.** future-pay's per-collection plan gate
   (`requireEntitlement(tenant, 'suppliers')`) is answered in the host BEFORE
   a request reaches a descriptor — wrap the mount per path prefix, exactly
   like the rbac adoption does. The feature layers on the actor are the
   *lifecycle-feature* gate (versioning/drafts/approvals per tenant), not the
   collection's billing gate.
6. **Approvals authorize against the actor's permission ids.** Each
   registration names its `approvePermission` ("products:approve"); the
   package narrows against `actor.permissions` and `isSuper` bypasses. Omit
   it and only `isSuper` can decide. The package never computes permissions —
   that is `@12-apps/rbac`'s job (or the host's).
7. **Route order is part of the surface.** The literal `/drafts` routes are
   emitted BEFORE the `/:id` ones so an adapter that mounts in array order can
   never capture "drafts" as an entity id. The Hono adapter preserves
   descriptor order; another framework's adapter must too.
8. **Identity crosses a directory port.** History, bin and approvals lists
   show "who", not a UUID: `directory.getUsers(ids)` hands names over by
   value. Optional — without it every actor renders as the system fallback.
9. **The host's own CRUD funnels through `entity(type)`.** A create/update/
   delete route the host already has calls
   `api.entity('product').lifecycle.update(ctx, id, snapshot)` with
   `ctx = api.entity('product').context(actor)` — that is what records the
   version, lands the delete in the bin, or parks the write (answer 200 when
   `applied`, 202 when parked; `writeOutcome()` shapes the body).

## `createApiEntityLifecycle` config, field by field

| Field | Required | Default | Notes |
|---|---|---|---|
| `db` | yes | — | lazy provider of the structural `LifecycleDb` seam (closed shapes in `src/server/db.ts`) |
| `entities` | yes | — | one `LifecycleEntityRegistration` per collection (below) |
| `directory` | no | system fallback names | `getUsers(ids)` — actor names on history/bin/approvals |
| `messages` | no | pt-BR product copy | every user-facing string, overridable per host |
| `resolveActor` (hono) | yes | — | `LifecycleActor` or `null` (→ 401); includes the tenant's two feature layers |

### `LifecycleEntityRegistration`

| Field | Required | Notes |
|---|---|---|
| `entityType` | yes | stable type key persisted on every record (`"product"`) |
| `slug` | yes | URL segment of the generated routes (`"products"`); unique, and never `recycle-bin` / `approvals` |
| `features` | yes | which flaggable features the collection supports in code (`{ versioning, drafts, approvals }`) |
| `featureDefaults` | no | tenant-toggle default per feature when entitled but never touched (default: on) |
| `label` | yes | `(snapshot) => string` — the human label in history/bin UIs |
| `diff` | no | ignored fields etc. (`DiffOptions`) |
| `retention` | no | version auto-clean (`{ maxVersions, maxAgeDays }`) with safe compaction |
| `approvePermission` | no | the permission id that may DECIDE this collection's approvals; omitted = only `isSuper` |
| `ops` | yes | the host's `EntityOps` (rule 3) |
| `publishedVersion` | no | read back a mirrored version column for the history dialog's "Versão atual"; defaults to the highest recorded version |

### `createWebEntityLifecycle` config

| Field | Required | Default | Notes |
|---|---|---|---|
| `apiBase` | yes | — | the admin mount the routes live under (`/api/admin/minha-loja`) |
| `transport` | no | same-origin `fetch` | the ONLY way the screens perform I/O — substitute it and you have substituted the backend |
| `entityTypeLabels` | no | future-pay's pt-BR catalog | merged over the defaults; unknown types render as their raw key |

The defaults are future-pay's vocabulary on purpose (the same posture as
rbac's): future-pay adopts with near-zero config, and any other host reviews
these tables once and names its own.

## The endpoints

Mounted under whatever prefix the host chooses (future-pay uses
`/api/admin/:tenantSlug`). Per registration (`:slug` below is the
registration's own slug), in mount order:

| Method | Path | Answers |
|---|---|---|
| GET | `/:slug/drafts` | `{ data: { drafts } }` — the tenant's OPEN drafts for the collection |
| POST | `/:slug/drafts` | `{ data: { draft } }` — starts a NEW-item draft (`entityId: null`); body `{ data: <snapshot> }` |
| POST | `/:slug/drafts/:draftId/publish` | `{ data: { applied, entityId, requestId } }` — 200 applied / 202 parked for approval |
| DELETE | `/:slug/drafts/:draftId` | bodyless 204 — discard (live record untouched; row kept as DISCARDED) |
| GET | `/:slug/:id/draft` | `{ data: { draft } }` (or `draft: null`) — the item's OPEN draft |
| PUT | `/:slug/:id/draft` | `{ data: { draft } }` — create/update WITHOUT touching the live record |
| GET | `/:slug/:id/versions` | `{ data: { versions, publishedVersion } }` — newest first, actor names resolved |
| POST | `/:slug/:id/versions/:version/restore` | `{ data: { applied, entityId, requestId } }` — 200 applied / 202 parked |

Shared, dispatched across every registered collection by the record's own
`entityType`:

| Method | Path | Answers |
|---|---|---|
| GET | `/recycle-bin` | `{ data: { entries } }` — DELETED roots, newest first, each with its dependent tree; `?entityType=` narrows |
| POST | `/recycle-bin/:entryId/restore` | bodyless 204 — un-archives the record, flips the tree to RESTORED |
| DELETE | `/recycle-bin/:entryId` | bodyless 204 — hard delete; the row is kept, flipped to PURGED (audit trail) |
| GET | `/approvals` | `{ data: { requests } }` — default PENDING; `?status=` for the decided lists |
| POST | `/approvals/:requestId/approve` | `{ data: { applied, … } }` — applies the parked write, attributed to the author; 403 non-approver, 409 lost decide race |
| POST | `/approvals/:requestId/reject` | bodyless 204 — body `{ note? }` (≤500 chars); record untouched, kept as REJECTED |

Errors are the pt-BR product copy over `{ error }` — 404s per resource, 403
for a feature that is off for the tenant or a denied approval, 422 for an
entry/request whose collection is not registered, 400 for a malformed body.

## Minimal host (Hono)

```ts
import { entityLifecycleRouter } from '@12-apps/entity-lifecycle/hono';

const lifecycle = entityLifecycleRouter({
  db: async () => prisma,                 // structural LifecycleDb
  entities: [
    {
      entityType: 'product',
      slug: 'products',
      features: { versioning: true, drafts: true, approvals: true },
      label: (s) => (typeof s.name === 'string' && s.name ? s.name : 'Produto'),
      retention: { maxVersions: 50, maxAgeDays: 365 },
      approvePermission: 'products:approve',
      ops: productOps,                    // the host's tables, its rules
      publishedVersion: (tenantId, id) => readPublishedVersion(tenantId, id),
    },
    // a second collection = a second entry; zero new host routes
  ],
  directory: { getUsers: (ids) => users.byIds(ids) },
  resolveActor: async (c) => {
    const session = await readSession(c);
    if (!session) return null;
    const tenant = await tenantBySlug(c.req.param('tenantSlug'));
    return {
      tenantId: tenant.id,
      userId: session.userId,
      entitlements: tenant.lifecycleEntitlements,  // plan layer
      settings: tenant.lifecycleSettings,          // config-panel layer
      permissions: await resolvePermissionIds(session, tenant),
      isSuper: session.isSuper,
    };
  },
});

app.route('/api/admin/:tenantSlug', lifecycle.router);

// The host's own entity routes funnel through the same machinery:
const products = lifecycle.entity('product');
const result = await products.lifecycle.update(products.context(actor), id, snapshot);
```

## Minimal host (React)

```tsx
import { createWebEntityLifecycle } from '@12-apps/entity-lifecycle/react';

const lifecycle = createWebEntityLifecycle({ apiBase: `/api/admin/${tenantSlug}` });
// <lifecycle.page /> renders Lixeira + Aprovações; or take the screens
// individually. In your own editors:
//   <lifecycle.DraftBanner slug="products" draft={draft} … />
//   <lifecycle.VersionHistoryDialog resourcePath={`products/${id}`} … />
```

## Phase B — adopting into a host that ALREADY has these tables (future-pay)

The package migration unconditionally `CREATE TABLE`s the four tables, so a
host whose schema already carries them (future-pay's
`20260722120000_add_entity_lifecycle`) must **baseline** it rather than run
it: after the plugin-migration sync copies
`20260813120000_add_entity_lifecycle_tables` into the host's migrations
folder, mark it applied
(`prisma migrate resolve --applied 20260813120000_add_entity_lifecycle_tables`)
before the next `migrate deploy`. Then reconcile the deliberate deltas:

- **The `clients` FKs are dropped in the package migration** — `client_id` is
  a by-value scalar here because the package cannot know a host's tenant
  table. future-pay's existing FKs (`ON DELETE CASCADE`) are compatible with
  everything the package writes; keep them.
- **The tenant feature layers stay host columns.** `lifecycle_entitlements` /
  `lifecycle_settings` on `clients` are host state; the actor carries them by
  value (rule 1). The RBAC `products:approve` backfill and the
  `products.published_version` mirror column in future-pay's original
  migration are host vocabulary too — the mirror is fed through
  `ops.onVersionRecorded` and read back through `publishedVersion`.
- **The eleven registration modules collapse into declarations.** Each
  `apps/web/lib/lifecycle/<collection>.ts` becomes one `entities` entry; the
  per-collection route files under `app/api/admin/[tenantSlug]/**` are
  deleted or, where a coverage gate forces them to exist (the MCP tool → route
  map), kept as pure declarations that re-export from the mounted router —
  with a comment naming the gate.
- **Snapshot shape is unchanged** — the version/draft/request payloads the
  package reads and writes are the same loose JSON future-pay recorded, so
  existing history replays without conversion.
- **The admin pages** (`pages/recycle-bin`, `pages/approvals`, the shared
  `VersionHistoryDialog`, the product draft banner) become mounts of the
  packaged screens; test ids and pt-BR copy are preserved, so the colocated
  `.e2e.ts` specs keep passing. The Dashboard chrome (breadcrumb, header,
  info) stays host-side — the packaged export is the screen, not the page
  frame.
- **base-app adoption** (feature flag OFF by default in `lib/features.ts`) is
  a follow-up tracked by the ticket; the flag gates the mount call, nothing
  else.

## What deliberately did NOT move into the package

- **Per-collection entitlement/billing gates** — host (rule 5).
- **Snapshotting host entities** (future-pay's `product-snapshot.ts` etc.) —
  that is `EntityOps.readSnapshot` / `applySnapshot`: the host's schema, the
  host's write model, including reference re-validation on restore (the
  current schema always wins; an old snapshot can never write a column that
  no longer exists).
- **Permission RESOLUTION** — `@12-apps/rbac` (or the host); this package only
  narrows against the resolved ids.
- **The retention sweep scheduler** — retention runs inline on writes via the
  policy; a host wanting a background sweep drives the same service from its
  own jobs runtime (`@12-apps/jobs`).
