# @12-apps/payments-backend

The server half of the payments surface: a provider-agnostic gateway, the
adapters behind it, the credential and charge stores, the webhook pipeline, and
the background reconciliation that catches what a webhook missed.

Six providers ship today — **PagBank**, **Stripe**, **Stone**,
**InfinitePay**, **Itaú** (Pix only, over mTLS) and **Pix manual** (the store's
own Pix key as a static code, confirmed by hand) — behind one adapter contract.
Adding a seventh is a catalog entry and an adapter; it is not a change to any
host.

### Charges only the store can confirm

A provider whose `capabilities.confirmation` is `MANUAL` (Pix manual) is never
told it was paid: nothing calls back, and its `getCharge` answers PENDING
forever. The host settles it through the gateway instead:

- `gateway.confirmManualCharge(merchant, provider, id)` — someone saw the money
  arrive. PENDING → PAID in one compare-and-set (`ChargeStore.transitionPending`),
  then the gateway's `onWebhookEvent` runs exactly as for a provider webhook, so
  the host settles the order the one way it knows. Over a charge already PAID
  it re-runs the handler (the recovery after a failed settlement).
- `refuseManualCharge` / `expireManualCharge` — "não recebi", or the store's
  window lapsed. PENDING → CANCELED / EXPIRED; refused over a confirmed charge.
- `refreshCharge` reads the stored snapshot for such a charge and never writes.
- `ChargeOptions.confirmation: 'AUTOMATIC'` (also on `RaiseChargeRequest` and
  `buyerCheckoutConfig`) leaves these providers out, for a lane nobody watches.

## The rule this package exists to enforce

**A host keeps mounts and config. Everything else is the package's.**

That means the host supplies who is calling (the resolved actor and its
permission ids), where the data lives (the DB seam), and its own commercial
policy — plan ceilings, retry ladders, the words a buyer reads. The package
owns the mechanism: which API to call, how to shape the request, how to read
the response, when a charge may be reused, what a webhook meant, and the
double-charge rules around retrying.

If a host finds itself parsing a provider payload, mapping a status, branching
on a vendor's name, or restating a vendor's hostname, that code belongs here.

## Where to start

**[`../ADOPTING.md`](../ADOPTING.md)** is the integration guide — database,
backend wiring, frontend wiring, migrating an existing PagBank integration,
completing a live adapter, and consuming the package from another repository.
Read it before wiring anything; this file is only the orientation.

The two mounts it points you at:

- `mountPayments` — the provider credential/settings surface, given host auth,
  tenant resolution and the DB seam.
- `createPaymentFlowsBE` — the buyer checkout.

## A few exports worth knowing by name

These are the seams hosts most often re-implement by accident:

| export | answers |
|---|---|
| `pagbankApiBase(environment)` | PagBank's Orders API host. **Required argument** — a helper that guesses when asked about "no environment" is one that can route money at the wrong host silently. |
| `reconcilePendingCharges` | the sweep that re-reads charges the provider never called back about, so a dropped webhook does not strand a paid order |
| `createPrismaChargeStore` | the charge store the gateway and the sweep share |
| `classifyReversalEvent` | which reversal shape a delivery is — chargeback, refund, dispute |
| `chargeDeadlinePassed`, `pixChargePayable`, `hostedChargePayable` | whether a charge already raised is still payable |
| `attemptIdempotencyKey` | the per-attempt key that keeps a repriced order from being handed the old amount |

### Parked hosted links (FUT-4072)

A re-tap hands back a parked hosted link only where a fresh walk would land
first — the link's provider heads the current chain, or the providers ahead of
it are ones its walk failed over from and are still down. A link moved past is
voided, or marked superseded on its row and handed to your recorder; a link
the void finds already PAID becomes the answer, and the charge raised in its
place is retired instead. Three seams carry those guarantees, and are
effectively **required** for them, though optional in the types for
compatibility:

- `ChargeQueryStore.markSuperseded` (both shipped stores implement it). Without
  it a superseded link is never marked, so it can be offered back after the
  chain flips again and is retired on every attempt that meets it.
- `gateway.stillWalkedPast` (the shipped gateway implements it, from the attempt
  ledger and the outage breaker `health`). Without it — or without `health` —
  every re-tap during a head outage mints a fresh link and retires the last.
- `correlation.supersede` on the checkout mount, `onSuperseded` on
  `createChargeRaiser`: the record a later payment of the superseded link must
  meet in your payment handling. Make it idempotent on provider + charge id.

`createChargeRaiser` may now answer with an EARLIER charge of the reference whose
status is PAID — treat it as settled. A hand-written gateway passed as
`ChargeRaiseGateway` must implement `clientConfigChain`.

Nothing here decides what a payment *means* to your domain. Orders, stock,
subscription cycles and the copy a buyer reads stay in the host, on its own
vocabulary.

## Server-only

This package reads credentials and calls provider APIs. It is never imported
into a browser bundle; the browser half is `@12-apps/payments-frontend`, whose
subpaths are types-only where they cross the boundary.
