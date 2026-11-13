# 0001 — One marketplace engine; each marketplace is an adapter

**Status:** accepted
**Scope:** `packages/marketplace` — the engine, its adapter port, and the iFood adapter
**Ticket:** FUT-4762 (the adapter port and this note), the engine half of FUT-4758

---

## Decision

The owner's rules (2026-11-11), translated:

1. "The integration engine must be the same for all integrations: iFood, Rappi,
   99. Only an adapter is made for each one, to connect to the base engine."
2. "This base engine must be a separate lib that implements the wiring package."

What follows from them:

1. **`@12-apps/marketplace` is the engine**, a published package implementing
   `@12-apps/wiring` (http, jobs, mcp, permissions, db, observability).
2. **Every marketplace is a `MarketplaceAdapter`** in the same package, at its
   own subpath: `@12-apps/marketplace/ifood` now, `/rappi` and `/99food` in a
   later delivery. Engine and adapters share one version.
3. **No provider-specific branch outside an adapter and its registration.** The
   engine dispatches normalize, signature, outbound calls, reasons and the app
   link through the adapter registry. A host asks
   `engine.adapter(provider).capabilities`, never `provider === "IFOOD"`.
4. **The provider id is an adapter's, not a closed list.** The type is a
   string; the database checks its shape; a new adapter is never a migration.

## The port

```ts
interface MarketplaceAdapter {
  provider: string;
  capabilities: { apiConfirm; apiCancel; cancelAfterAccept; asyncCancellationOutcome;
                  perOrderAppLink; confirmTakesPreparationTime };
  normalize(payload): NormalizedEvent | null;
  readSignature(header): string | null;
  verifySignature(rawBody, signature, secret): boolean;
  cancellationReasons(): CancellationReason[];       // static, offline
  confirm(ctx, order, { preparationMinutes }): Promise<OutboundResult>;
  requestCancellation(ctx, order, { reason, text, mode, offendingSkus }): Promise<OutboundResult>;
  appLink(order): string;                            // https
}
```

## Why each part is shaped this way

**Capability flags, not provider checks.** The three marketplaces researched
differ in exactly these flags: iFood and Open Delivery confirm and cancel by
API with the outcome arriving later as an event; Rappi takes an order with a
cooking time and can reject only before taking it, answering synchronously.
The engine reads the flags: a cancel after an accept on a marketplace that
cannot do it is stamped FAILED at once (the host shows the app link), and a
synchronous answer is CONFIRMED rather than REQUESTED.

**The outcome is asynchronous by default.** iFood and Open Delivery answer a
cancellation request with 202 and send CANCELLED or a refusal later, so the
request's state lives on the row (PENDING → REQUESTED → CONFIRMED | FAILED)
and inbound events move it, predicated so CONFIRMED is terminal.

**The HTTP client is a host port.** The engine never reaches the network on
its own: the host owns the timeout, the proxy and the CA, and every test
answers a fake. No path that answers a request makes the call; decisions only
enqueue `marketplace.outbound`, whose idempotency is the row's stamp.

**Reasons are static and offline.** A refusal dialog never waits on a
marketplace; a code the marketplace refuses for one order ends FAILED with the
app link. The labels are host copy (named packs), the codes the adapter's.

**No foreign keys into host tables.** The partial follows the discounts
doctrine: by-value scalars, so the package compiles into any host; the host
adds the constraints it wants. The migration adopts the predecessor's tables
replay-safely.

## Consequences

- Adding Rappi or 99Food is an adapter file, its copy packs and its
  registration; `src/__tests__/second-adapter.test.ts` proves it by driving a
  fake second marketplace through ingest, confirm and cancel with no engine
  change.
- iFood's URLs and reason codes are unverified (portal search snippets); they
  are confined to `src/ifood/outbound.ts` and `src/ifood/copy.ts`.
- The host keeps the stock draw, the settlement effects, the screens and the
  cancel route; the engine gives it `decide`, `recordStoreCancellation`,
  `suggestReason` and `orderStates` to build them on.

## Addendum — 99Food, and an order the event only announces (FUT-4763, FUT-4764)

99Food is the second adapter, `@12-apps/marketplace/99food` (provider
`NINETY_NINE_FOOD`), on Open Delivery v1.7.1. It needed one thing the port did
not have: Open Delivery's `CREATED` event names the order and carries none of
it. The port gains an OPTIONAL `fetchOrder`, and an event marks itself
`orderToFetch`. The engine never fetches inside the request that delivered the
event: the webhook records the row PENDING and queues `marketplace.fetch-order`,
whose job fetches through the host's HTTP port and ingests through the one
ingest path. It is a capability of the event, not a provider check, so iFood
(whose events carry the order) is unchanged and the next Open Delivery
marketplace is again an adapter and its registration. No migration: the
provider column checks a shape.
