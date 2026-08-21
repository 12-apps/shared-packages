# @12-apps/billing

Subscription billing for a platform that charges its own customers: the period
arithmetic a renewal anchor survives, the lifecycle a read ages against its own
dates, the retry policy that decides whether a failed collection is worth
another attempt, and the card-on-file surface over a provider vault.

Every number, table and sentence with a commercial opinion in it is **required
config**. The package owns the mechanism and none of the policy — see
[What stays host-owned](#what-stays-host-owned).

## Two entries, because bundles are physics

| entry | contains | dependencies |
|---|---|---|
| `@12-apps/billing` | periods, the lifecycle vocabulary and its ageing, the entitlement seam | **none** |
| `@12-apps/billing/server` | the retry policy, the cycle collection binding, the card vault, the HTTP surface | `@12-apps/payments-backend` (peer) |

A browser that needs to say "this account is past due" imports the root entry
and pays nothing for the money path. The split is not taste: the payments
package is server code, and one shared entry importing it would drag
`node:crypto` into every SPA that ever read a billing status.

## The isomorphic half

```ts
import { createBillingLifecycle, periodEnd, anchorDayOf } from "@12-apps/billing";

const lifecycle = createBillingLifecycle({ graceDays: 7, suspendAfterDays: 30 });
lifecycle.effectiveStatus(row.status, row, new Date()); // "past_due"
```

**The anchor day is an input.** A customer who subscribes on the 31st has no
31st in February; clamping is the only sane answer, but clamping *and then
advancing from the clamped date* walks their billing day permanently earlier
(31 Jan → 28 Feb → 28 Mar → …). `anchorDayOf(subscribedAt)` is read once from
the subscribe instant and survives every clamp.

**Every read ages the row.** A sweep that stops running must not silently hand
out free service, so `effectiveStatus` takes the harsher of (stored,
implied-by-dates). The sweep then only ever persists what a read would already
have concluded — it is a materialization, not the source of truth.

**`createBillingLayer` is the whole translation into a gate.** It turns one
subscription row into `{ planKey, plan, status }`, or `null` when billing has
no opinion at all. Both mapping tables are yours; see below.

## The server half

```ts
import { createChargePolicy, createSubscriptionCollection, createCardVault } from "@12-apps/billing/server";

const policy = createChargePolicy({
  maxAttempts: 4,
  backoffMs: [30 * 60_000, 2 * 60 * 60_000, 8 * 60 * 60_000],
  stopWithoutNewCard: ["INSUFFICIENT_FUNDS"],
});
policy.decideAfterDecline(snapshot, attempts); // { kind: "RETRY", delayMs } | STOP | ALERT | ABORT | DONE
```

`decideAfterError` and `decideAfterDecline` ask three questions in order — did
it become a charge, did the provider say no and why, and is another attempt
possible at all — against `@12-apps/payments-backend`'s taxonomy rather than a
second copy of it, so "is this safe to retry" has exactly one answer.

The vault is two calls and a removal. `begin` opens a provider session for one
subscription; `complete` is reached from the browser, so its session id is
attacker-supplied — what makes it safe is that the `reference` handed to the
adapter comes from the host's own subscription row through the `findTarget`
port, never from the request. `forgetAll` detaches **every** pointer the owner
holds, not the one on the screen: a card can live at yesterday's acquirer as
well as today's.

Nothing here has a parameter a card could travel in. The number goes from the
cardholder's keyboard to the provider's SDK to the provider; what crosses these
seams is an opaque vault id and the display metadata the provider shared.

## Wiring

The package is a `@12-apps/wiring` producer. It declares `http` and nothing
else, and each absence is deliberate:

| capability | declared | why |
|---|---|---|
| `http` | ✅ | the card-on-file surface, four endpoints |
| `observability` | ✅ | namespace `billing` — the money path is the last place a failure may file nowhere |
| `db` | ❌ | subscriptions, cycles and instruments all carry foreign keys into a host table; a package partial cannot declare a relation into a table it does not own |
| `permissions` | ❌ | who may put a card on file is a role decision, not a permission id this package could name for every host |
| `notifications` | ❌ | the one notice this domain sends is entirely host copy |
| `mcp` | ❌ | a surface that writes a payment instrument stays in a browser, behind a human |
| `env` | ❌ | the package reads no environment variable; everything arrives as config |

```ts
import { billingManifest } from "@12-apps/billing/manifest";
import { billingServerManifest } from "@12-apps/billing/manifest/server";
import { createWiringHost } from "@12-apps/wiring/consumer";

const host = createWiringHost({ name: "web", kind: "server", ports: { loggerFor } });
host.adoptServer({
  manifest: billingManifest,
  server: billingServerManifest,
  bindings: { http: { mountPath: "/api/admin/:tenantSlug/subscription", config: { /* … */ } } },
});
const wired = host.assemble();
```

`@12-apps/wiring` is a **type-only** devDependency here; the producer
assertions run in this package's own suite, so a malformed manifest fails
before any host sees it.

## What stays host-owned

Everything below is a required argument, with no default to fall back to
silently:

- **the two lifecycle windows** — how long before a late payer is penalised,
  and how long before they are suspended. One platform chases for a week and
  suspends after a month; the next gives a fortnight and never suspends at all.
- **the retry ladder, the attempt cap, and which declines are chased rather
  than retried.** The payments package refuses these by name — "retry ladders,
  grace windows, when to ask for a different card, is each host's commercial
  policy" — and the same boundary holds one layer up.
- **both gate tables** — which lifecycle each billing state reaches the gate
  as, and which states keep the tier they froze.
- **every sentence and every status code** the HTTP surface can answer with. A
  default in the origin platform's language reads as finished to the next
  platform right up until it reaches a user.
- **the guard.** Nothing here authenticates anybody; the host mounts these
  behind its own resolution and hands the resolved owner in as the actor.
- **the database**, through the ports in `./server` — the cycle rows, the
  instrument rows and the subscription lookup.

Each one is checked at construction, not at the renewal that needed it: a
mis-stated policy throws `BillingConfigError` at boot, where an operator is.

## Adopting

See [ADOPTING.md](./ADOPTING.md).
