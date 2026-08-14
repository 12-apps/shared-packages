# `@12-apps/audit`

Action audit as a package: an append-only "who did what" trail, its transactional
writer, the per-request actor context behind it, the two Prisma extensions that
enforce it, the retention sweep, the tenant-scoped listing endpoint and the
viewer that reads it.

**The vocabulary is yours.** This package ships no actions, no resource types,
no field allowlists and no product language — you declare them and pass them in.
See [ADOPTING.md](./ADOPTING.md) for the migration table if you are coming from
1.x.

Two halves, one factory each.

```ts
// backend
import { createApiAudit } from '@12-apps/audit/server';
import { auditRouter } from '@12-apps/audit/hono';

// frontend
import { createWebAudit } from '@12-apps/audit/react';
```

## What it is for

An audit trail is only worth having if it cannot be edited afterwards, and only
defensible if it names the right person. This package is those two properties,
made mechanical:

- **Immutable.** The entry is written INSIDE the caller's transaction, so "it
  happened" and "it was logged" commit or roll back together — never
  fire-and-forget. Afterwards the model refuses `update` / `upsert` / `delete`
  at the client layer.
- **Correctly attributed.** An entry carries a PAIR of identities: the real human
  whose credentials authorized the write, and — when a session is impersonating —
  who the screen claimed to be. One field cannot answer both questions, and
  collapsing them is not recoverable on an append-only table.

## The vocabulary

One value describes what may be audited, what a row may say, and what a human
reads. Both halves take the same object.

```ts
import { defineAuditVocabulary } from '@12-apps/audit';

export const AUDIT = defineAuditVocabulary({
  actions: {
    'post.publish': { label: 'Post published' },
    'comment.hide': { label: 'Comment hidden' },
  },
  resources: {
    post: { label: 'Post', fields: ['title', 'state', 'publishedAt'] },
    comment: { label: 'Comment', fields: ['state', 'reason'] },
  },
});
```

`fields` is a **deny-by-default allowlist**: a field the diff carries but the
vocabulary does not name is dropped, so a caller passing a whole database row
cannot leak PII into an append-only table. The flip side is that an omission is
invisible at the write site and shows up as a hollow entry — list every field
each writer of a shared resource type emits.

The factory refuses, at assembly, everything that would make the vocabulary
unsafe later: an empty axis, an empty `fields`, a blank label, a blank or
whitespace-padded id or field name, a duplicate field, an integer-like id. Every
one of those is a fail-open, explained in [ADOPTING.md](./ADOPTING.md) §5.

## The backend half

```ts
const audit = auditRouter({
  db: () => getPrismaClient(),               // the seam: one owned model
  vocabulary: AUDIT,                         // what may be audited
  trackedModels: ['Post', 'Comment'],        // created_by / updated_by
  retention: { floorDays: 365 },
  directory: { getUsers, listActors },       // who a user id is (optional)
  messages: { forbidden: 'No access.' },     // your product's copy
  resolveActor: async (request) => {         // WHO is calling
    const session = await auth(request.raw);
    if (!session) return null;
    const { tenantId, permissions } = await resolveTenant(request.params.tenantSlug, session);
    // Return null — the 401 — rather than an actor with no tenant. An `undefined`
    // tenantId is a cross-tenant read waiting to happen, so the package refuses it
    // with a 500 (ADOPTING.md rule 1).
    if (!tenantId) return null;
    return {
      tenantId,
      userId: session.user.id,
      permissions,
      role: session.role,
      scope: tenantId,
      onBehalfOfUserId: session.impersonating?.subjectUserId ?? null,
    };
  },
});

app.use('*', audit.actorContext);              // stamp every request
app.route('/api/admin/:tenantSlug', audit.router);
```

What you get back:

| | |
|---|---|
| `routes` | framework-neutral descriptors, in mount order (`./hono` adapts them) |
| `write(tx, entry)` | the transactional writer — call it inside your transaction |
| `extendPrismaClient(client)` | both extensions, applied once at client construction |
| `withActorContext(req, run)` | the actor-context middleware (`actorContext` in `./hono`) |
| `retention` | `purgeExpired()` and `purgeTenantWindow(tenant, since, cutoff)` |
| `store` | the tenant-scoped read, for a host surface that lists the same rows |
| `vocabulary` | the vocabulary in force — labels and validation |

### Endpoints

| Method | Path | |
|---|---|---|
| `GET` | `/audit-logs` | the tenant's trail, newest first — `{ data, pagination }` |
| `GET` | `/audit-logs/actors` | the viewer's actor-filter options — `{ data }` |

Filters: `q` (resource id contains), `action_in`, `resourceType_in`,
`actorUserId`, `resourceId`, `from`/`to` (inclusive `YYYY-MM-DD`), `page`,
`pageSize`. The paging numbers are config (`pagination`), defaulting to 20 / 100
/ 10 000. Unknown filter values and malformed dates are `400`; a denial is
`{ error }` at the top level with `401` / `403`.

The listing's order is **total**: `created_at DESC, id DESC`. An audit trail is
written in bursts and `created_at` is `timestamp(3)`, so ties are ordinary — and
SQL guarantees nothing about the order of rows a sort cannot distinguish, which
with `skip`/`take` means a reader sees one entry twice and never sees another.
The tie-break is part of the seam (`AUDIT_LOG_ORDER_BY`), so a non-Prisma
implementation maps it rather than reinventing it.

There is **no write endpoint**. Entries are written by the mutations themselves,
so a POST here would only be a way to forge history.

### The permission it gates with

`audit:read` is exported as `AUDIT_READ_PERMISSION`, because this package owns
the endpoint it guards. Compose it into your catalog, or spell it differently
with `gatePermissions.read` — the constant is the default, not a requirement.

## The frontend half

```ts
const { page: AuditLog } = createWebAudit({
  apiBase: '/api/admin/my-store',
  vocabulary: AUDIT,
  labels: { title: 'History' },   // your product's words
});
```

The whole viewer: the resource-id search, the action and resource pills, the
actor picker, the day bounds, the trail with its diff summary and pagination —
and the impersonation pair rendered as one line naming **both** people. The
vocabulary is shared with the backend half, so an action that exists is an action
the viewer can label.

Copy defaults to English and dates to the runtime's own locale. Both are
fallbacks rather than recommendations — a package cannot know your market, and
1.x defaulted to one application's.

## The database

The package owns one model (`prisma/audit.prisma`) and its migration. A host
copies the partial in with the package's own script:

```bash
node node_modules/@12-apps/audit/scripts/sync-audit-schema.mjs [<host-schema-dir>]
```

The migration is **replay-safe** (`CREATE TABLE IF NOT EXISTS`,
`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`), so a host that already
has an `audit_logs` table adopts it with no baselining and no
`prisma migrate resolve --applied`.

## What this does NOT protect against

Stated plainly, because a guard whose limits are undocumented gets trusted past
them:

- **Raw SQL bypasses the append-only guard.** `$executeRaw*` / `$queryRaw*` never
  reach a model delegate, so anyone holding the client can
  `DELETE FROM audit_logs`. That is deliberate — it is the only way the retention
  sweep can run — and it means the guard stops the ACCIDENT, not a determined
  operator. Guarantees at that level are database privileges or a trigger, and
  the host owns both.
- **Another connection is unaffected.** psql, a migration, a second client built
  without the extensions.
- **The host still owns authorization.** The package gates on the permission ids
  the host resolved; it does not compute them, and it will read nothing for an
  actor that carries none.

See [ADOPTING.md](./ADOPTING.md) for the full contract, the impersonation pair's
design, the assembly refusals and the checklist.
