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

1. **`recordStoreCancellation` records a REQUEST and nothing else.** Only the
   cancellation columns move (`cancellation_status` PENDING, the reason code,
   the SKUs, the request instant). The decision status stays AWAITING or
   ACCEPTED while the marketplace answers. 1.0.0 stamped REJECTED at request
   time; its only host cancelled first and never read the status back.
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
4. **No request waits forever.** The outbound sweep fails a REQUESTED request
   older than the marketplace's answer window as TIMEOUT. The adapter states
   the window (`capabilities.cancellationAnswerWindowMs`); the engine's
   `cancellationWindowMs` overrides it for every adapter. iFood's is 5 minutes,
   ESTIMATED: iFood's documentation names no deadline. A PENDING request was
   never delivered; the job retries it and the sweep re-queues it, and only
   the 24-hour give-up ends it (TIMEOUT too).
5. **A FAILED request stands for nothing.** The order may be accepted (the
   accept clears the request) or the cancellation asked again. A waiting
   request (PENDING or REQUESTED) refuses both, and no confirm is sent for an
   accepted order while its cancellation waits.

## Compatibility

No option flag. The callbacks and the window are optional, so a 1.0.0 host
compiles and behaves as before, except for point 1, which no 1.0.0 host can
observe through the engine's API beyond `orderStates().status` (still ACCEPTED
or AWAITING while a request waits) and the acceptance queue (a waiting order
stays listed). Its only consumer, future-pay, adopts the callbacks in the same
round. The change ships as a minor (`feat`), not a major.

## Consequences

- A host must draw a waiting request as such (`orderStates().cancellation`
  PENDING or REQUESTED), or the order looks untouched.
- The host keeps the store's own reason (its loss record, who asked): the
  engine carries only the marketplace's reason code.
- An AWAITING order whose request waits is still on the acceptance clock: if
  the clock lapses first, `onRefused(…, "EXPIRED")` cancels it and a later
  confirmation calls `onCancellationConfirmed` again. Hosts make both
  idempotent.
