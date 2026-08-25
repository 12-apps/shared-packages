# Adopting `@12-apps/audit`

An integration playbook. For what the package is and why, see
[`README.md`](./README.md); this is the "what do I wire, and what do I change if
I already had 1.x" guide.

---

## 1. What changed in 2.0, and what to write instead

Up to and including **1.x** this package exported one application's audit
vocabulary as constants, and the React half DEFAULTED to it. Every one of those
exports is **gone**, replaced by a factory that takes the same information as
config.

| Removed in 2.0 | Was | Now |
| --- | --- | --- |
| the host-branded vocabulary constants (the origin application's actions, resources, tracked-model names and payment-action literals — the exact export names are in the 1.x/2.x tags' copy of this file) | one application's catalog, published as everybody's default | `defineAuditVocabulary({ actions, resources })`, `trackedModels` on the server config, and your own module for any selector literals — all yours |
| `indexVocabulary(vocabulary)` | built an index from a loose literal | `defineAuditVocabulary(spec)` — the index IS the vocabulary now, and it is guarded |
| `AuditVocabularyIndex` (type) | the built index | `AuditVocabulary` |
| `AuditVocabulary` (type) | a loose `{ actions: [], resources: [] }` literal | `AuditVocabularySpec` is the input; `AuditVocabulary` is what the factory returns |
| `AuditActionDef` / `AuditResourceDef` | array element types | `AuditActionSpec` / `AuditResourceSpec`, keyed by id |

| New | What it is |
| --- | --- |
| `defineAuditVocabulary(spec)` | the whole vocabulary — the entry point to use |
| `assertAuditVocabulary(value)` | the guard every factory runs; exported so a host can run it at its own boundary |
| `AuditActionOf<V>` / `AuditResourceOf<V>` | the literal unions, for a host naming its own types |
| `AuditConfigError` | thrown at ASSEMBLY when the wiring is unsafe — a boot failure |
| `AuditVocabularyError` | thrown by the writer when a WRITE names something undeclared |
| `AUDIT_READ_PERMISSION` | this package's own permission id, `audit:read` |
| `AUDIT_LOG_ORDER_BY` | the listing's total order, for a hand-written db seam |
| `AuditPaginationConfig` / `DEFAULT_PAGINATION` | the paging numbers, now config |
| `DEFAULT_RETENTION_FLOOR_DAYS` | the retention floor default, named |

Behavioural changes beyond the renames:

- **`vocabulary` is REQUIRED on both halves and is checked.** `createWebAudit`
  used to fall back to the package's catalog, so a host that forgot to pass its
  own rendered another product's filter bar, in another product's language, over
  its own rows — with every one of its own actions falling through to a raw
  dotted id. Nothing failed.
- **The predicates take `unknown`.** `hasAction(value)` / `hasResource(value)`
  accept a raw wire value. What you can delete is the `String(x)` in front of
  them.
- **User-facing defaults are English.** `DEFAULT_MESSAGES` (server) and
  `DEFAULT_LABELS` (viewer) were pt-BR. Pass `messages` / `labels` with your
  product's copy — see §4. Dates default to the RUNTIME's locale; pass `locale`
  or `formatDate`.
- **The listing's order gained a tie-break.** `AuditLogDelegate.findMany` now
  receives `AUDIT_LOG_ORDER_BY` — `[{ createdAt: 'desc' }, { id: 'desc' }]` —
  and its `orderBy` type widened to match. A Prisma host needs no change; a
  hand-written seam must map the second clause. See §6.
- **`appendOnlyModels` ADDS to this package's own model.** It used to be the
  default value of that field, so `appendOnlyModels: ['MyLedger']` silently
  turned the audit table's own immutability off and `[]` turned the guard off
  entirely. `AuditLog` is now always guarded.
- **A retention floor, a page size, a gate id, a message and a model name are
  all validated at assembly.** See §5.

## 2. Declare your vocabulary

One module, imported by the server half, the viewer, and anything that writes an
entry.

```ts
// lib/audit/vocabulary.ts
import { defineAuditVocabulary, type AuditActionOf } from '@12-apps/audit';

export const AUDIT = defineAuditVocabulary({
  actions: {
    'post.publish': { label: 'Post published' },
    'post.retract': { label: 'Post retracted' },
    'comment.hide': { label: 'Comment hidden' },
    'member.invite': { label: 'Member invited' },
  },
  resources: {
    post: { label: 'Post', fields: ['title', 'state', 'publishedAt', 'authorUserId'] },
    comment: { label: 'Comment', fields: ['state', 'reason'] },
    member: { label: 'Member', fields: ['role', 'previousRole'] },
  },
});

export type AuditAction = AuditActionOf<typeof AUDIT>;
```

Four things to decide deliberately, because each is a promise:

1. **Declaration order.** The listing endpoint's filter enum and the viewer's
   pills both read it, so re-ordering moves a published schema. (An integer-like
   id is refused for exactly this reason — a JavaScript object lists those keys
   first whatever order they were written in.)
2. **Every `fields` entry.** Deny-by-default: a field a writer emits and the
   allowlist does not name is dropped SILENTLY, and the row then records that
   something changed without recording what to. List the union of what EVERY
   writer of a shared resource type emits.
3. **What must never be listed.** Buyer contact data, raw provider payloads,
   secrets. This table is append-only, so a field that lands here cannot be
   removed later.
4. **The labels.** They are product copy in your users' language. Blank is
   refused; the read path still falls back to the raw id for an entry written
   before a rename, which is defensive and a different thing.

   A label may also be a RESOLVER, and it is the only part of a vocabulary that
   may be:

   ```ts
   actions: {
     'post.publish': { label: localeCopy({ 'pt-BR': 'Post publicado', 'en-US': 'Post published' }) },
   }
   ```

   An audit log is opened by whichever operator is looking, so the words follow
   the REQUEST rather than the deployment. The ids around the label deliberately
   cannot: `actionIds`, the two predicates and `fields` are what a writer
   persists, a filter enum advertises and a parser matches on, so a vocabulary
   that varied them per reader would validate a row for one operator and refuse
   it for the next — and a diff column would vanish for whoever read it in the
   other language. The shape is what enforces the line: a resolver can only be
   reached through `actionLabel(id, ctx)` / `resourceLabel(id, ctx)`, and there
   is nowhere to hang one on an id.

   Resolvers are PROBED at assembly with an empty context, so a host whose copy
   lookup missed fails to boot rather than rendering an empty cell to the one
   operator who reads in the language that was wrong. If a pack is later short a
   line for one reader only, that cell falls back to the raw id.

## 3. Wire the two halves with the SAME value

```ts
// server
const audit = auditRouter({ db, resolveActor, vocabulary: AUDIT, /* … */ });

// viewer
const { page: AuditLog } = createWebAudit({ apiBase, vocabulary: AUDIT });
```

Passing the same object is what keeps "an action the writer can emit" and "an
action the viewer can name" one list. Before this package existed, those were
two files in two apps and they drifted: nine actions the writer could emit had no
label at all, so those rows showed a raw dotted id to an operator.

## 4. The permission, and the words

**The permission belongs to this package**, because it gates this package's
endpoint:

```ts
import { AUDIT_READ_PERMISSION } from '@12-apps/audit';

// with @12-apps/rbac, at composition time in YOUR host:
const catalog = composePermissions(
  RBAC_PERMISSIONS,
  definePermissionContribution({
    source: '@12-apps/audit',
    permissions: { [AUDIT_READ_PERMISSION]: { kind: 'class' } },
    labels: { domains: { audit: 'Audit' }, actions: { read: 'View' } },
  }),
  MY_DOMAIN_PERMISSIONS,
);
```

This package deliberately does not depend on `@12-apps/rbac` to state one
string — that would pull a router, a React surface and a Next adapter into every
tree that wanted only the writer. A host that spells the id differently passes
`gatePermissions: { read: 'trail:view' }`.

**The words are yours.** Both defaults are English and both are overridable per
key:

```ts
messages: { unauthenticated: '…', forbidden: '…', invalidQuery: '…' }  // server
labels:   { title: '…', systemActor: '…', onBehalfOf: '{actor} … {subject}' }  // viewer
locale:   'pt-BR'   // the stamp formatter, or pass formatDate for full control
```

`locale` decides the STAMP formatter and nothing else. The day window is the
grid's own day-range pill now, and its inputs follow the host's `DataViewsCopy`
and locale like every other date field on the screen — which is the consistency
this package's own masked bounds used to buy at the price of a control nobody
else on the page had. (They are still masked text fields rather than
`<input type="date">`, for the two reasons that made them so here: a controlled
native date input reports a WHOLE date from the year's first digit and cannot
survive a URL-mirroring host's commit latency, and it renders in the BROWSER's
locale, which the page can neither read nor set. `@12-apps/ui` carries the
measurement.)

## 4b. The grid the trail renders on

Since 6.0 the screen is a `DataViews` table — the same one every other admin
list in an adopting host renders — so it arrives with a search box, filter
pills, a sort dropdown, column visibility, the display panel, saved views and a
server-mode pager, and an operator moving between lists learns one filter bar
rather than two.

Two things follow for a host:

- **The grid's own words are `DataViewsCopy`,** provided once at your root
  through `DataViewsCopyProvider`. `useDataViewsCopy` THROWS outside a provider
  rather than falling back to some package's language, so a host that renders
  any `@12-apps/ui` list already has this mounted.
- **Saved views need a backend, so they are yours.** Pass the wrapper you
  already give your other lists as `table` and the trail saves views like they
  do; omit it and the same grid renders with no view persistence behind it.

```tsx
createWebAudit({
  apiBase,
  vocabulary: AUDIT,
  // Bind it ONCE, beside the rest of the config: the member is a component
  // TYPE, so a wrapper rebuilt per render remounts the whole grid.
  table: (props) => <DataViewsTable tenantSlug={slug} scope="AUDIT" {...props} />,
});
```

A blank override is refused at assembly: a blank message renders a denial as an
empty box, and a blank label renders an empty cell — both read as a broken
screen rather than as an untranslated one.

## 5. What assembly refuses, and why each one is a fail-open

Every refusal below is a case where declaring **nothing**, or declaring it
slightly wrong, opens a door. They all throw `AuditConfigError` at BOOT.

| Refused | What would otherwise happen |
| --- | --- |
| `actions: {}` / `resources: {}` | not a closed door: the writer throws for every action and `redactDiff` for every resource type, INSIDE each caller's transaction — so a vocabulary assembled from a settings table that came back empty rolls back every audited mutation in the app, at runtime, with assembly green |
| `fields: []` on a resource | the resource is declared, so nothing throws, and every field of every diff for it is dropped: the trail records that something changed without recording what to, permanently |
| a blank `label`, or a resolver that probes blank | the viewer renders an empty cell where an operator expects the name of what happened |
| an id or field with **surrounding whitespace** | see below |
| a blank id or field | admitted by every "is it filled in" check a host has, so an unset value validates as a deliberate declaration |
| a duplicate field | "the allowlist widened" and "it did not" produce the same array length, which is what a drift test usually watches |
| an integer-like id (`"12"`) | a JS object lists those keys first, silently re-ordering the published filter enum and the viewer's pills |
| a vocabulary the factory never built | every refusal above is skipped; the interface is public and its fields are erased at runtime, so a literal or a `JSON.parse`d config would reach the writer unchecked |
| `retention.floorDays` of `0`, negative, `NaN` or `Infinity` | the floor IS the sweep's cutoff: `0` puts it at `now` and the first sweep deletes the entire trail across every tenant. `0` reads as "no retention" and means "keep nothing"; `NaN` is what `Number(process.env.X)` yields for an unset variable. Nothing can undo it |
| `pagination.*` not a positive integer, or `defaultPageSize > maxPageSize` | `pageSize` bounds the rows one request returns and `maxPage` bounds the `OFFSET` behind it, which Postgres counts and discards before returning anything. A `NaN` compares false against every clamp, so `?pageSize=1000000` is served as written |
| a blank `gatePermissions.read` | asks the catalog for a grant nothing issues, so every reader is refused and the surface looks broken — and a host whose resolver returns `['']` for an unknown grant would PASS |
| a blank `messages.*` / `labels.*` | an empty error body, an empty cell, an empty button |
| a `trackedModels` / `appendOnlyModels` name with whitespace | a padded name matches no model, so the stamp or the guard you declared never fires — a tracked model whose `created_by` stays NULL looks exactly like a system write |
| `applyAppendOnlyGuard(client, { models: [] })` | a hook that permits every mutation and looks installed |

**The whitespace one is the sharpest**, and it is the shape the no-compiler path
actually produces. An operator types `post.publish, post.retract` into a settings
row; the host splits on the comma and the second value arrives with a leading
space. The published filter enum then carries `" post.retract"`, so the endpoint
refuses the id every mutation actually writes — and a padded FIELD is worse,
because nothing fails at all: it simply never matches the key the caller emits,
and that column disappears from every diff for that resource. Refused rather than
trimmed, because `actionIds` must stay what the host declared: it is what the
schema, the pills and the stored column are compared against.

**Empty is refused rather than interpreted.** `hasAction` over an empty set
closes, but the surface built on it does not: the writer's refusal lands inside
somebody's transaction. Two halves disagreeing about what "nothing declared"
means is the fail-open, so emptiness fails at assembly instead.

`assertAuditVocabulary` runs on **every** published entry point — the server
factory, the writer on its own (which a job or a backfill script reaches without
the factory), the Hono adapter and the React factory. A guard reachable only from
the newest door is a guard the adopter never meets;
`src/__tests__/entry-points.test.ts` reads the `exports` map off `package.json`
and walks each subpath to the hazard behind it, so a new entry point cannot ship
unguarded.

## 6. If your `AuditDb` is hand-written, add the tie-break

`AuditLogDelegate.findMany` now receives a two-clause `orderBy`:

```ts
orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]   // AUDIT_LOG_ORDER_BY
```

A Prisma client accepts it unchanged. A hand-written seam must translate it —
`ORDER BY created_at DESC, id DESC` — and should build the clause FROM the
argument rather than hard-coding it, so the package and the seam cannot drift.

Why it is not optional: `created_at` is `timestamp(3)` and an audit trail is
written in bursts (one request that cancels, refunds and closes writes three
entries in one transaction), so ties are ordinary. SQL guarantees no order among
rows a sort cannot distinguish, and each page is a separate statement — so with
`created_at DESC` alone the engine may answer page 1 and page 2 with different
permutations of the same tied group. The reader sees one entry twice and never
sees another. On a security log, "never sees another" is a row that silently does
not exist for whoever was looking.

## 7. The standardized plugin surfaces

| Surface | Export | What the host does |
|---|---|---|
| **Core** | `@12-apps/audit` | `defineAuditVocabulary`, the deny-by-default `redactDiff`, `AUDIT_READ_PERMISSION`, and the wire types both halves speak. Framework-free and Prisma-free — importable from a surface that must not pull a database client in (an offline tool registry, a build-time doc generator). |
| **Server** | `@12-apps/audit/server` | Call `createApiAudit(config)`. Mount the `routes` it returns, call `write(tx, entry)` from your mutations, wrap your client with `extendPrismaClient`, wrap your requests with `withActorContext`, and call `retention` from your sweep job. |
| **Hono** | `@12-apps/audit/hono` | `const audit = auditRouter(config); app.use('*', audit.actorContext); app.route('/api/admin/:tenantSlug', audit.router)`. A one-call mount; `hono` is an OPTIONAL peer, so importing the root or `/server` never resolves it. |
| **React** | `@12-apps/audit/react` | Call `createWebAudit({ apiBase, vocabulary })` and mount the `page` it returns — the whole screen, breadcrumb and header included — passing `filters`/`onFiltersChange` if you mirror the filter state into your router's URL, and `table` to render on your own wired `DataViews` wrapper. `Viewer` is the same trail with no page chrome, for embedding. |
| **Prisma** | `prisma/audit.prisma` + `prisma/migrations/*` | Run `node node_modules/@12-apps/audit/scripts/sync-audit-schema.mjs <host schema dir>`: the partial is **COPIED** into the host's multi-file schema folder — never symlinked (a symlinked migration is silently skipped by Prisma; a symlinked partial dangles under `turbo prune`). Migrations are discovered structurally from the installed package's `prisma/migrations` by the host's plugin-migration sync. |

## 8. The impersonation attribution PAIR

This is the part to read before anything else, because it is the one design
decision the rest of the package is built around — and the one a reviewer will try
to collapse.

**An entry names two people, in two columns:**

| Column | Means | Moves when |
| --- | --- | --- |
| `actor_user_id` | the REAL human whose credentials authorized the write | never reinterpreted |
| `on_behalf_of_user_id` | who the SCREEN claimed to be — the impersonation subject | only while a session is live; `NULL` otherwise, which is nearly every row |

The context behind them carries a third value the host cannot set:
`realUserId`, derived by `setActor` from `userId` in the same call that declared
the subject. `getActorAttribution()` returns the pair together, and consumers must
read it together.

### Why one field cannot do it

"Who did this" and "who did the screen say it was" are different questions, and an
audit trail has to answer both:

- Store only the subject and the trail says the customer cancelled their own
  order. It is then indistinguishable, a year later, from an order they really
  did cancel — and this table is append-only, so nothing can correct it.
- Store only the real human and the trail cannot answer "what was support looking
  at when they did that", which is the question a disputed action turns into.

Support impersonation is defensible *because* the trail names the staff member.
Overwrite `actor_user_id` and the feature stops being defensible.

### Why the real human is derived, not passed

`userId` in the context is **last-write-wins** by design: it also feeds
`created_by`/`updated_by`, where "the id this request is acting under" is a
different — and correctable — question. A typical host has dozens of route bodies
calling `setActor(grant.userId, …)` themselves, and while a session is
impersonated the tenant guard resolves that grant for the EFFECTIVE subject. So
those calls re-stamp `userId` with the person being impersonated, and any row
derived from it names the wrong person.

Editing sixty call sites fixes one tree and rots at the sixty-first. Instead:

1. only the stamp that knows BOTH halves writes the pair, atomically;
2. an unaware `setActor(someId)` moves `userId` and nothing else;
3. the writer prefers `realUserId` over the stamped id whenever a session is live;
4. `realUserId` is never accepted from a caller — a passed `realUserId` key is
   ignored by both context constructors (there is a test for exactly that spoof).

### What the writer refuses

**While a live impersonation is in scope, `actor_user_id` is ALWAYS the real
human.** Not "unless the caller says otherwise" — there is no third column to hold
them, the table is append-only, and support impersonation is only defensible
because the trail names the staff member who used it. So `write(tx, { actorUserId })`
is inert there, in four cases:

| `actorUserId` you pass | What lands | Why |
| --- | --- | --- |
| omitted | the real human | the stamped context id is the SUBJECT's while a session is live (vector 2 above) |
| the subject's own id | the real human | the id a caller reaches by accident, off a row the guard loaded for the effective subject |
| the real human's id | the real human | you were already right; no-op |
| **any third party** | **throws** | you are one field from being right, and rewriting it silently would hide a bug in your code |
| `null` (forced system write) | the real human | a human IS driving the session and is answerable; see the asymmetry below |

The throw (`AuditActorConflictError`) happens inside YOUR transaction, so the
mutation it described rolls back with it. **A caller that wants to record who owns
the row it changed puts that id in the DIFF**, where its allowlist can carry an
id field — that is what the diff is for, and it does not overwrite the answer to
"who is answerable".

Outside a session the override keeps full precedence, third parties and `null`
included: with no real human in scope there is nobody to erase.

Deliberately asymmetric, in two places, and both drops are the point:

- `actorUserId: null` drops `actor_role`/`scope`, because those describe the
  authorization the caller just declined to claim. That is what carries the
  "system" character of the write — **not** an absent human. So a forced system
  write inside a session still names the real human, with no role and no scope.
- It KEEPS `on_behalf_of_user_id`, because "someone was being impersonated" is a
  fact about the SESSION and stays true whoever the caller chose to name. Gate it
  like the other two and any helper hard-coding `actorUserId: null` launders the
  impersonation out of the trail.

## 9. Host wiring rules (the ones that bite)

1. **The host resolves WHO and WHERE; the package decides WHAT LANDS.**
   `resolveActor` answers `{ tenantId, userId, permissions, role, scope,
   onBehalfOfUserId }`. Auth, tenant resolution and the platform allowlist are
   host vocabulary. The package never reads a tenant identifier off the request —
   not from a path param, not from the query string — so the listing cannot be
   widened past its tenant by any request shape.

   **`tenantId` must be a non-empty string, and it is CHECKED.** This is the one
   seam the package does not control, and `AuditActor.tenantId: string` is erased at
   runtime. A `resolveActor` that destructures — `const { tenantId, permissions } =
   await resolveTenant(slug, session)` — returns `undefined` when the caller is not
   a member of that slug, and `undefined` fails OPEN under Prisma: it OMITS the
   clause, so the listing would answer with EVERY tenant's rows and `count` would
   report the global total. (`''` happens to fail closed, which only makes the bug
   shape-dependent.) Both are refused with a 500 — a host contract violation must
   be loud, not a 4xx you can shrug off. Return `null` from `resolveActor` for a
   caller you cannot scope; that is the 401.
2. **`permissions` is REQUIRED and fails closed.** There is deliberately no "the
   host already checked" mode: that mode is indistinguishable from a host that
   forgot, and this surface reads a security log. Pass `['*']` for an
   unconditionally-entitled caller, or `isSuper: true` for a platform operator.
3. **The writer takes YOUR transaction.** `write(tx, entry)` — the entry must land
   in the same transaction as the mutation it describes, so a failed insert rolls
   the mutation back. Do NOT catch around it: a money mutation that succeeded with
   no trail is the failure this shape prevents.
4. **Duck-typed DB, never a generated client.** `db` is a lazy provider of the
   structural `AuditDb` seam — a Prisma client satisfies it directly; the harness
   satisfies it with hand-written SQL. The argument shapes are CLOSED (documented
   in `src/server/db.ts`), so a non-Prisma host has a finite surface to fill.
   `$executeRawUnsafe` is on the seam for the retention sweep alone. See §6 for
   the `orderBy` widening.
5. **Mount `actorContext` around EVERY route whose writes should be attributed**,
   not only this package's. It is what the `created_by`/`updated_by` extension and
   the writer both read. One AsyncLocalStorage scope per request: a stamp made
   inside an awaited guard survives back into the handler, and concurrent requests
   cannot observe each other's actor (both properties are tested, the second with
   interleaved requests).
6. **Retention is a HOST policy with a package mechanism.** `purgeExpired()`
   applies the global floor; `purgeTenantWindow(tenant, since, cutoff)` takes the
   range because computing it is usually a billing question (an entitlement, a
   plan tier, a watermark table) the package must not learn about. `since` is the
   "downgrade never deletes" bound: rows written before the current window took
   effect were accumulated under a longer entitlement.
7. **`trackedModels` is config**, and an empty one is honest: naming no model
   means stamping no model, and nothing else in the package depends on it.
   `deriveFields` is the seam for a column that must stay in sync on the same
   writes (a normalized search key, say), and it runs on system and seed writes
   too, so such a column never drifts.
8. **The vocabulary is one value, shared by both halves.** See §3.
9. **Identity crosses a directory port.** `directory.getUsers(ids)` turns ids into
   names for BOTH columns in ONE batched call. Without it the viewer shows raw
   ids. `directory.listActors(tenantId)` populates the viewer's actor filter;
   without it the filter degrades to a free-text actor id rather than disappearing.
10. **Route order is part of the surface.** `/audit-logs/actors` is registered
    before `/audit-logs`; the Hono adapter mounts descriptors in array order, and
    another framework's adapter must preserve it.
11. **Static imports only.** The package publishes TypeScript source; a dynamic
    non-literal `import()` of a subpath crashes a bundled server.

## 10. The config, field by field

| Field | Required | Default | Notes |
| --- | --- | --- | --- |
| `db` | yes | — | lazy provider of the structural `AuditDb` seam |
| `resolveActor` | yes | — | `null` ⇒ 401 before any handler runs; billing gates belong here |
| `vocabulary` | yes | — | the value `defineAuditVocabulary()` returned; checked at assembly |
| `trackedModels` | no | `[]` | models the `created_by`/`updated_by` stamp applies to |
| `appendOnlyModels` | no | `[]` | models to guard IN ADDITION to `AuditLog`, which is always guarded |
| `retention.floorDays` | no | `365` | the global sweep window; must be positive and finite |
| `retention.table` | no | `audit_logs` | validated as a bare SQL identifier at construction |
| `directory` | no | — | `getUsers(ids)`; optional `listActors(tenantId)` |
| `gatePermissions.read` | no | `AUDIT_READ_PERMISSION` | the permission id the listing requires |
| `messages` | no | English | user-facing copy; identifiers stay English either way |
| `pagination.defaultPageSize` | no | `20` | rows per page when the request names none |
| `pagination.maxPageSize` | no | `100` | the ceiling a request's `pageSize` is clamped to |
| `pagination.maxPage` | no | `10000` | the ceiling a request's `page` is clamped to |

The listing's query parameters, as published: `q` (≤200 chars), `action_in`,
`resourceType_in`, `actorUserId`, `resourceId`, `from`/`to` (inclusive
`YYYY-MM-DD`), `sort` (`createdAt:desc` — the default — or `createdAt:asc`) and
`page`/`pageSize` (integers, clamped to the numbers above). `sort` is the one
axis a trail HAS; an unknown value is refused with a 400 rather than accepted
and dropped, because an accepted-and-dropped sort answers a caller's request
with the opposite order and no way to notice.

Viewer config: `apiBase` and `vocabulary` are required; `transport`, `labels`,
`locale`, `formatDate`, `table`, `exportLimits` and `fixedFilters` are optional.

## 11. Checklist

```bash
# 1. install, and copy the partial into your schema folder
node node_modules/@12-apps/audit/scripts/sync-audit-schema.mjs packages/prisma/prisma/schema
# 2. let your plugin-migration sync pick up prisma/migrations (replay-safe: no
#    baselining even if you already have an audit_logs table)
# 3. declare your vocabulary in ONE module (§2)
# 4. wire the mount + the middleware, and wrap your Prisma client once
# 5. replace your own audit writer's call sites with write(tx, entry)
# 6. mount the viewer: createWebAudit({ apiBase, vocabulary, table }) — and make
#    sure DataViewsCopyProvider is mounted at your root (§4b)
# 7. pass your messages/labels, and compose AUDIT_READ_PERMISSION into your catalog
# 8. call retention from your sweep job
```

## 12. What this package does NOT protect against

A guard whose limits are undocumented gets trusted past them:

- **Raw SQL bypasses the append-only guard entirely.** `$executeRaw*` /
  `$queryRaw*` never reach a model delegate, so any holder of the client can
  `DELETE FROM audit_logs` or `UPDATE` a row, and nothing in this package objects.
  That is deliberate — it is the only way the retention sweep can run, and test
  truncation needs it too. So the guard stops the ACCIDENT (a helper that upserts,
  a bulk update that catches the wrong model, a "fix the row" script written in
  Prisma) and not a determined operator. Real guarantees at that level are
  database privileges (a role with no DELETE/UPDATE on the table) or a trigger,
  and the host owns both.
- **Another connection is unaffected.** psql, a migration, a second client built
  without the extensions. This is a client-layer discipline, not a constraint.
- **Nested relation writes bypass BOTH extensions.** Prisma's `query.$allModels`
  hooks fire for the TOP-LEVEL model and operation only, so a write reached through
  a parent's relation payload is invisible to them.
  `prisma.account.update({ where, data: { entries: { deleteMany: {} } } })` deletes
  `entries` rows with no `AppendOnlyViolationError` — the hook saw `Account` +
  `update` — and a nested `create` on a TRACKED model leaves `created_by` NULL with
  no error, looking exactly like a system write. `AuditLog` itself is out of reach
  this way (the package's partial declares no `@relation`, Prisma requires both
  sides of one, and the partial carries a drift `--check`, so a host cannot add one
  without failing its own build), but **whatever you add through
  `appendOnlyModels` is not**: an immutable table of your own almost certainly has
  a parent. Guard those at the database, or keep their writes off the parent's
  payload.
- **A SECOND actor-context store makes every row say "system", silently.** The
  actor is per-request state in an AsyncLocalStorage instance kept on `globalThis`
  under a fixed key. If your tree ends up with two of them — the usual way is a
  second copy of the context module keyed differently, e.g. an older in-house
  `setActor` your route bodies still import while your WRITES now go through
  `write()` — then the writer reads a store nothing ever stamped. Every entry lands
  with `actor_user_id`, `actor_role`, `scope` and `on_behalf_of_user_id` NULL, the
  viewer renders the system label for every human action, and `audit_logs` is
  append-only: the attribution is gone permanently. Nothing fails on the way — the
  rows are structurally valid, and each half's own tests stamp through their own
  store. So after wiring, WRITE ONE ENTRY AS A KNOWN USER AND LOOK AT IT: an
  all-system trail with no system-only explanation is this bug and not a
  configuration detail. Import `setActor` / `runWithActor` from
  `@12-apps/audit/server` and nowhere else, or make your existing module
  re-export them.
- **`fixedFilters` is a UI pin, not a boundary.** The React surface merges them
  over the operator's filters, but the server has no notion of them: a user holding
  the read permission can `GET /audit-logs` directly and read the whole tenant's
  trail. Gate with a permission if that matters.
- **`q` is a scan.** It becomes `resource_id ILIKE '%…%'`, which none of the five
  shipped indexes can serve, and every request also runs a `count` over the tenant's
  partition. `page` and `pageSize` are clamped so a URL cannot ask for an unbounded
  `OFFSET`, but a keyword search over a large trail is a sequential read of that
  tenant's slice — narrow it with `from`/`to`, or add a trigram index in your own
  migration.
- **Retention compares an app clock against a DB-clock column, so run the database
  in UTC.** The cutoff is computed in the app (`Date.now()`) while `created_at`
  defaults to `CURRENT_TIMESTAMP` into a `TIMESTAMP(3)` *without* time zone, so a
  session `TimeZone` behind UTC stores local time and the sweep deletes rows up to
  that offset newer than intended. At the 365-day floor that is hours on a year —
  immaterial, and it is the Prisma-wide convention; it stops being immaterial if you
  set a floor measured in hours.
- **A missing allowlist entry is silent.** Deny-by-default means a field the
  vocabulary does not name is dropped without a word, and the row records that
  something changed without recording what to. Unknown ACTIONS and unknown
  RESOURCE TYPES do throw (inside your transaction, so nothing commits) — a
  missing field inside a declared resource cannot be told from a field the caller
  chose not to send. An EMPTY allowlist is refused at assembly, which is the
  version of this you can be protected from.
- **The trail cannot prove a read.** Only writes reach the writer; "who looked at
  this customer" is a different subsystem.
- **No foreign keys.** `client_id`, `actor_user_id` and `on_behalf_of_user_id` are
  by-value scalars with no FK into host tables (the package-schema doctrine), so
  deleting a tenant does not cascade its trail away and a deleted user's id stays
  readable in old rows. A host that wants either behaviour adds the constraint in
  its own migration — and should think about whether an audit row surviving its
  subject is a bug or the point.
