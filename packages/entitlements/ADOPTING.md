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

---

## 10. Or: mount the whole surface (`createApiEntitlements` + `createWebEntitlements`)

Steps 3–8 wire the ENGINE by hand. Since the surface factories landed, a host
can instead mount both halves and keep only config:

```ts
// server — Hono host (other frameworks: adapt `api.routes`, ~40 lines)
import { entitlementsRouter } from '@12-apps/entitlements/hono';

const { app: entitlements, api } = entitlementsRouter({
  features: FEATURES,
  plans: PLANS,
  source: { load: loadTenantState },          // your DB seam (step 3)
  usage: usageRegistry,                       // createUsageRegistry(...) — audited at boot
  defaultPlanKey: 'free',
  pricing: PRICING_ROWS,                      // display data from YOUR billing
  comparison: buildTierComparison,            // your pricing cards
  planChangeRequests: planRequestPort,        // your lead table, behind the port
  resolveActor: async (c) => {
    const grant = await requireTenantStaff(c);      // YOUR auth + RBAC
    return grant && {
      tenantId: grant.tenantId,
      userId: grant.userId,
      canRequestPlanChange: grant.can('config:write'),
    };
  },
});
app.route('/api/admin/:tenantSlug', entitlements);
// api.requireEntitlement / api.requireQuota / api.engine for your own gates
```

```tsx
// browser
import { createWebEntitlements } from '@12-apps/entitlements/react';

const { page: PlanPage, UpsellHost, withEntitlement } = createWebEntitlements({
  apiBase: `/api/admin/${tenantSlug}`,
  canRequestPlanChange: can('config:write'), // resolved by YOUR RBAC
  switchLocation: tenantSwitchLocation,      // feature -> { path, label } in YOUR routes
  plansPath: `/${tenantSlug}/planos`,
  LinkComponent: RouterLink,                 // your router's Link
});
```

Routes served (relative to the mount): `GET /entitlements` (the snapshot the
provider renders from), `GET /plan` (view + pricing cards), and — only when
`planChangeRequests` is configured — `GET|POST /plan/request`.

**The wire contract, explicitly.** Every SUCCESS body ships in the
`{ data: … }` envelope (`{ data: { plan } }`, `{ data: { snapshot } }`,
`{ data: { request, created } }`) — the same invariant future-pay documents
for its whole `/api/admin/**` surface, and the shape its MCP response schemas
declare. Denials and refusals are NEVER wrapped: 402/409/404 mirror the
host's `paymentRequired` error shape byte for byte, and 400/403 are plain
`{ error }` bodies. The packaged react half unwraps the envelope for you.
The POST answers `request: { id, status }` only — the lead's details
(`requestedPlanKey`, `createdAt`) live on the read next door, so the
`PlanChangeRequestPort.create` you implement returns exactly that pair.
`TenantPlanView.price` defaults to BRL wording (`"R$ 59,00"` / `"Grátis"`);
pass `formatPrice` in the config to word another currency.

### The money boundary, drawn precisely

`Plan`, `Subscription` and `PlanChangeRequest` are **billing models and stay in
the host**. What crosses into the package:

- the tier ladder as **config** (`definePlans` output — no price, interval or
  provider id);
- pricing **display rows** and pre-assembled comparison **cards** (strings and
  cents your billing computed — the package words them, never computes them);
- the plan-change ask through the **`PlanChangeRequestPort`** — a lead for a
  human, written to YOUR table. The package cannot write a tier, mint a charge
  or reach a provider.

The one table the machinery itself needs — `RetentionWatermark`, the
"downgrade never deletes" anchor — ships with the package
(`prisma/entitlements.prisma` + migrations, adopted via
`pnpm --filter @12-apps/entitlements prisma:sync` and the host's structural
migration copy).

⚠️ **`retention_watermarks.client_id` carries NO foreign key and NO cascade**
(the payments doctrine: a package model must not reference a table it cannot
know). Two consequences you own as the adopter: your repository layer is the
ONLY tenant boundary — every read and write of the watermark goes through the
package's `createRetention`, which scopes by `clientId` — and deleting a
tenant orphans its watermark rows. Sweep them in whatever job deletes the
tenant (`DELETE FROM retention_watermarks WHERE client_id = $1`), or accept
the orphans: they are two-column rows keyed by a tenant id that no sweep will
ever resolve a window for again.

### The coverage gate

`scripts/entitlements-coverage.mjs` (published with the package, zero
dependencies) is the page-side gate: every routed SPA page is either wrapped
in `withEntitlement("<key>", …)` or allowlisted with a reason. Point it at
your app with a JSON config:

```jsonc
// apps/admin/entitlements-coverage.config.json — paths relative to this file
{
  "routesFile": "src/routes.tsx",
  "pagesDir": "src/pages",
  "featuresFile": "../web/lib/entitlements/features.ts",
  "exceptionsFile": "entitlement-gate-exceptions.json",
  // Nullable, but NEVER omittable: `null` opts out of the check each drives,
  // while an absent key fails the run — for a completeness gate, silence must
  // be a decision, not an omission.
  "navFile": "src/shell/nav-groups.ts",
  "tenantSwitchFile": "src/lib/tenant-switch-locations.ts",
  // Optional: the <Route path="…"> whose children are the config pages the
  // tenant-switch map may point at (default "config").
  "configRoutePrefix": "config",
  // Optional: how the routes file spells its page imports; derived from
  // pagesDir's basename when omitted ("./pages/" for "src/pages"). The gate
  // fails rather than passes when the prefix parses zero routed exports.
  "routesImportPrefix": "./pages/"
}
```

```jsonc
// package.json
"entitlements:coverage": "node node_modules/@12-apps/entitlements/scripts/entitlements-coverage.mjs --config entitlements-coverage.config.json"
```

Note the file itself still imports nothing, but running it from
`node_modules` means the CI lane must install first — a caller of 12-apps/ci's
`entitlements-coverage.yml` that passed `install: false` for the vendored copy
flips that input when adopting the packaged one.
