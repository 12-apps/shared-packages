# Adopting `@12-apps/billing`

A host adopts this package in three passes, and each one is independently
useful: the isomorphic domain first (no ports, no config beyond two numbers),
then the collection binding, then the HTTP surface. Nothing forces the third.

## 1. The domain

Replace hand-rolled period arithmetic and status ageing with the package's, and
keep your numbers where they are:

```ts
// lib/billing/status.ts — your policy, the package's mechanism
import { createBillingLifecycle } from "@12-apps/billing";

/** Days after a cycle's due date before the customer is penalised at all. */
export const GRACE_DAYS = 7;
/** Days after the SAME due date before the account is suspended outright. */
export const SUSPEND_AFTER_DAYS = 30;

const lifecycle = createBillingLifecycle({
  graceDays: GRACE_DAYS,
  suspendAfterDays: SUSPEND_AFTER_DAYS,
});

export const { effectiveStatus, daysWithoutPaying, graceEndsAt, suspendsAt } = lifecycle;
```

The file that used to hold the algorithm now holds only the decision, which is
the shape every one of these adoptions converges on.

`createBillingLayer` is the same move with two tables instead of two numbers:

```ts
const billingLayer = createBillingLayer<EntitlementMap<AppFeature>, LifecycleStatus>({
  lifecycle,
  lifecycleByStatus: { trialing: "active", active: "active", past_due: "restricted", unpaid: "suspended", canceled: "active" },
  keepsItsTier: { trialing: true, active: true, past_due: true, unpaid: true, canceled: false },
  defaultTier: () => ({ planKey: DEFAULT_PLAN_KEY, plan: { ...PLANS.get(DEFAULT_PLAN_KEY).entitlements } }),
  frozenTier: (entitlements) => toEntitlementMap(FEATURES, entitlements),
});
```

Both tables must name every status; an omission throws at construction rather
than defaulting a state you never considered into one you did.

## 2. Collection

`createSubscriptionCollection` binds the payments package's cycle collector to
your platform merchant. You supply the two stores:

```ts
const collection = createSubscriptionCollection({
  payments,                       // () => Promise<{ gateway, credentials }>
  merchant: PLATFORM_MERCHANT,    // kind: "PLATFORM" — never a tenant's own account
  enabled: platformCollectionEnabled,
  cycles: async () => cycleStore(await getPrismaClient()),
  instruments: lookupInstrument,
});
```

`cycles` is a **factory**, called per collection, because a host builds its
store over a database client it resolves lazily. `enabled` is checked first and
early: a deployment with no platform account should do nothing quietly rather
than throw once per customer deep inside the gateway.

## 3. The card-on-file surface

Adopt through `@12-apps/wiring/consumer` and bind `http`. The four descriptors
mount under whatever prefix you give them:

| method | path | |
|---|---|---|
| `GET` | `/card` | display metadata only |
| `POST` | `/card/session` | open a vault session |
| `POST` | `/card` | finish one (`{ sessionId }`) |
| `DELETE` | `/card` | take every card off file |

Three obligations come with it.

**`copy` is required, in full.** Every rejection this surface can produce needs
a sentence and a status code in your words. A blank message or a 2xx status
fails at construction.

**The guard stays in your route file.** The package resolves nothing about who
is calling; it reads `request.actor.ownerId` and no more. Keeping the guard
written where a coverage gate can read it is the point — a route whose
authorization hid behind a helper reads as unprotected to the gate, and to the
next person opening the file.

**`findTarget` must resolve from your own row.** The subscription id it returns
is stamped into provider metadata by `begin` and demanded back by `complete`;
resolving it from anything the request influenced would defeat the check that
stops one owner attaching a card to a stranger's subscription.

A host that keeps one route file per endpoint (because its coverage gates read
guards out of route files) still adopts: mount by hand from the assembled
aggregate, and pin `unclaimedRoutes(wired.routes, claimed)` to `[]` in a unit
test. That pin is what turns "a version bump shipped a descriptor this host
never mounted" from a silent 404 into a red test.

## What this package will never take from you

Anything a second platform would answer differently: the windows, the ladder,
the gate tables, the copy, the status codes, the guard, the schema. If you find
yourself wanting a default for one of them, that is the seam working — the
value is a decision, and a decision with a default is a decision nobody made.
