# Adopting @12-apps/audit

This package is a **plug-and-play audit plugin** (12-14): one library, reusable
across repositories, exposing standardized surfaces. A host repo only *points* at
these surfaces — when the library updates, every host updates with **no app
changes**. The contract is the one `@12-apps/report-builder`, `@12-apps/rbac` and
`@12-apps/payments-*` established.

## The standardized plugin surfaces

| Surface | Export | What the host does |
|---|---|---|
| **Core** | `@12-apps/audit` | Nothing to wire — the framework-free, Prisma-free vocabulary (`indexVocabulary`), the deny-by-default `redactDiff`, and the wire types both halves speak. Importable from a surface that must not pull a database client in (an offline tool registry, a build-time doc generator). |
| **Server** | `@12-apps/audit/server` | Call `createApiAudit(config)`. Mount the `routes` it returns, call `write(tx, entry)` from your mutations, wrap your client with `extendPrismaClient`, wrap your requests with `withActorContext`, and call `retention` from your sweep job. |
| **Hono** | `@12-apps/audit/hono` | `const audit = auditRouter(config); app.use('*', audit.actorContext); app.route('/api/admin/:tenantSlug', audit.router)`. A one-call mount; `hono` is an OPTIONAL peer, so importing the root or `/server` never resolves it. |
| **React** | `@12-apps/audit/react` | Call `createWebAudit({ apiBase })` and mount the `page` it returns, or take `Viewer` and hold the filter state yourself (a host that mirrors filters into its router's URL). |
| **Prisma** | `prisma/audit.prisma` + `prisma/migrations/*` | Run `node node_modules/@12-apps/audit/scripts/sync-audit-schema.mjs <host schema dir>`: the partial is **COPIED** into the host's multi-file schema folder — never symlinked (a symlinked migration is silently skipped by Prisma; a symlinked partial dangles under `turbo prune`). Migrations are discovered structurally from the installed package's `prisma/migrations` by the host's plugin-migration sync. |

## The impersonation attribution PAIR

This is the part to read before anything else, because it is the one design
decision the rest of the package is built around — and the one a reviewer will try
to collapse.

**An entry names two people, in two columns:**

| Column | Means | Moves when |
|---|---|---|
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
different — and correctable — question. In the host this came from, ~60 route
bodies call `setActor(grant.userId, …)` themselves, and while a session is
impersonated the tenant guard resolves that grant for the EFFECTIVE subject. So
those calls re-stamp `userId` with the person being impersonated, and any row
derived from it names the wrong person.

Editing 60 call sites fixes one tree and rots at the 61st. Instead:

1. only the stamp that knows BOTH halves writes the pair, atomically;
2. an unaware `setActor(someId)` moves `userId` and nothing else;
3. the writer prefers `realUserId` over the stamped id whenever a session is live;
4. `realUserId` is never accepted from a caller — a passed `realUserId` key is
   ignored by both context constructors (there is a test for exactly that spoof).

### What the writer refuses

`write(tx, { actorUserId })` keeps its precedence — a caller may deliberately
attribute an entry to the owner of the row it changed — with exactly ONE value
ruled out: the subject of a live impersonation. That value is vector 2 wearing a
different hat, and it produces the one row that cannot be corrected.

Deliberately asymmetric: `actorUserId: null` (a webhook forcing a system write)
drops `actor_role`/`scope`, because those describe the authorization the NAMED
actor used — but it KEEPS `on_behalf_of_user_id`, because "someone was being
impersonated" is a fact about the SESSION and stays true whoever the caller chose
to name. Gate it like the other two and any helper hard-coding
`actorUserId: null` launders the impersonation out of the trail.

Ticket 12-24 (impersonation) consumes this contract. `resolveActor` returns
`onBehalfOfUserId`; the host never touches the columns.

## Host wiring rules (the ones that bite)

1. **The host resolves WHO and WHERE; the package decides WHAT LANDS.**
   `resolveActor` answers `{ tenantId, userId, permissions, role, scope,
   onBehalfOfUserId }`. Auth, tenant resolution and the platform allowlist are
   host vocabulary. The package never reads a tenant identifier off the request —
   not from a path param, not from the query string — so the listing cannot be
   widened past its tenant by any request shape.
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
   `$executeRawUnsafe` is on the seam for the retention sweep alone.
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
7. **`trackedModels` is config.** The `created_by`/`updated_by` stamp applies to
   the models you name (in future-pay this was a five-name constant hard-coded in
   the extension). `deriveFields` is the seam for a column that must stay in sync
   on the same writes — future-pay's normalized `search_name` — and it runs on
   system and seed writes too, so such a column never drifts.
8. **The vocabulary is one value, shared by both halves.** Pass the SAME object to
   `createApiAudit` and `createWebAudit`. In future-pay the action list and the
   label map were separate files in separate apps, and nine actions the writer
   could emit had no label at all — so those rows showed a raw dotted id to a
   store owner. Sharing the value closes that by construction.
9. **Identity crosses a directory port.** `directory.getUsers(ids)` turns ids into
   names for BOTH columns in ONE batched call. Without it the viewer shows raw
   ids. `directory.listActors(tenantId)` populates the viewer's actor filter;
   without it the filter degrades to a free-text actor id rather than disappearing.
10. **Route order is part of the surface.** `/audit-logs/actors` is registered
    before `/audit-logs`; the Hono adapter mounts descriptors in array order, and
    another framework's adapter must preserve it.
11. **Static imports only.** The package publishes TypeScript source; a dynamic
    non-literal `import()` of a subpath crashes a bundled server.

## The config, field by field

| Field | Required | Default | Notes |
|---|---|---|---|
| `db` | yes | — | lazy provider of the structural `AuditDb` seam |
| `resolveActor` | yes | — | `null` ⇒ 401 before any handler runs; billing gates belong here |
| `vocabulary` | yes | — | actions + resources with labels and per-resource field allowlists |
| `trackedModels` | no | `[]` | models the `created_by`/`updated_by` stamp applies to |
| `appendOnlyModels` | no | `['AuditLog']` | models the guard protects (add your own immutable tables) |
| `retention.floorDays` | no | `365` | the global sweep window |
| `retention.table` | no | `audit_logs` | validated as a bare SQL identifier at construction |
| `directory` | no | — | `getUsers(ids)`; optional `listActors(tenantId)` |
| `gatePermissions.read` | no | `audit:read` | the permission id the listing requires |
| `messages` | no | pt-BR | user-facing copy; the identifiers stay English |

## Checklist

```bash
# 1. install, and copy the partial into your schema folder
node node_modules/@12-apps/audit/scripts/sync-audit-schema.mjs packages/prisma/prisma/schema
# 2. let your plugin-migration sync pick up prisma/migrations (replay-safe: no
#    baselining even if you already have an audit_logs table)
# 3. wire the mount + the middleware, and wrap your Prisma client once
# 4. replace your own audit writer's call sites with write(tx, entry)
# 5. mount the viewer: createWebAudit({ apiBase })
# 6. call retention from your sweep job
```

## What this package does NOT protect against

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
- **A missing allowlist entry is silent.** Deny-by-default means a field the
  vocabulary does not name is dropped without a word, and the row records that
  something changed without recording what to. Unknown ACTIONS and unknown
  RESOURCE TYPES do throw (inside your transaction, so nothing commits) — a
  missing field inside a declared resource cannot be told from a field the caller
  chose not to send.
- **The trail cannot prove a read.** Only writes reach the writer; "who looked at
  this customer" is a different subsystem.
- **No foreign keys.** `client_id`, `actor_user_id` and `on_behalf_of_user_id` are
  by-value scalars with no FK into host tables (the package-schema doctrine), so
  deleting a tenant does not cascade its trail away and a deleted user's id stays
  readable in old rows. A host that wants either behaviour adds the constraint in
  its own migration — and should think about whether an audit row surviving its
  subject is a bug or the point.
