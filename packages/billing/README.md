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
| `@12-apps/billing` | periods, the lifecycle vocabulary and its ageing, the entitlement seam, usage pricing and its breakdown check | **none** |
| `@12-apps/billing/server` | the retry policy, the cycle collection binding, one-off purchases, the subscription refund, the card vault, the HTTP surface | `@12-apps/payments-backend` (peer) |

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

## Usage past an allowance

`createUsagePricing` composes a cycle's charge from its base price and the
usage the period that just ended went past an allowance — one charge whose
**breakdown sums to its amount**, to the centavo. The package never counts:
the host reads its own count and hands it in as a reading per meter. The
meter key is the host's opaque name; the allowance and the price per unit are
config, checked at construction (`BillingConfigError`).

```ts
import { checkBreakdown, createUsagePricing } from "@12-apps/billing";

const pricing = createUsagePricing({
  currency: "BRL",
  meters: [{ meter: "units", allowance: 1000, unitPriceCents: 50 }],
});

const result = pricing.compose({
  base: { amountCents: 29_900, currency: "BRL", period: nextCycle }, // null: final settlement
  usagePeriod: endedPeriod,                                          // ends where nextCycle starts
  readings: [{ meter: "units", period: endedPeriod, used: 1237, final: true, overage: "BILLED" }],
  alreadyBilled: [],                                                 // overage on live/refunded cycles
});
// { ready: true, charge: { amountCents: 41_750, currency: "BRL", lines: [BASE 29_900, OVERAGE 237 × 50] } }
// { ready: false, waitingFor: ["units"] } while a billed count is not final
// { ready: true, charge: null } when there is nothing to bill — never a zero charge

if (result.ready && result.charge) {
  checkBreakdown(result.charge); // before persisting, and on every read back
}
```

The rules it holds:

- **A period's overage lands on the cycle that starts at its end.** A base
  whose period starts anywhere else is refused (`BillingUsageError`), and
  `base: null` is the only other place it can land.
- **A reading the package cannot trust bills nothing, it throws.** A missing,
  unknown, repeated or mis-dated reading, a count that is not a whole number,
  a base in another currency, an amount past safe integers:
  `BillingUsageError`. A missing count is never zero.
- **A usage period must start before it ends**, or `BillingUsageError`.
- **At most once.** One overage line per (meter, period), never one listed in
  `alreadyBilled`, and the same input always composes the same charge.
- **`checkBreakdown`** refuses (`BillingBreakdownError`) a charge whose
  lines are not whole and non-negative, do not sum exactly, repeat a period's
  overage or the base, carry an overage line whose own arithmetic is wrong,
  or add up to zero.

### The commercial rules, and where each one lives

| case | rule (owner, 2026-11-16) | what the host passes |
|---|---|---|
| when a count is final | units are dated by the moment they COMMIT; what committed by the boundary is billed, a late commit counts in the period it commits in | `final: true` at the boundary; no grace window |
| cancellation with overage pending | one final overage-only charge | `base: null`; the result is that charge, or `null` |
| downgrade mid-period | the overage counted so far, against the FULL allowance | the count so far, and no `allowance` on the reading (a stated `allowance` replaces the meter's for that period) |
| a refunded charge that carried overage | the overage goes back with the refund and is waived | the refunded cycle's overage stays in `alreadyBilled`; only a FAILED cycle's is left out, so its retry carries the same overage |
| a failed charge, retried | the retry carries the same overage | a FAILED cycle is not in `alreadyBilled` |

### Switching overage off

`overage: "OFF"` on a reading bills nothing past the allowance, whatever the
count, and never waits on a count that is not final; `"EXEMPT"` does the same
for a customer out of scope. **That is the whole switch** — per customer or
platform-wide, the host decides which readings say `OFF`, and the package
needs nothing else: no flag, no other config, no redeploy of this package.
A host that stops billing usage altogether (pricing by something else
instead) keeps composing with every reading `OFF`, or drops the meter from
its policy and passes no reading for it.

### The guard at the money boundary

`createSubscriptionCollection` takes an optional `breakdowns(cycleId)` lookup
— the breakdown the host persisted for a cycle, or `null` for a cycle that
has none (every cycle before usage pricing, charged exactly as before). With
it, a cycle is charged only when its breakdown passes `checkBreakdown` and
states the very amount and currency the cycle row will charge (a row that
already carries a provider charge is skipped by the collector and never
checked); otherwise
`BillingBreakdownError` is thrown and nothing reaches the provider. The amount
charged is always the row's, unchanged. `./server` re-exports
`BillingBreakdownError` for the host's catch.

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

`createSubscriptionRefund` returns one paid payment in full, at the platform
merchant, by binding `@12-apps/payments-backend`'s refund retrier — the flow
store refunds use — so it goes back by the channel it was paid (Pix to the
payer's key, a card to the card). Attempt 1 is sent only by the caller whose
`claim` moved the host's row from PAID to REFUND_PENDING; every later attempt
(the background sweep, `runDue`, or a person's `retry`) is claimed behind the
series row's version and consults the charge before it sends, so an answer
that was lost is adopted rather than refunded twice. A refusal, an unsupported
provider, lost credentials or a missing charge is recorded pending with why;
`settleByHand` records a refund made another way (who, how, why), and waits
while an attempt is in flight. The host's two writes are conditional, so a late
"pending" never overwrites a refund. Keep the series rows apart from any other
refund's: `runDue` drives every due row of the store it is given through this
binding. A provider PENDING snapshot is recorded as refunded, `confirmed:
false`, and two things follow it. `confirmDue` (the sweep) reads the charge
back: its money back confirms the refund; still unfinished — or unreadable —
past the host's `confirmations.confirmWithinMs`, it is only FLAGGED overdue for
a person and stays refunded, because a charge read cannot tell a slow refund
from a failed one, so it can never be returned twice. Flagged rows stay in the
list and are read again on every pass until they resolve. `refundUpdated` takes
the provider's own word: REFUNDED confirms, FAILED — the one evidence of a
failure — reopens it as a new request (`requestId`), whose retry is a new
series. The host hands `onWebhookEvent` (the same thing, shaped as
payments-backend's `WebhookEventHandler`) to its platform webhook delivery —
`handleWebhook(…, { onWebhookEvent })` — and it acts only on a REFUND_UPDATED
event verified against the binding's merchant. `markNotReturned` is a person's
escape for a refund the provider never confirms: only past the deadline, with a
non-blank who and why, after one more read of the charge (money back confirms
it instead; an unreadable charge is reported as `chargeRead: "UNREADABLE"`), it
reopens the refund as pending (`NOT_RETURNED`) under a new request, and never
sends. The host keeps the reopened refund's id (`notReturnedRefundId`): if that
refund lands after all, its REFUNDED word adopts it while the payment is still
pending, or — when the payment was returned again meanwhile — is recorded once
as a double return (`doubleReturned`) for a person to recover. A charge read
that adopts money back records it as that refund only while no second refund
was sent (`sendingAgain` tells the host before every send, `sentNothing` takes
it back when the answer proves nothing moved: FAILED, an answered refusal, or a
refusal before dispatch); after one that may have moved money, which
refund landed is unknown and the late word counts as a double return; and
`settleByHand` on such a payment reads the charge first, refusing with
`MONEY_BACK` or `CHARGE_UNREADABLE`. WHEN a payment is refundable, what a cancel
does to the plan and who may settle are the host's.

**Caveats.** A webhook replay (`replayWebhooks`) re-runs the gateway's own
handler only, not a per-delivery one: an update whose handler failed and that
a replay settles first is not handed to `refundUpdated` again; the sweep and
`markNotReturned` are the backstop. And a person's word is not the provider's:
the refund said never returned may still land after a retry or a hand
settlement sent the money again — the double return is recorded, never
prevented, so a host shows it to someone who can recover it.

```ts
const refunds = createSubscriptionRefund({ payments, merchant, store, series });
await refunds.refund(paymentId, { reason: "withdrawal" }); // REFUNDED | PENDING | NOT_REFUNDABLE
await refunds.retry(paymentId);                            // a person, after a refusal
await refunds.settleByHand(paymentId, { by, via, reason });
await refunds.runDue();                                    // the host's sweep
await refunds.confirmDue();                                // …and its other half
await refunds.refundUpdated(update);                       // the provider's word, by hand
await http.handleWebhook(request, { merchant, onWebhookEvent: refunds.onWebhookEvent }, provider);
await refunds.markNotReturned(paymentId, { by, reason });  // a person, past the deadline
```

### One-off purchases

`createOneOffPurchase` sells a customer something ONCE, paid in advance (a
prepaid pack, say), by a push code or the card on file, and calls the host's
`onSettled` exactly once when the payment is CONFIRMED. It raises through the
same `createCycleCollector` a cycle does — platform merchant, deployment
guard, instrument lookup, idempotent raise, a declined card recording nothing
— so nothing about the provider path is a second copy.

```ts
const purchases = createOneOffPurchase({
  payments, merchant, enabled, instruments,  // the same ones the collection takes
  purchases: () => purchaseStore(db),        // PurchaseStore, built per call
  onSettled: async (purchase, settled) => deliver(purchase.id),
  logger,                                    // { warn, error }; required
});
await purchases.startByPush(purchaseId);                               // CollectionResult
await purchases.startByCard(purchaseId, { cardholderPresent: true });  // a PAID answer settles at once
await purchases.reconcileDue();                                        // the host's sweep
```

**The reference says whose charge it is.** Every purchase charge is raised
under `purchase:<id>` (`PURCHASE_REFERENCE_PREFIX`), and from the second
attempt on `purchase:<id>--<n>`. The webhook reactor hands every PLATFORM
payment to the host's one `settlePlatformPayment`, which must ask the
purchases first and settle a cycle only on `"not-mine"`:

```ts
createWebhookReactor({
  // …
  async settlePlatformPayment(input) {
    if ((await purchases.settlePlatformCharge(input)) !== "not-mine") return;
    await settleCycle(input); // unchanged
  },
});
```

A purchase id must not contain `--`; a host cycle id must not start with
`purchase:` (no uuid or cuid does).

The rules it holds:

- **Exactly once.** Only the caller whose conditional `claimSettled` moved
  the row to paid calls `onSettled`. A replayed webhook, a racing sweep or a
  second payment answers `"already-settled"` and delivers nothing.
- **A shortfall is refused before the claim** (`"shortfall"`, logged): the row
  stays payable and nothing is delivered for a partial transfer.
- **An overpayment settles**, delivers the purchase and never more, and is
  reported — `excessCents` on `onSettled`, and a warning — for the host to
  return or keep.
- **A failed attempt can be retried.** A refused card (at `startByCard`) or a
  lapsed, refused or voided charge (at `reconcileDue`) calls `markFailed`,
  which advances the row's `attempt`; the retry is raised under the next
  reference, a FRESH charge rather than the provider's answer to the old key.
  A lapsed code paid late still settles while nothing else has.
- **`reconcileDue`** asks the provider about every `unanswered()` charge:
  paid settles, refused or lapsed fails (a push code by the provider's
  deadline, else the one recorded at the raise), unreadable is read again next
  pass. A refunded charge is left for a person.
- **`onSettled` throwing** is logged and rethrown, and the claim stands. A host
  whose delivery must be atomic with the claim delivers inside `claimSettled`
  and passes a no-op `onSettled`.

What stays the host's: the purchase row and its status vocabulary, what is
delivered, and what an excess or a second payment becomes. The provider's
charge description is the reference; the receipt copy is the host's.

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

- **what `charge: null` means.** `{ ready: true, charge: null }` is "nothing
  to bill for this composition" (for example a base of 0 with no overage). It
  is never "cancel the cycle": the host must not read it as an instruction.

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
- **the usage count and the overage switch** — what a meter counts, when a
  count is final, who is `EXEMPT`, whether overage is `OFF`, and where a
  cycle's breakdown is persisted.

Each one is checked at construction, not at the renewal that needed it: a
mis-stated policy throws `BillingConfigError` at boot, where an operator is.

## Adopting

See [ADOPTING.md](./ADOPTING.md).
