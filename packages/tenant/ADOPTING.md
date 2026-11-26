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

Both keep a deep-frozen COPY of the data parts (statuses, ids, copy): your own
objects are never frozen, and changing them after startup changes nothing.
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
  closableFrom: ['ACTIVE', 'SUSPENDED'], // the statuses a close may start from
};
```

`all` lists every status, not only the ones the package acts on: the package
leaves any other status alone and never assumes there are none. The three roles
must be distinct and listed in `all`. `closableFrom` is non-empty, listed in
`all`, and never names `closing` or `closed`; a close records the status it
started from (`prior_status`) and a reopen restores it.

### The ids

Pass the ids your clients and your audit trail already use; the package never
makes one up, and two acts in one group may not share an id.

```ts
const ids = {
  refusals: {
    closing, closed, readOnly, gone,                         // a closing or closed tenant keeps a request out
    reasonTooShort, nameMismatch, alreadyClosing, notActive, // a close refused
    closingBlocked, purged, notClosing,                      // ...and a reopen refused
    exportNeedsPerson, exportNotFound, exportExpired,        // the data export refused
  },
  audit: { closeScheduled, closeReopened, closePurged, afterCloseFailed, exportRequested, exportDownloaded },
  notifications: { closingScheduled, closingWeek, closingDay, reopened, exportReady }, // a failed export rides on exportReady
  permissions: { close },
};
```

### The copy packs

One pack per locale (`TenantCopyPack`), every key of `TENANT_COPY_SHAPE`, each
a whole sentence in your own vocabulary:

- **notices** (inbox and e-mail; the title is the subject): a title and a body
  for scheduled, a week left, a day left, reopened, export ready and export
  failed;
- **refusals**: one sentence per refusal code (`refusalBlocked(count)` writes
  its own plural);
- **the close page, the banner and the refusal screens**: titles, buttons,
  warnings and notes, with `blocker(kind, count)` and `shortcut(kind)` for your
  own blocker kinds;
- **the platform's view**: `platformCancelClosing`, `platformClosingNote`.

A `text` key is a non-empty string; a `sentence` key is a function that returns
the whole sentence from the values it is given (a name, a count, a day already
formatted for the locale in the tenant's time zone). `defaultLocale` must be one
of the packs; `copyFor(locale)` answers it when the asked locale has no pack.

```ts
const copy = { locales: { 'pt-BR': ptBR, 'en-US': enUS }, defaultLocale: 'pt-BR' };
```

### The tenant port (backend only)

```ts
const port: TenantPort<Status, Tx> = {
  bySlug: (slug) => …,                   // the CURRENT slug only: { id, slug, status } | null
  byId: (id, tx) => …,                   // on tx when given: { id, slug, status } | null
  setStatusIf: (id, from, to, tx) => …,  // compare-and-set ON tx: true only when the row moved
  clearProfile: (tx, id) => …,           // erase the row's profile, on tx
  timeZone: (id) => …,                   // IANA zone
};
```

- **Run every write on the `tx` you are given**, never on a client of your own.
  A close flips the status, recounts your blockers, writes its own row and the
  audit line in ONE transaction: a blocker found after the flip rolls the flip
  back only if the flip ran on that transaction.
- **`setStatusIf` is a real compare-and-set** (`UPDATE … SET status = $to WHERE
  id = $id AND status = $from` on `tx`, answering whether a row changed): the
  lifecycle relies on it to make each step happen once.
- **`byId` reads on `tx` when one is given**, so a refusal inside the
  transaction sees the status the transaction sees.
- **`bySlug` resolves the tenant's current slug only.** A former slug you keep
  is not answered here: kept slugs go through the slug port (below).

### The tenant tree (opt-in)

A tenant may sit under another (ownership only, any depth: a company above its
units, a unit above its venues). **The tree is optional.** A host with no tree
passes no `tree` and gets no `tenant.tree` (`createApiTenant` leaves the key
out); a host written for a release before the tree boots unchanged, since none
of the tree's methods is on the tenant port. A host that wants it passes its
own port as `tree`, and then all four members are required and checked at
startup (`TenantConfigError`, key `tree.<method>`):

```ts
const tree: TenantTreePort<Tx> = {
  treeNode: (id, tx) => …,          // on tx when given: { id, parentId, path } | null — one read
  treeAncestors: (id, tx) => …,     // on tx when given: the node and every node above it — one read
  treeDescendants: (id, tx) => …,   // on tx when given: the node and every node below it — one read
  moveSubtree: (move, tx) => …,     // a planned move ON tx — lock, then ONE rewrite; rows written
};
const tenant = createApiTenant({ ...config, port, tree });
```

Store three columns on your tenant row: the parent's id (NULL for a standalone
tenant), the **materialized path** and, if you want one, your own unit code.
The package computes and validates every path; you store it and apply what it
plans.

- **The path** is `/<root id>/…/<own id>/`; a standalone tenant's is
  `/<own id>/`, so backfilling an existing table makes every row a root.
  Ids must not contain `/`.
- **`treeAncestors(id)`**: ONE read of the rows whose ids are the segments of
  the tenant's own path (a primary-key read; nothing recurses).
- **`treeDescendants(id)`**: ONE read of the rows whose path starts with the
  tenant's own, served by an index on the path. With a byte-ordered collation
  (Postgres `COLLATE "C"`) the prefix is exactly the range
  `path >= p AND path < p-minus-its-last-"/" || '0'`.
- **`moveSubtree(move, tx)`**, on the caller's transaction:
  1. **Lock** every row of the subtree AND the new parent `FOR UPDATE`, in ONE
     global order that never changes (by id). Two crossing moves (A under B
     while B goes under A) then wait on each other instead of deadlocking.
  2. **Rewrite** in ONE statement: replace the prefix `move.fromPath` with
     `move.toPath` on every row under it and re-point the row `move.id` at
     `move.parentId`, ONLY while that row's path is still `fromPath` and the
     parent's is still `parentPath`. Answer the rows written; 0 tells the
     package the tree moved under its plan, and it refuses the move by name
     (`moved`).
- **A new unit reads its parent's path `FOR SHARE`** (an insert trigger, or
  your writer). With the move's lock above, an insert under a moving tenant
  either waits for the move and takes the moved path, or commits first and the
  move's rewrite (a later statement) moves it too. Without both locks a unit
  can keep a stale prefix, and a stale prefix names the wrong ancestors.
- **Hold the row to its path** in the database too: a path that names the row
  once and last, and is `/<own id>/` exactly when there is no parent, so no
  writer can store a cycle. Such a check does not hold the path's PREFIX to
  the parent's path; only the port's writes keep that true, so write the tree
  through them.

`tenant.tree` answers `parentOf`, `rootOf`, `ancestorsOf`, `descendantsOf` (one
port call each, at any depth; each takes your transaction optionally) and
`move(id, parentId, tx)`, which runs its reads and its write in your
transaction (required) and refuses a cycle (`TenantTreeError`, code `cycle`)
before anything is written.

A grant across a tree is your authorization's business, not the package's.
Keep it distinguishable from a grant on the parent tenant itself: a scope that
names "the tenants below X" must never be the same string as X's own. And
wherever you gather the holders of grants by scope, gather the WHOLE chain
above a tenant, not only its parent.

### Slug resolution (opt-in)

A tenant keeps every slug it ever held, so an old link still names it, and a
lookup is answered from process memory once resolved, until the database says
the tenant changed. **Optional**, like the tree: a host that passes no `slugs`
boots unchanged and gets no `tenant.slugs`. Nothing is added to the tenant
port. The package owns no slug table and no trigger.

```ts
import { createKeptMemory, createApiTenant } from '@12-apps/tenant/server';

// ONE memory per channel per process, made at module load.
const memory = createKeptMemory({
  channel: 'tenant_slug_changed',          // the channel your triggers NOTIFY on
  listen: (channel, handlers) => …,        // your LISTEN; resolves once connected
  onError: ({ phase, channel, error }) => …, // log it in your words: 'start' | 'dropped'
  backstopMs: 10 * 60 * 1000,              // trust a kept value this long with no notification
  retryMs: 30 * 1000,                      // pause before retrying a listener that failed to start
  maxScopes: 5_000,                        // addresses kept, oldest dropped first
  maxSlots: 256,                           // slots per address (slug resolution uses one)
  database: () => …,                       // optional: the database the listener hears
});
const slugs: TenantSlugPort<YourRecord> = {
  current: (slug, parent) => …,  // ONE read: the tenant whose current slug is `slug`
  former: (slug, parent) => …,   // ONE read: the tenant that held `slug` before, with its CURRENT slug
};
const tenant = createApiTenant({ ...config, port, slugs: { port: slugs, memory } });
await tenant.slugs?.resolve('north-wing');                         // a root
await tenant.slugs?.resolve('radiology', { parentPath: '/t1/' });  // a unit under t1
```

Every number is required (`TenantConfigError`, key `memory.<key>`); the port's
two members and the memory are checked at startup (`slugs.port.current`,
`slugs.port.former`, `slugs.memory.read`). A host that is not on
`createApiTenant` yet uses the same pieces standalone: `createSlugResolver(port)`
(the two reads), `createKeptSlugs(memory)` (the keeping) and
`createTenantSlugs({ port, memory })` (both).

- **The statement budget.** A kept address costs no statement; a miss on a
  current slug costs one (`current`); a former or unknown slug costs two
  (`current`, then `former`). An unknown slug is never kept, so a stream of
  made-up slugs cannot grow the memory.
- **Keys.** A root lookup keys on the slug alone, as every address did before
  the tree. A unit's slug is unique within its parent: the lookup names the
  parent's path, the port receives `{ id, path }` of the parent, and the key is
  the path plus the slug. A bad path throws `TenantTreeError`; a slug holding
  `/` is loaded every time and never kept.
- **Your triggers.** On every write that changes what a lookup answers (the
  slug, and every column your record carries), and on every write to your
  former-slug table, `pg_notify(<channel>, '*')` AFTER the write commits. Every
  process drops every kept address: these writes are rare. A payload naming
  one address drops only that one (the root's slug, or the unit's path plus
  slug).
- **Before any lookup under a parent**, the triggers must also fire on a change
  of the tenant's parent or path: a moved unit answers at its new parent only.
- **The memory's rules.** Nothing is kept while the listener is down (a
  disconnect and a reconnect each drop everything, since a notification sent
  meanwhile is lost); a load a notification overtakes is not kept; one load
  answers a burst of the same lookup; a read through a transaction (`via`)
  never starts the `LISTEN`, which on a single connection would wait for it.
  Make the database client before the first lookup when `listen` depends on it.
- **`resolve` or `remember`, never both for one slug.** They share one key and
  one slot: `resolve` keeps the port's record, `remember` keeps your own
  reading of the same address, so mixing them on a slug answers each with
  what the other kept. Pick one per slug (a host whose reading carries more
  than the port's record uses `remember` throughout).
- **One memory per channel per process**, shared by everything that reads
  under that channel. Two memories on one channel each open a listener.

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
- **The tables have no foreign key, so nothing cascades.** A host that
  hard-deletes a tenant row deletes that tenant's `tenant_closings` and
  `tenant_data_exports` rows itself (or adds its own FK in a host migration).
