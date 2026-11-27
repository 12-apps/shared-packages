# Adopting @12-apps/tenant

Two halves, one factory each, one config object each. Nothing is optional.

```ts
// backend
import { createApiTenant } from '@12-apps/tenant/server';
import { mountTenant } from '@12-apps/tenant/hono';

const tenant = createApiTenant({ statuses, ids, copy, port }); // + tree, slugs, lifecycle: each opt-in
mountTenant(app, tenant); // mounts nothing: hosts keep their own route modules

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
  bySlug: (slug) => …,                   // the CURRENT slug only: { id, slug, status, name? } | null
  byId: (id, tx) => …,                   // on tx when given: { id, slug, status, name? } | null
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

### Lifecycle (opt-in): close, reopen, the sweep, the gates

Additive: a host that passes no `lifecycle` boots unchanged and gets no
`tenant.lifecycle`.

```ts
const tenant = createApiTenant({
  statuses, ids, copy, port, tree, // tree optional
  lifecycle: {
    graceDays: 30, reminderDays: { week: 7, day: 1 }, // integers, 0 < day < week < graceDays
    minReasonLength: 3, nameLocale: 'pt-BR', sweepBatch: 200,
    copy: { locales: { 'pt-BR': { noticePlatformScheduledTitle, noticePlatformScheduledBody,
      noticePlatformScheduledBodyNoReason, noticeReopenedRestoredTitle, noticeReopenedRestoredBody }, … } },
    db: { transaction: (run) => prisma.$transaction(run), table: (tx) => (tx ?? prisma).tenantClosing },
    blockers: { kinds: [{ kind: 'patients', path: 'ward' }, …], read: (tenantId, { now, tx }) => … },
    openDescendants: { kind: 'units', path: 'units' }, // REQUIRED with `tree`, refused without
    confirmDangerousAct: (request, { tenantId, by }) => …, // throws to refuse (a PIN check)
    afterClose: ({ tenant, node, now }) => …, // throws = failed: stamped, audited, retried by the sweep
    invalidate: (tenantId) => …,
    notify: (typeId, payload) => …,           // resolves true only once RECORDED
    onPurgeDue: (tenantId, { now }) => …,      // 'purged' | 'already' | 'skipped'; OR `purge` (the engine, below)
    audit: (tx, action, event) => …,           // on tx; action = ids.audit[event.act]
    locale: () => …, onError: (error, { act, tenantId }) => …,
    mirror,                                   // optional: an older table you are moving (below)
  },
});
```

- **Your port MUST return `name` from `bySlug` and `byId`** once the lifecycle
  is wired. `TenantRecord.name` stays optional for hosts without it; with it, a
  record that lacks a name is a programming error, thrown as a
  `TenantConfigError` on `port.byId` the first time the lifecycle needs it
  (never a notice with an empty name).
- **The lifecycle's own sentences are a copy extension**,
  `lifecycle.copy.locales.<tag>`, required for every tag of `copy.locales`
  and validated per key (`lifecycle.copy.locales.pt-BR.noticePlatformScheduledBody`):
  the platform close's title and body (with its reason, and
  `noticePlatformScheduledBodyNoReason` when the notice carries none), and
  `noticeReopenedRestored*`, which a reopen notice reads when it restored a
  status other than active (`payload.restored`): a tenant reopened to
  suspended is not live again, and its notice must not say so.
  The base pack (`TENANT_COPY_SHAPE`) is unchanged. `blocker(kind, count,
  detail?)` takes the blocker's optional `detail` (an amount and a date).
- **Two entries into one flow.** `close({ by: 'member', typedName, … })`
  starts from `statuses.active` only and checks the typed name in
  `nameLocale`; `close({ by: 'platform', … })` starts from any of
  `statuses.closableFrom`, asks no name, writes `requested_by_id` null (your
  audit line says who) and hands the reason to the scheduled notice
  (`payload.reason`, words from `noticePlatformScheduled*`). Both record
  `prior_status`; `reopen` restores it (or `active` when it is null or not a
  live status).
- **The order of a close**: `confirmDangerousAct`, the reason, the name, then
  ONE transaction (`setStatusIf`, your blockers read again ON `tx` plus the
  open-descendants count, the row replaced, `mirror.replaced`, `audit`). A
  blocker found there rolls the move back (409 `closingBlocked`, `details:
  { pending }`). After the commit, never inside it: `afterClose` (with the
  tenant's tree node, so a unit can skip its root's billing), `invalidate`,
  `notify`. A hook that throws goes to `onError` and never undoes the close.
- **Refusals** are `TenantLifecycleRefusal { kind, code, status, details }`,
  `code` from your `ids.refusals`, the message from `copyFor(locale())`. The
  statuses are fixed: 403 closing/readOnly/closed, 409 gone, alreadyClosing,
  notActive, closingBlocked, purged, notClosing, 422 reasonTooShort,
  nameMismatch.
- **Schedule `tenant.lifecycle.sweep(now)`** on your own job runner (hourly is
  plenty). Per row: skip a tenant no longer closing or closed; retry
  `afterClose` while it has not gone through; once due, `onPurgeDue` and stamp
  `purged_at` on `purged` or `already`; before that, send the reminder due,
  stamped only once `notify` answered true.
- **Statement budget.** `state()` reads nothing for a live tenant and one row
  for a gone one. `blockers()` and the close add ONE `treeDescendants` read
  when a tree is wired: with the lifecycle, that read MUST return each node's
  `status` (`TenantTreeNode.status`), or the blocker throws a
  `TenantConfigError` on `tree.treeDescendants`. The sweep reads one `byId`
  per row and stamps in a transaction of its own.
- **Stale rows heal.** A closing row whose tenant is neither closing nor
  closed (reopened by a release that wrote only your older table, say) is
  deleted by the sweep, conditionally on its `requestedAt`, with
  `mirror.deleted`, in one transaction. It takes no slot of `sweepBatch`:
  the sweep pages on (keyset on `purgeAt`, `tenantId`) until `sweepBatch`
  live tenants were swept or no row is left.
- **Gates**: `createTenantGates(tenant, { admin: { prefix, closingWrites },
  public: { prefix, families }, lookup, holdsClose, locale })` and
  `mountTenantGates(app, gates)` from `@12-apps/tenant/hono`. `lookup` is your
  kept slug lookup (the status rides it: an open tenant pays nothing more); a
  family's `fixedWords` are never looked up; `slugAfter` names words after
  which the next segment is the slug. The middlewares are typed structurally
  (`TenantGateMiddleware`), so they fit whatever Hono version you resolve.
- **Notice words without the hooks**: `createNoticeWords(tenant, { copy })`
  answers `noticeWords` alone, for a notification registry that renders the
  lifecycle's notices apart from the module that wires its hooks. It
  validates the extension as the lifecycle does, and a locale without one
  reads the default locale's.
- **`TenantTree.nodeOf` is optional on the type** (added in this minor, so a
  host typing a tree of its own keeps compiling); `createTenantTree` always
  provides it, and the lifecycle reads no node when it is absent.

#### Moving an older closing table (expand and contract)

Pass `mirror: { replaced, event, deleted }`: each runs on the package's own
transaction, so the two tables never disagree. `deleted(tx, tenantId, requestedAt?)`
hands you the deleted row's `requestedAt`: delete your old row only while it
is that same close, so a re-close your previous release wrote meanwhile
survives (absent when the package read no row: delete by tenant). Write each stamp where it is
still null, as the package does. Rows your PREVIOUS release wrote only into
the old table (during a rolling deploy) are not in `tenant_closings`: before
each sweep, catch them up with one upsert (`INSERT … SELECT … ON CONFLICT
(tenant_id) DO UPDATE`), and backfill once with a data-only migration.

### The purge engine (opt-in, on top of the lifecycle)

Additive: a host that keeps `onPurgeDue` boots unchanged. A host that wants the
package to run its purge builds the engine and passes it as `lifecycle.purge`
**in place of** `onPurgeDue` (one of the two is required; both are refused).

```ts
import { createTenantPurge, type TenantPurgeConfig } from '@12-apps/tenant/server';

const purgeConfig: TenantPurgeConfig<Tx> = {
  keyColumns: ['org_id', 'scope'],                       // every column a row may name the tenant by
  models: { resolve: (model) => dmmfTable(model) },      // Prisma: `dbName ?? name`; null = unknown
  tables: [                                              // EVERY table holding a tenant key, ONE action, in erase order
    { model: 'Patient', key: { column: 'org_id' }, action: 'erase' },
    { model: 'Setting', key: { column: 'owner_ref', equals: { owner_kind: 'ORG' } }, action: 'erase' },
    { model: 'Staff', key: { column: 'org_id' }, action: 'keepAndStrip', law: 'a roster names its worker',
      strip: { set: '"active" = false', when: '"active"' },
      heldBy: { holders: [{ model: 'Roster', column: 'worker_id', matches: 'user_id' }],
                children: [{ model: 'StaffRole', column: 'staff_id', references: 'id' }] } },
    { model: 'ReportLine', key: { through: { model: 'Report', column: 'report_id', references: 'id', key: { column: 'org_id' } } },
      action: 'keepAndStrip', law: 'the refund', strip: { set: '"photo_key" = NULL', when: '"photo_key" IS NOT NULL' } },
    { model: 'Visit', key: { column: 'org_id' }, action: 'keep', law: 'medical record' },
    { table: 'monthly_rollup', action: 'keep', law: 'platform rule' }, // a raw table: only ever kept
  ],
  db: { transaction, execute: (sql, params, tx) => …, query: (sql, params, tx) => … }, // one statement each; autocommit with no tx
  revokeCredentials: (tx, tenantId) => …,  // idempotent: a resumed run calls it again
  collectImageKeys: (tenantId) => …,       // every object key the tenant's rows name (archived ones too)
  heldElsewhere: (tenantId, keys) => …,    // of these legacy keys, the ones ANOTHER tenant holds: ONE call per run
  beforeErase: [(tenantId, { now }) => …], // in order, outside any transaction; a throw stops the run
  zeroBalances: (tx, tenantId) => …,       // once per purge, by the run that stamped purged_at
  audit: (tx, action, event) => …,         // the purge's ONE line, on tx; event: TenantPurgeAuditEvent (its own type)
  mirrorClosing: (tx, tenantId, { purgedAt?, imageKeysOwed?, imagesErasedAt? }) => …, // your older table, until the contract release:
                                           // SET each field as given (imageKeysOwed is the whole list after the write, not keys to add)
  storage: { discard, members, state },    // `state` answers 'present' | 'absent' | 'unknown'
  parseKey: (key) => parseObjectKey(key, prefix), // @12-apps/storage's grammar, bound to your prefix
  unscopedKeys: 'accept',                  // as your storage mount chose it
  imageChunk: 25,
};
const purge = createTenantPurge(tenant, lifecycleConfig, purgeConfig);
// lifecycleConfig.purge = { run: (id, at) => purge.run(id, at), sweepImages: (now) => purge.sweepImages(now) }
```

- **Every piece is required** and validated at `createTenantPurge`
  (`TenantConfigError`, `purge.zeroBalances`, `purge.tables[3].model`…). A
  model that `models.resolve` does not know, a key column `keyColumns` does
  not list, a raw `table` on anything but `keep`, a table named twice, and an
  unresolvable `TenantClosing` (the package's own table, resolved the same
  way) are refused. The engine names no table or column of yours.
- **One run** (`purge.run(tenantId, { now })`, answering `purged`, `already`,
  `notClosing`, `notDue` or `descendantsPending`):
  0. with a tree, the descendants (ONE read) and, when all are closed, their
     closing rows (ONE read): a unit not purged answers `descendantsPending`
     before anything is written, so the parent stays closing, and
     restorable, until every unit below it is purged;
  1. one transaction: the status CAS closing → closed FIRST, the closing row
     read AFTER it (a reopen and a re-close landing before it are seen: a
     purge is never early; a row not due rolls the flip back), then
     `port.clearProfile` (only on the flip) and `revokeCredentials`. A CAS
     that moved nothing on a closed tenant is a run that stopped half way, and
     resumes;
  2. one transaction: the collected keys in the tenant's scope (legacy ones
     another tenant holds dropped) ADDED to `image_keys_owed`, mirrored;
  3. `beforeErase`, then the erase: per `erase` entry one `DELETE`, per
     `keepAndStrip` with `heldBy` one `DELETE` per child, the strip and one
     `DELETE` (`children + 2`), then every `keepAndStrip` without `heldBy`
     (one `UPDATE` each), autocommit, in order;
  4. one transaction: `purged_at` stamped where still null FIRST; a stamp that
     moved no row answers `already` and writes nothing else (two overlapping
     runs never zero twice); then `mirrorClosing`, `zeroBalances` and the
     purge config's own `audit` with `TenantPurgeAuditEvent`
     `{ act: 'closePurged', tenantId, purgeAt, erased }` (`erased`: the
     `erase` and held tables, in order). It is NOT a member of the
     lifecycle's `TenantAuditEvent`, so your exhaustive switch over that union
     keeps compiling;
  5. `invalidate`, quietly.
- **Strip SQL** is over the table's own columns: `$1` is the tenant id and
  `$2…` are `strip.values()` (each read when its statement runs, so once per
  strip statement per run; each MUST be referenced). A key's `equals` are bound after them, never spliced.
- **The image pass** (`purge.eraseOwedImages(id, { now, storage? })`, and
  `purge.sweepImages(now)`, which the lifecycle's sweep runs after its
  purges): only once `purged_at` committed; per chunk, `discard`, then
  `state` of every member; a key is dropped only when every member is
  `absent`. `unknown` keeps it owed and a throw stops the pass: the next
  sweep is the retry. One `UPDATE … EXCEPT` with the mirror; `images_erased_at`
  only on the emptying pass. Never throws: it answers the keys still owed,
  0 when none (or the tenant is not purged), and -1 when its closing row
  could not be read (reported to `onError`). The row is read by the engine's
  own `db.query`, so your lifecycle table adapter need not return the image
  columns.
- **With `lifecycle.purge` the sweep stamps nothing itself** and its result
  carries `imagesErased`; a failure of the pass's own lookup reaches
  `onError` as `{ act: 'purgeImagesLookup', tenantId: '' }` (no tenant).
  `reopen` now moves closing → active FIRST and reads the closing row INSIDE
  its transaction, after the move, handing `mirror.deleted` THAT row's
  `requestedAt`; a close that started from another live status (a platform
  close of a suspended tenant) takes a second move to it. A member's reopen
  costs what it did (move, read, delete, audit); the row is read for the
  refusal code only when the move failed.
- **Statement budget** (steps as numbered above): 0 = 1 read (+1 when every
  descendant is closed); 1 = 6 on a flip (CAS, row, `clearProfile`, your
  revocations), CAS + status + row + revocations on a resume, at most 3
  (+tree) on `already`/`notDue`/`notClosing`; 2 = your collect + your
  `heldElsewhere` (only with a legacy key) + 2, or your collect alone with no
  key; 3 = your hooks + the plan's statements; 4 = 3 + your `zeroBalances`; the
  image pass = 3 per tenant, plus one lookup per sweep.
- **Classification, in your tests**: `assertPurgeClassification(catalog,
  purgeConfig, { keyColumns, notATenantKey })` throws one error naming every
  finding: a table with a key column in no list, a configured table the
  catalogue lacks, a kept table a delete of an erased one reaches by cascade,
  directly or through tables of no tenant key, closed to a fixpoint
  (`child <- parent`, `(reached from <erased>)` when indirect; a held table
  may cascade into its own holders, never past them), and, with
  `restricts`, an erased child after the parent it restricts. Read the
  catalogue yourself (a schema scan, or `information_schema` and
  `pg_constraint` of the real database).
- **No migration**: the engine writes `purged_at`, `image_keys_owed` and
  `images_erased_at`, which 1.0's `tenant_closings` already has.

### Custom domains (opt-in)

A tenant claims a hostname, proves it owns the zone with a TXT record, points
the name here, and is then served on it, with a certificate the TLS ask
allows. **Optional**, like the tree and slugs: a host that passes no `domains`
boots unchanged and gets no `tenant.domains`. Nothing is added to the tenant
port, and **the domain table stays yours**: the package maps no table, names
no column and ships no migration.

```ts
import { createApiTenant } from '@12-apps/tenant/server';
import { resolveTxt, resolve4, resolve6 } from 'node:dns/promises';

const tenant = createApiTenant({
  ...config,
  port,
  domains: {
    port: domainPort,           // TenantDomainPort<Tx>: your rows, every member required
    quota: domainQuota,         // TenantDomainQuota<Tx>: your plan
    dns: {
      // YOUR resolver, as lambdas, so your tests' mock of the DNS module applies.
      resolver: { txt: (n) => resolveTxt(n), ipv4: (n) => resolve4(n), ipv6: (n) => resolve6(n) },
      dnsTargets: () => readTargetsFromEnv(), // read on EVERY call; [] = unknown
      recordPrefix: '_yourapp-verify',        // one DNS label
    },
    tls: {
      servable: async (hostname) => …,        // { tenantId } of an ACTIVE domain of a live tenant, or null
      entitled: async (tenantId) => …,        // the plan carries custom domains now
    },
  },
});
await tenant.domains?.run({ tenantId, actorId, via: 'panel' }, { operations: [{ operation: 'add', hostname: 'acme.com' }] });
await tenant.domains?.ask('acme.com'); // 'allow' | 'unknown' | 'unentitled'
```

Every member is checked at startup, named: `domains`, `domains.port.<member>`,
`domains.quota.<member>`, `domains.dns.resolver.txt|ipv4|ipv6`,
`domains.dns.dnsTargets`, `domains.dns.recordPrefix`,
`domains.tls.servable|entitled`. A host not on `createApiTenant` yet uses the
pieces standalone, each checking its own: `createDnsChecks(dns)`,
`createTenantDomains({ port, quota, dns: checks })`, `createTlsAsk(tls)`.

- **The answer is copy-free.** `run` answers `{ ok: true, results, domains }`
  (each result's `domainId` in `domains`, read once after the write) or
  `{ ok: false, problems }`, each problem a KIND (`nameTaken`, `planLimit`,
  `invalidHostname` with the typed `input`, …). You map each kind to your wire
  code, your sentence and your status; the package makes up no id and no word.
- **The statement budget.** `rows` once and `holders` once to plan;
  `mayVerify` only when the call has a verify, `reserve` only when it claims or
  restores; then ONE transaction: `holders` on `tx`, `used` on `tx` when the
  limit is a number, the writes in call order, an `audit` per removal and
  restore; then `rows` once for the answer. A port member that adds a read is a
  defect. A problem found while planning writes nothing and asks no DNS;
  `validateOnly` asks no DNS either.
- **SERIALIZABLE, and `failure`.** `transaction` must run at serializable
  isolation: it is what turns two concurrent claims into one winner. `failure`
  classifies what the transaction threw: `'retry'` a serializable conflict
  (nothing was written), `'taken'` a unique-index violation on a hostname,
  `null` anything else, which the engine rethrows. Never answer `null` with a
  guess.
- **The token is yours.** `claim` mints the verification token and it must be
  unguessable (a random UUID or better): it is what proves ownership. A zone
  apex is claimed WITH its `www.` (one domain, one token, one quota unit).
- **`archive` makes the domain unservable, not only archived**: a release that
  cannot read your archive column (a rollback) must still never serve it. Set
  the status your servable lookup refuses in the same write. `restore` brings
  it back unverified, with the same token.
- **The resolver must be yours.** The package imports no DNS module; it calls
  the three functions you pass, so a test that mocks your DNS module mocks
  every lookup. Pass lambdas (`(n) => resolveTxt(n)`) rather than the
  functions themselves, so a mock that leaves one out fails only the test that
  calls it.
- **The TLS ask denies by default.** `ask` answers `allow` only when the name
  is servable AND the tenant is entitled, so a downgrade stops renewal, not
  just serving. Map `allow` to 200 and anything else to a refusal.
- **The records.** `createDomainDns({ recordPrefix })` from
  `@12-apps/tenant/domains` builds what a tenant publishes (one TXT at the
  root, a pointing record per name and type); import it where both the screen
  and the server read it, so the prefix lives once.
- **The screen** (`@12-apps/tenant/domains/react`):
  `createDomainsScreen({ copy: { locales, defaultLocale }, components: { ConfirmButton, Segmented } })`
  checks every pack and both widgets at startup
  (`domainsScreen.copy.locales.<tag>.records.<key>`,
  `domainsScreen.components.ConfirmButton`). Each pack is
  `{ records, pair, closeAlert }` (`TENANT_DOMAINS_COPY_SHAPE`): the two groups
  stay apart because both say "remove" in different words. `DomainsCard`
  takes this render's resolved pack and your writes (`{ writes: { errors,
  isPending, dismiss }, run, remove }`, one write per domain, `remove`
  rejecting with the refusal so the confirmation stays open); the test ids are
  the ones a journey reads (`domains-card`, `domain-row`, `domain-verify`,
  `domain-remove`, `domains-error`, `domain-restore`, …). An optional `emptyState` draws your
  own empty state (keep its `domains-empty` test id) in place of the
  package's, for tooling that reads your JSX, such as a search index.

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
