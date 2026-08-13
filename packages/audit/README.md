# `@12-apps/audit`

Action audit as a package: an append-only "who did what" trail, its transactional
writer, the per-request actor context behind it, the two Prisma extensions that
enforce it, the retention sweep, the tenant-scoped listing endpoint and the
viewer that reads it.

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

## The backend half

```ts
const audit = auditRouter({
  db: () => getPrismaClient(),               // the seam: one owned model
  vocabulary: MY_AUDIT_VOCABULARY,           // what may be audited
  trackedModels: ['Product', 'Supplier'],    // created_by / updated_by
  retention: { floorDays: 365 },
  directory: { getUsers, listActors },       // who a user id is (optional)
  resolveActor: async (request) => {         // WHO is calling
    const session = await auth(request.raw);
    if (!session) return null;
    const { tenantId, permissions } = await resolveTenant(request.params.tenantSlug, session);
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
| `vocabulary` | the indexed vocabulary: labels, validation |

### Endpoints

| Method | Path | |
|---|---|---|
| `GET` | `/audit-logs` | the tenant's trail, newest first — `{ data, pagination }` |
| `GET` | `/audit-logs/actors` | the viewer's actor-filter options — `{ data }` |

Filters: `q` (resource id contains), `action_in`, `resourceType_in`,
`actorUserId`, `resourceId`, `from`/`to` (inclusive `YYYY-MM-DD`), `page`,
`pageSize` (default 20, max 100). Unknown filter values and malformed dates are
`400`; a denial is `{ error }` at the top level with `401` / `403`.

There is **no write endpoint**. Entries are written by the mutations themselves,
so a POST here would only be a way to forge history.

## The frontend half

```ts
const { page: AuditLog } = createWebAudit({ apiBase: '/api/admin/my-store' });
```

The whole viewer: the resource-id search, the action and resource pills, the
actor picker, the day bounds, the trail with its diff summary and pagination —
and the impersonation pair rendered as one line naming **both** people. The
vocabulary is shared with the backend half, so an action that exists is an action
the viewer can label.

## The vocabulary

One value describes what may be audited, what a row may say, and what a human
reads:

```ts
const MY_AUDIT_VOCABULARY = {
  actions: [{ id: 'post.publish', label: 'Post published' }],
  resources: [{ id: 'post', label: 'Post', fields: ['title', 'state'] }],
};
```

`fields` is a **deny-by-default allowlist**: a field the diff carries but the
vocabulary does not name is dropped, so a caller passing a whole database row
cannot leak PII into an append-only table. The flip side is that an omission is
invisible at the write site and shows up as a hollow entry — list every field
each writer of a shared resource type emits.

`FUTURE_PAY_AUDIT_VOCABULARY` ships the Future Pay catalog for the host this came
out of.

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
design, and the checklist.
