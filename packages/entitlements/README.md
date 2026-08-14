# `@12-apps/entitlements`

A generic, portable **plan/feature entitlements** layer. Framework-free,
storage-free, **billing-free**. Zero runtime dependencies.

For the step-by-step wiring guide see [`ADOPTING.md`](./ADOPTING.md); this file
is the concepts + API reference.

Beyond the framework-free core, the package ships the SURFACE as two factories
(the plug-and-play contract): `createApiEntitlements(config)` under `./server`
(framework-neutral route descriptors — snapshot, plan view + pricing cards,
plan-change request — plus the guards, the usage-counter registry, the atomic
quota guard, retention watermarks, the tenant-settings writer and the
notification channel policy), a `./hono` adapter that mounts them, and
`createWebEntitlements(config)` under `./react` (the plan screen, the
`withEntitlement` page gate and the upgrade prompt host). The prisma partial
for `RetentionWatermark` and the `entitlements-coverage` gate script ship with
the package. See ADOPTING.md §10.

**The commercial policy is the HOST's, and it is required.** The tiers, what
they are called, what they cost, the currency they read in, the interval they
recur on and the permission that may ask for a change all arrive as config,
checked at ASSEMBLY by `assertApiEntitlementsConfig`. The one thing this
package contributes back is `ENTITLEMENTS_PERMISSIONS` — the single id
(`plan:request`) guarding its own write — which the host composes into its RBAC
catalog. See [`ADOPTING.md`](./ADOPTING.md) §11.

---

## The problem it solves

Most apps end up with two axes of access control and try to make one of them do
a third job:

| layer | question | owner | scope | denial |
|---|---|---|---|---|
| code | does the build support it? | devs | global | 404 |
| **entitlement** | **does the tenant's plan cover it?** | **platform / billing** | **tenant** | **402** |
| tenant setting | did the tenant switch it off? | tenant admin | tenant | hidden |
| RBAC permission | may *this user* do it? | tenant admin | user | 403 |

Encoding plans into **RBAC** fails on cardinality: permissions are per-user,
plans are per-tenant, so a plan change has to rewrite every role of every
member — including any roles the tenant authored themselves, which then have to
be un-rewritten on upgrade or destroyed. As a separate layer, a downgrade is one
write and roles are untouched, so re-upgrading restores everything instantly.

Encoding plans into the tenant's own **feature flags** fails on trust: those are
tenant-writable operational switches. Entitlements are platform-written and
adversarial. Same shape, opposite direction.

So: a third layer. This package.

## Two rules that make it work

**1. It knows nothing about money.** No price, no currency, no interval, no
provider ids. It accepts an already-resolved entitlement map plus a coarse
lifecycle status (`active` / `restricted` / `suspended`). A billing system maps
its own states into those three and becomes *one possible writer* of the plan
layer — never a dependency. That is what lets a host with hand-assigned tiers,
an internal beta programme, or no billing at all use this unchanged.

**2. Check entitlement and permission sequentially, never intersecting.**

```ts
// ✗ intersecting — loses the reason
const effective = permissions ∩ entitlements;   // everything is just a 403

// ✓ sequential — keeps it
await requireEntitlement('exports.bulk', { tenantId }); // 402 → upsell
await requirePermission('exports:read', { scope });     // 403 → "Ask your admin"
```

Intersect and you can no longer tell *"your plan doesn't include this"* from
*"your role doesn't include this"*. The upsell surface — the commercial point of
having entitlements at all — dies with the distinction.

## Resolution order

A feature is usable only when every layer agrees:

```
1. code    registry declares it                      → 'not-supported'
2. plan    plan ∪ overrides grants it                → 'not-entitled'      (upsell)
3. status  account not restricted/suspended          → 'restricted' | 'suspended'
4. tenant  tenant hasn't switched it off             → 'disabled-by-tenant'
```

The **reason** survives all the way to the caller. That is the whole design:
only `not-entitled` is an upsell. Offering "upgrade to unlock" for a feature the
tenant already pays for and turned off themselves would be a lie, so
`requiredPlan` is `null` for every other denial.

An entitled tenant is never forced — layer 4 always wins over layer 2.

---

## API

### `defineFeatures(catalog)`

The typed feature registry. Mirrors `@12-apps/rbac`'s `definePermissions`: pass a
`const` map so unknown keys fail typecheck instead of silently resolving to
"not entitled".

```ts
const FEATURES = defineFeatures({
  'exports.bulk':      { onRevoke: 'hide' },
  'webhooks.outbound': { onRevoke: 'disable' },
  'seats.included':    { kind: 'quota', onRevoke: 'readonly' },
  approvals:           { onRevoke: 'disable', defaultWhenEntitled: false },
  'records.read':      { retainWhenRestricted: true },
} as const);

type AppFeature = (typeof FEATURES.list)[number];
```

| field | default | meaning |
|---|---|---|
| `kind` | `'boolean'` | `'quota'` for numeric limits |
| `onRevoke` | `'hide'` | what the host does to existing data — `hide` / `readonly` / `disable` |
| `defaultWhenEntitled` | `true` | off until the tenant opts in when `false` (use for write-gating features) |
| `retainWhenRestricted` | `false` | survives dunning — keep read paths open so restriction degrades rather than bricks |

A feature key is a wire to a **code gate**. Plans can only reference keys that
already exist; they can never mint new ones.

### `definePlans(registry, plans)`

Tiers, authored with `extends` and **flattened at compile time** so runtime
resolution never walks a chain and a bad catalog fails at boot.

```ts
const PLANS = definePlans(FEATURES, {
  solo:  { entitlements: { 'records.read': true, 'seats.included': 1 } },
  team:  { extends: 'solo', entitlements: { 'webhooks.outbound': true, 'seats.included': 5 } },
  scale: { extends: 'team', entitlements: { 'exports.bulk': true, 'seats.included': 'unlimited' } },
} as const);
```

Declaration order is assumed cheapest → richest and drives `cheapestWith()`,
i.e. the `requiredPlan` on every 402. A richer tier may *lower* an inherited
value (set a quota to `0`) as well as raise it. Cycles and undeclared feature
keys throw.

### `createEntitlements(config)`

```ts
export const entitlements = createEntitlements({
  features: FEATURES,
  plans: PLANS,          // optional — omit for hand-assigned entitlements
  source,                // port: load(tenantId)
  usage,                 // port: count(tenantId, feature) — quotas only
  cache,                 // port: optional read-through cache
});
```

| method | returns |
|---|---|
| `check(tenantId, feature)` | `EntitlementDecision` — never throws for a denial |
| `checkQuota(tenantId, feature)` | decision + `used` / `remaining` / `exceeded` |
| `checkAll(tenantId)` | every feature in one pass |
| `require(tenantId, feature)` | throws `EntitlementRequiredError` → **402** |
| `requireQuota(tenantId, feature, need?)` | throws `QuotaExceededError` → **402** |
| `toSnapshot(tenantId)` | JSON-serializable projection for the browser |
| `invalidate(tenantId)` | drop cached state |

### Ports — the entire host seam

```ts
interface EntitlementSource<F> {
  load(tenantId: string): Promise<{
    plan: EntitlementMap<F>;
    planKey?: string | null;
    overrides?: EntitlementMap<F>;   // comped / beta / enterprise, layered OVER the plan
    settings?: SettingsMap<F>;       // the tenant's own off-switches
    status?: LifecycleStatus;
  }>;
}

interface UsageCounter<F> {
  count(tenantId: string, feature: F): Promise<number>;
}

interface EntitlementCache {
  get(key): Promise<string | null>;
  set(key, value, ttlSeconds?): Promise<void>;
  del(key): Promise<void>;
}
```

An **override** layers over the plan in both directions: it can grant a comped
feature *and* revoke one, without touching the plan catalog. Because an override
*replaces* the plan value rather than merging with it, a denial that came from
one carries `requiredPlan: null` — no plan the tenant could buy would lift a
platform revocation, and their current plan may well be the one that grants it.

### Quotas

`EntitlementValue = boolean | number | 'unlimited'`.

`0` is a real value meaning "entitled to none", so a tier can explicitly zero
out an inherited quota. `'unlimited'` stays a sentinel rather than `Infinity` so
a map survives `JSON.stringify`.

```ts
await entitlements.requireQuota(tenantId, 'seats.included');    // +1
await entitlements.requireQuota(tenantId, 'seats.included', 5); // bulk create
```

> ⚠️ **Check-then-act is not atomic.** Two concurrent creates can both read
> `used = 9` against a limit of 10 and both pass. The engine returns a
> *decision*; enforce atomically by counting inside the insert's transaction or
> with a DB constraint wherever an overage actually matters (always for seats,
> usually not for metered calls).

### Downgrade

**Downgrade must never delete data.** Every decision carries the feature's
`policy` even while denied, so the host knows what to do with rows that already
exist:

| policy | host behaviour |
|---|---|
| `hide` | surface disappears, rows untouched |
| `readonly` | rows stay visible and usable, `create`/`update` refuse |
| `disable` | rows deactivated but retained; reactivate on re-entitlement |

Over-quota is the same shape: existing rows survive, `create` returns 402.

### Dunning comes free

`restricted` is just another resolution layer, so a delinquent tenant needs **no
separate lock mechanism** — one `status` write closes every gate through the
guard you already wrote, while features flagged `retainWhenRestricted` stay open
so the account degrades instead of bricking. `suspended` admits no exceptions.

Neither offers an upsell: the tenant already paid for those features, so the fix
is settling up, and that message belongs to the host.

---

## React

```tsx
import { EntitlementsProvider, Entitled, Locked, useQuota } from '@12-apps/entitlements/react';

<EntitlementsProvider snapshot={snapshot} onUpsell={openPricingModal}>
  <Entitled feature="exports.bulk" fallback={<ExportsTeaser />}>
    <ExportsPage />
  </Entitled>

  <Locked feature="webhooks.outbound">
    {({ requiredPlan, upsell }) => (
      <button onClick={upsell}>🔒 Disponível no plano {requiredPlan}</button>
    )}
  </Locked>
</EntitlementsProvider>
```

The client **never re-resolves** — it receives a server-built snapshot and
renders, exactly like `@12-apps/rbac`'s `RbacProvider` takes an already-resolved
permission set.

`<Locked>` is headless and renders nothing for `disabled-by-tenant` or
`not-supported`, so an upsell only ever appears where a sale is actually
possible. `onUpsell` is the escape hatch: **the package does not own the upgrade
modal** — pricing copy and CTA are app branding, and owning them is what would
stop this being reusable.

`useQuota(feature, used)` takes usage from the caller because live counts are
not in the snapshot; the component rendering the list already knows.

> **Boundary:** `/react` may import types and pure helpers only — never a port,
> adapter or the engine. Enforced by `src/react/__tests__/boundary.test.ts`.

---

## Testing

```bash
pnpm --filter @12-apps/entitlements test
```

Three of the suites are the portability gate, and they answer different
questions:

| suite | what it proves |
|---|---|
| [`portability.test.ts`](./src/__tests__/portability.test.ts) | the ENGINE is portable — a toy note-taking SaaS with its own catalog, its own plans and the two ports |
| [`portability-surface.test.tsx`](./src/__tests__/portability-surface.test.tsx) | the SURFACES are — it MOUNTS the Hono router and the React factory for a concert hall and refuses a word from any other host's vocabulary |
| [`packed-artifact.test.ts`](./src/__tests__/packed-artifact.test.ts) | the TARBALL is — it asks `npm pack` what would upload and sweeps every published file |

The middle one exists because the first was not enough: every default that
actually leaked (a BRL price formatter, a `/mês` interval, a hardcoded top
tier, copy naming a host's own noun) sat on a surface no engine call reaches.
The last one exists because `files` publishes `src`, `prisma`, `scripts` and
every `*.md` — more than any rendered screen can show.

`memory.ts` provides in-memory source/usage/cache adapters for tests and local
development.
