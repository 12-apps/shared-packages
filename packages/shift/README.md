# @12-apps/shift

Headless, tenant-scoped work shifts: a worker opens a period, optionally claims
a resource for its duration, and the period is closed by the worker, by a
supervisor, or by a sweep. Immutable once closed, audited through a port, and
backed by a Prisma partial plus the PostgreSQL guarantees Prisma cannot express.

The package owns the mechanism. It owns none of the vocabulary.

## The host states its kinds

`kind` is the one field on a shift whose values describe a business rather than
a work period, so there is no default and there is no built-in list — the set is
required config:

```ts
import { createShiftService, defineShiftVocabulary } from '@12-apps/shift';

export const CLINIC_KINDS = ['hygiene', 'surgery', 'reception'] as const;

const service = createShiftService(shiftDb, { kinds: CLINIC_KINDS });
```

Pass an `as const` tuple and every input on the returned service narrows to
exactly those values, so the host keeps compile-time safety over its own words:

```ts
await service.openShift({
  clientId, userId, actorUserId,
  kind: 'surgery',              // ✅ declared
  resource: { type: 'operatory-chair', id: 'chair-3', exclusive: true },
});

await service.openShift({ ...input, kind: 'grooming' });
// ✗ compile error, and at runtime a ShiftError('INVALID_SHIFT') naming the
//   kinds this service was constructed with.
```

An empty, blank or duplicated entry throws `ShiftConfigError` at construction —
where it is legible — rather than at the request where nobody can clock in.

### Reading a kind back

`Shift.kind` is a `string`, because a row holds whatever is in the column. A
host that wants its union back narrows with the guard `defineShiftVocabulary`
returns, built from the same declaration the service validates against:

```ts
const vocabulary = defineShiftVocabulary(CLINIC_KINDS);
const kind = vocabulary.has(shift.kind) ? shift.kind : null;
//    ^? 'hygiene' | 'surgery' | 'reception' | null
```

One declaration, so the values a service accepts and the values a host narrows
to cannot drift apart.

`resourceType` and `resourceId` have always worked this way: carried by value,
with the host owning what they mean. Kinds simply joined them.

## Upgrading from 3.x

`createShiftService(db)` no longer compiles: `options.kinds` is required.

1. Declare your kinds in host code as an `as const` tuple and pass them.
2. Replace imports of the removed kind list, kind union and the two
   resource-type constants with host constants of your own. The resource-type
   values were never validated by this package — they are strings it stores and
   compares — so keeping the same literals preserves every existing row.
3. Migrate. `20260821120000_shift_kind_host_vocabulary` drops the CHECK
   constraint that restricted `shifts.kind` to the extraction origin's two
   values and replaces it with a non-blank check. Existing rows satisfy it, so
   there is no backfill.

Nothing else changed: the wire shape of a shift, the audit port, the exclusivity
rules, the sweep and every error code are as they were.

## Exports

| Export | What it is |
| --- | --- |
| `createShiftService(db, options)` | The service. `options.kinds` is required. |
| `defineShiftVocabulary(kinds)` | Validates a host's kinds; returns the type guard over them. |
| `createMemoryShiftDb()` | An in-memory `ShiftDb`, for host tests. |
| `ShiftError` / `ShiftConfigError` | A request outcome, and a wiring mistake. |
| `@12-apps/shift/jobs` | The auto-close blueprint, deps left open. |
| `@12-apps/shift/manifest` | The wiring manifest and its server half. |

## Database

The Prisma partial (`prisma/shift.prisma`) and the migrations under
`prisma/migrations` are contributed to the host's schema. Tenant, user and
resource identifiers are stored by value, with no foreign key into host tables —
which is what lets a host purge a tenant without the package having an opinion.
