# @12-apps/payments-backend

The server half of the payments surface: a provider-agnostic gateway, the
adapters behind it, the credential and charge stores, the webhook pipeline, and
the background reconciliation that catches what a webhook missed.

Four providers ship today — **PagBank**, **Stripe**, **Stone** and
**InfinitePay** — behind one adapter contract. Adding a fifth is a catalog
entry and an adapter; it is not a change to any host.

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

Nothing here decides what a payment *means* to your domain. Orders, stock,
subscription cycles and the copy a buyer reads stay in the host, on its own
vocabulary.

## Server-only

This package reads credentials and calls provider APIs. It is never imported
into a browser bundle; the browser half is `@12-apps/payments-frontend`, whose
subpaths are types-only where they cross the boundary.
