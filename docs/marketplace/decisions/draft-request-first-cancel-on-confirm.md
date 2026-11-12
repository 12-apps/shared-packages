# Draft — The store's cancel is a request; the order is cancelled on the marketplace's confirmation

**Status:** proposed (numbered on merge)
**Scope:** `packages/marketplace` — `recordStoreCancellation`, the order port, the outbound sweep
**Ticket:** FUT-4758

---

## Decision

The owner's rule (2026-11-12), translated: "It can only cancel once iFood
confirmed it was cancelled. But if I clicked cancel, there must be feedback that
it is trying to cancel, waiting for iFood to answer. It can't stay in that state
with nothing happening."

What follows for the engine:

0. **Opt in.** All of what follows applies to a host that binds
   `onCancellationConfirmed`; see Compatibility.
1. **The store's refusal or cancel records a REQUEST and nothing else** —
   `recordStoreCancellation`, and `decide` REJECT (the admin route, the MCP). Only the
   cancellation columns move (`cancellation_status` PENDING, the reason code,
   the SKUs, the request instant). The decision status stays AWAITING or
   ACCEPTED while the marketplace answers, and `decide` calls no
   `onRefused(…, "REJECTED")`. A marketplace whose API cannot take the request
   fails it at once (REFUSED): a person cancels in its app, and its event
   confirms.
2. **The marketplace's confirmation does the cancel.** Its CANCELLED event (or
   the job's answer, for a marketplace that answers in the response) moves the
   row to REJECTED/CONFIRMED and calls the host's OPTIONAL
   `onCancellationConfirmed(clientId, orderId)`, instead of
   `onRefused(…, "CANCELLED")`, which stays for a cancellation the marketplace
   made on its own and for a host that does not bind the callback.
3. **A failed request says why, and ends.** `cancellation_failure_reason` is
   REFUSED (the refusal event, the job's 4xx, the last attempt dying) or
   TIMEOUT (no answer). The host's OPTIONAL
   `onCancellationFailed(clientId, orderId, reason)` hears it once, from
   whichever path moved the row: the event, the job, or the sweep.
4. **No request waits forever.** The outbound sweep fails a request still
   waiting — PENDING (never delivered) or REQUESTED (delivered, unanswered) —
   older than the marketplace's answer window as TIMEOUT, and the store then
   cancels in the marketplace's own app. The adapter states the window
   (`capabilities.cancellationAnswerWindowMs`); the engine's
   `cancellationWindowMs` overrides it for every adapter. iFood's is 5 minutes,
   ESTIMATED: iFood's documentation names no deadline. A PENDING request's
   retries stop with it: the job sends only from PENDING, a run that starts
   past the window ends the request TIMEOUT itself without calling, and the
   sweep re-queues no FAILED row. A call already in flight when the window
   passes may still reach the marketplace; its answer then stamps nothing,
   and a later confirmation still confirms.
5. **A FAILED request stands for nothing.** The order may be accepted (the
   accept clears the request) or the cancellation asked again. A waiting
   request (PENDING or REQUESTED) refuses both, and no confirm is sent for an
   accepted order while its cancellation waits.

## Compatibility

Request first is OPT-IN: a host turns it on by binding the order port's
`onCancellationConfirmed`. A host that binds nothing new — every 1.0.0 host, the origin host included, which lists `pending()` and serves
`orderStates().status` — keeps 1.0.0's behaviour exactly: `decide` REJECT and
`recordStoreCancellation` stamp REJECTED at once, `decide` calls
`onRefused(…, "REJECTED")`, and a confirmation calls `onRefused(…, "CANCELLED")`
(also on the job's synchronous path now, which moves the row to REJECTED as the
event path does). The additions are a column, an index, two optional
callbacks, an optional window and a capability, so the release is a minor
(`feat`).

## Consequences

- A host must draw a waiting request as such (`orderStates().cancellation`
  PENDING or REQUESTED), or the order looks untouched.
- The host keeps the store's own reason (its loss record, who asked): the
  engine carries only the marketplace's reason code.
- The acceptance clock leaves an AWAITING order whose request waits alone: the
  request's own window (TIMEOUT) or answer ends it first, and only then does the
  clock apply. So the host hears exactly one ending per request.
- `decided.status` is the row's status after the call: AWAITING or ACCEPTED
  for a request that waits.
