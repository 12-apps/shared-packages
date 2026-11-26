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
  for redirects is not answered here.

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
