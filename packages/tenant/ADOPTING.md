# Adopting @12-apps/tenant

Two halves, one factory each, one config object each. Nothing is optional.

```ts
// backend
import { createApiTenant } from '@12-apps/tenant/server';
import { mountTenant } from '@12-apps/tenant/hono';

const tenant = createApiTenant({ statuses, ids, copy, port });
mountTenant(app, tenant); // mounts nothing yet: the routes arrive with the lifecycle

// frontend
import { createWebTenant } from '@12-apps/tenant/react';

const tenantUi = createWebTenant({ statuses, ids, copy });
```

Both throw a `TenantConfigError` at startup when a piece is missing or bad. Its
`key` is the dotted path (`ids.refusals.gone`, `copy.locales.pt-BR.closeWarning`,
`port.timeZone`), and its message says what is wrong with it.

## 1.0 — the contract, the port and the tables

Adopting this release changes no behaviour: the factories validate and hand back
readings, and the two new tables are created empty and read by nothing.

### The status set

```ts
const statuses = {
  all: ['ACTIVE', 'CLOSING', 'CLOSED', 'SUSPENDED', 'PENDING'], // every value your row may hold
  active: 'ACTIVE',
  closing: 'CLOSING',
  closed: 'CLOSED',
};
```

`all` lists every status, not only the three the package acts on: the package
leaves any other status alone and never assumes there are none. The three roles
must be distinct and listed in `all`.

### The ids

Pass the ids your clients and your audit trail already use; the package never
makes one up, and two acts in one group may not share an id.

```ts
const ids = {
  refusals: { closing, closed, readOnly, gone },
  audit: { closeScheduled, closeReopened, closePurged, afterCloseFailed, exportRequested, exportDownloaded },
  notifications: { closingScheduled, closingWeek, closingDay, exportReady },
  permissions: { close },
};
```

### The copy packs

One pack per locale, every key of `TENANT_COPY_KEYS`, each a whole sentence in
your own vocabulary. `defaultLocale` must be one of the packs; `copyFor(locale)`
answers it when the asked locale has no pack.

```ts
const copy = { locales: { 'pt-BR': ptBR, 'en-US': enUS }, defaultLocale: 'pt-BR' };
```

### The tenant port (backend only)

```ts
const port: TenantPort<Status, Tx> = {
  bySlug: (slug) => …,               // { id, slug, status } | null
  byId: (id) => …,                   // { id, slug, status } | null
  setStatusIf: (id, from, to) => …,  // compare-and-set: true only when the row moved
  clearProfile: (tx, id) => …,       // erase the row's profile inside the purge's transaction
  timeZone: (id) => …,               // IANA zone
  treeNode: (id) => …,               // { id, parentId, path } | null — one read
  treeAncestors: (id) => …,          // the node and every node above it — one read
  treeDescendants: (id) => …,        // the node and every node below it — one read
  moveSubtree: (move) => …,          // apply a planned move — one statement, rows written
};
```

`setStatusIf` must be a real compare-and-set (`UPDATE … WHERE id = $1 AND status
= $2`, answering whether a row changed): the lifecycle relies on it to make each
step happen once.

### The tenant tree

A tenant may sit under another (ownership only, any depth: a company above its
units, a unit above its venues). Store three columns on your tenant row: the
parent's id (NULL for a standalone tenant), the **materialized path** and,
if you want one, your own unit code. The package computes and validates every
path; you store it and apply what it plans.

- **The path** is `/<root id>/…/<own id>/`; a standalone tenant's is
  `/<own id>/`, so backfilling an existing table makes every row a root.
  Ids must not contain `/`.
- **`treeAncestors(id)`**: ONE read of the rows whose ids are the segments of
  the tenant's own path (a primary-key read; nothing recurses).
- **`treeDescendants(id)`**: ONE read of the rows whose path starts with the
  tenant's own, served by an index on the path. With a byte-ordered collation
  (Postgres `COLLATE "C"`) the prefix is exactly the range
  `path >= p AND path < p-minus-its-last-"/" || '0'`.
- **`moveSubtree(move)`**: ONE statement that replaces the prefix
  `move.fromPath` with `move.toPath` on every row under it and re-points the row
  `move.id` at `move.parentId`, applied ONLY while that row's path is still
  `fromPath` and the parent's is still `parentPath` (lock the parent row in the
  same statement). Answer the rows written; 0 tells the package the tree moved
  under its plan, and it refuses the move by name.
- **Hold the row to its path** in the database too: a path that names the row
  once and last, and is `/<own id>/` exactly when there is no parent, so no
  writer can store a cycle.

`tenant.tree` (`createApiTenant`) answers `parentOf`, `rootOf`, `ancestorsOf`,
`descendantsOf` (one port call each, at any depth) and `move(id, parentId)`,
which refuses a cycle (`TenantTreeError`, code `cycle`) before anything is
written.

A grant across a tree is your authorization's business, not the package's.
Keep it distinguishable from a grant on the parent tenant itself: a scope
that names "the tenants below X" must never be the same string as X's own.

### The schema and the migration

- Copy the partial into your schema folder with
  `pnpm --filter @12-apps/tenant prisma:sync` (`prisma:sync:check` fails on
  drift). It is COPIED, never symlinked.
- The migration (`prisma/migrations/20261126120000_tenant_closings_and_exports`)
  is discovered from the installed package like every other `@12-apps/*`
  migration. It is additive: two new tables, no foreign key into yours.
- Moving existing closing or export rows into these tables is your own
  expand-and-contract: copy and dual-write from the release that first writes
  them, and drop your old tables only in a later release.
