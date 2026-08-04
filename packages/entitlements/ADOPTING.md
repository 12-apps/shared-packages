# Adopting `@12-apps/entitlements` in another project

A step-by-step **integration playbook**. For concepts and the API reference see
[`README.md`](./README.md); this is the "how do I wire it into my app, my DB and
my CI" guide.

The library is **framework-free, DB-free and billing-free**. You supply three
things — a feature catalog, plan definitions, and a `source` that maps a tenant
id to its entitlement state — and you get layered gating, quotas, 402-vs-403
denial semantics and a browser snapshot. Nothing about the host leaks into the
core.

---

## 1. Declare your feature catalog

Model every plan-gated capability as a feature key, and decide two things per
feature: **is it a quota**, and **what happens to existing data when it is
revoked**.

```ts
// lib/entitlements/features.ts
import { defineFeatures } from '@12-apps/entitlements';

export const FEATURES = defineFeatures({
  audit:             { onRevoke: 'hide',     description: 'Audit trail' },
  mcp:               { onRevoke: 'disable',  description: 'AI integration' },
  'stock.locations': { kind: 'quota', onRevoke: 'readonly' },
  approvals:         { onRevoke: 'disable',  defaultWhenEntitled: false },
  'orders.read':     { retainWhenRestricted: true },
} as const);

export type AppFeature = (typeof FEATURES.list)[number];
```

Rules of thumb:

- A feature key is a wire to a **code gate**. Plans compose existing keys; they
  can never mint new ones.
- `onRevoke` is a promise to your users that a downgrade destroys nothing.
  Choose it when you add the feature, not when the first tenant downgrades.
- `retainWhenRestricted` is how dunning degrades instead of bricking. At minimum
  keep the tenant's read paths and their own billing page open.

## 2. Define your plans

```ts
// lib/entitlements/plans.ts
import { definePlans } from '@12-apps/entitlements';
import { FEATURES } from './features';

export const PLANS = definePlans(FEATURES, {
  basic: { entitlements: { 'orders.read': true, 'stock.locations': 1 } },
  plus:  { extends: 'basic', entitlements: { mcp: true, 'stock.locations': 5 } },
  pro:   { extends: 'plus',  entitlements: { audit: true, approvals: true,
                                             'stock.locations': 'unlimited' } },
} as const);
```

Declaration order is cheapest → richest and drives every `requiredPlan`. Author
in code, seed to DB rows if your backoffice edits them — the same shape
`@12-apps/rbac` uses for role templates.

**No prices here.** Price, currency, interval and provider ids belong to your
billing tables. Keeping them out is what makes the layer reusable, and it is
also what lets you snapshot a subscriber's entitlements independently of the
plan catalog (see §7).

## 3. Implement the source port (the DB seam)

The only genuinely app-specific part. Union of up to four things:

```ts
// lib/entitlements/source.ts
import type { EntitlementSource } from '@12-apps/entitlements';
import { PLANS } from './plans';

export const source: EntitlementSource<AppFeature> = {
  async load(tenantId) {
    const tenant = await db.client.findUnique({
      where: { id: tenantId },
      select: {
        entitlementOverrides: true,
        featureSettings: true,
        subscription: { select: { planKey: true, entitlements: true, status: true } },
      },
    });

    const sub = tenant?.subscription;
    return {
      // Prefer the SNAPSHOT stored on the subscription over the live catalog —
      // see §7. Fall back to the catalog for tenants with no subscription row.
      plan: sub?.entitlements ?? (sub ? PLANS.get(sub.planKey).entitlements : {}),
      planKey: sub?.planKey ?? null,
      overrides: tenant?.entitlementOverrides ?? {},
      settings: tenant?.featureSettings ?? {},
      status: toLifecycleStatus(sub?.status),
    };
  },
};

/** YOUR billing states → the library's three generic ones. */
function toLifecycleStatus(status?: string) {
  if (status === 'canceled' || status === 'unpaid') return 'suspended' as const;
  if (status === 'past_due') return 'restricted' as const;
  return 'active' as const;
}
```

That `toLifecycleStatus` function is the entire billing seam. The library never
learns what `past_due` means.

## 4. Build the engine

A **module singleton**, like `@12-apps/rbac`'s.

```ts
// lib/entitlements/engine.ts
import { createEntitlements } from '@12-apps/entitlements';

export const entitlements = createEntitlements({
  features: FEATURES,
  plans: PLANS,
  source,
  usage: {
    // ⚠️ Keep this a port. The library must never write this query.
    count: (tenantId, feature) => USAGE_COUNTERS[feature](tenantId),
  },
  cache: redisEntitlementCache,
});
```

**Invalidate on every write** that could change the answer — plan change,
override edit, tenant toggle, subscription status transition:

```ts
await db.subscription.update({ ... });
await entitlements.invalidate(clientId);   // ← never skip this
```

## 5. Wrap a guard for your routes / actions

One thin wrapper, used by every route handler, server action and page.

```ts
// lib/entitlements/guards.ts
import { EntitlementRequiredError, QuotaExceededError } from '@12-apps/entitlements';

export async function requireEntitlement(feature: AppFeature, opts: { clientId: string }) {
  try {
    await entitlements.require(opts.clientId, feature);
  } catch (e) {
    if (e instanceof EntitlementRequiredError) throw new PaymentRequiredError(e.toPayload());
    throw e;
  }
}
```

Map both errors to **402**, with `toPayload()` as the body, so the client can
render an upsell that names the right plan.

### Check order

```
session → tenant membership → entitlement (402) → permission (403)
```

Entitlement first: plans are public marketing information, so nothing leaks, and
"upgrade to Pro" is a more useful message than "forbidden". Sequential, never
intersecting — see the README.

## 6. CI enforcement — fail the build on an ungated surface

The load-bearing safety net, and the same technique an RBAC coverage gate uses:
walk every route handler and server action, and fail CI unless each one calls an
accepted guard or is listed, with a reason, in a human-owned exclusions file.

1. Enumerate the guard identifiers that count (`requireEntitlement`, plus your
   RBAC guards).
2. Walk `app/api/**/route.ts` HTTP exports and `**/*actions.ts` server actions.
3. **Attribute guards per exported symbol, not per file** — otherwise a new
   ungated action piggybacks on a guarded sibling.
4. Strip comments and string literals before matching, so a guard named only in
   a `// TODO` never satisfies the gate.
5. Exclusions live in one protected file with a per-entry reason.

If you already have such a gate for permissions, **generalize it once** to serve
both: it is the same per-symbol attribution problem, and two near-identical
walkers will drift.

## 7. Snapshot entitlements on the subscription (if you bill)

Editing the Pro plan must not silently change what existing Pro tenants have.
Store the resolved map **on the subscription** at subscribe time, and read it in
`source.load` in preference to the live catalog (§3).

Migrating a tenant between plan versions then becomes a deliberate, auditable
write rather than an invisible side effect of a marketing change. This is the
single most common thing teams get wrong, and it is unfixable retroactively —
once tenants have drifted you cannot reconstruct what they were promised.

## 8. Wire the client

Resolve **server-side** and pass the snapshot down:

```ts
const snapshot = await entitlements.toSnapshot(clientId);
```

For an SPA, serve it over HTTP. If you already expose a permissions endpoint,
**return both from it** rather than adding a second round trip — the two are
always needed together, and one payload lets the nav resolve hide-vs-lock in a
single pass:

```ts
return Response.json({ permissions, entitlements: snapshot });
```

Then in the nav config:

```ts
interface NavItem {
  requiredPermission?: string | readonly string[];  // missing → HIDE
  requiredFeature?: AppFeature;                     // missing → SHOW, LOCKED, 🔒
}
```

Rendering them differently is the point: a hidden item teaches the user nothing,
a locked one sells. That distinction is only expressible because the layers are
separate.

## 9. Testing

- **Unit** — the resolution matrix across all four layers, quota algebra,
  plan composition, revoke policies.
- **Portability** — a toy second host with its own catalog and zero imports from
  your app. This is what proves the core stayed generic; without it the coupling
  creeps back within a release or two.
- **Integration** — against a real DB (e.g. PGlite): a gated route 402s when
  unentitled and 200s when entitled; an actor who *holds the permission* but not
  the plan gets **402, not 403** (proves the ordering is load-bearing); a
  downgrade leaves rows intact and blocks `create`.
- **Boundary** — importing the React entry pulls in no server surface.

---

## Gotchas checklist

- [ ] **Invalidate the cache on every write.** TTL is a backstop, not correctness.
- [ ] **Check-then-act is not atomic** — enforce quotas in the insert's
      transaction wherever an overage matters.
- [ ] **Never intersect permissions with entitlements** — you lose 402-vs-403
      and the upsell with it.
- [ ] **Only `not-entitled` is an upsell.** A tenant-disabled or restricted
      feature must not offer one.
- [ ] **Snapshot entitlements on the subscription** before you have subscribers,
      not after.
- [ ] **`0` means "none", not "unset"** — that is what lets a tier zero out an
      inherited quota.
- [ ] Keep `UsageCounter` a **port**; the moment the library writes a query it
      stops being portable.
- [ ] The CI gate must attribute guards **per exported symbol** and strip
      comments/strings, or ungated surfaces slip through.
- [ ] `retainWhenRestricted` on at least the read paths, or dunning bricks
      accounts you are still trying to collect from.
