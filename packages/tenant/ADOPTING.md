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
};
```

`setStatusIf` must be a real compare-and-set (`UPDATE … WHERE id = $1 AND status
= $2`, answering whether a row changed): the lifecycle relies on it to make each
step happen once.

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
