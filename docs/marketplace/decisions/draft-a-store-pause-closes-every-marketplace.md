# Draft — A paused kitchen closes the store on every marketplace, and the engine deletes only what it created

**Status:** proposed (numbered on merge)
**Scope:** `packages/marketplace` — the adapter port's `availability` capability, `pauseStore` / `resumeStore` / `availabilityState`, the `marketplace.availability` job and its sweep, the iFood, Rappi and 99Food adapters
**Ticket:** FUT-4851 (the engine half, K1a; the host wiring is K1b)

---

## Decision

The owner's decisions (2026-11-12), translated:

1. "When the store's kitchen is paused, the store is paused on every connected
   marketplace. The interruption sent carries the kitchen's estimated
   reopening time as its end, is renewed while the kitchen stays paused, and
   is deleted the moment the queue drops under the cap. The store is never
   closed on a marketplace longer than the kitchen's own pause."
2. "Pause at once when the cap is passed; reopen only after the queue has
   stayed under the cap for a store-configurable time, default 3 minutes."
3. From the ticket: "Never reopen a store the owner closed by hand on the
   marketplace, and never close one beyond what the kitchen's pause asked."

What follows for the engine:

1. **The debounce is the host's.** The engine receives `pauseStore({ clientId,
   until, reason, timeZone })` and `resumeStore({ clientId })`, nothing about
   queues or caps.
2. **Pausing is an OPTIONAL adapter capability**, `availability`, stated in
   one of two shapes, never inferred from a provider's id: an `interruption`
   (a closure with the marketplace's own id and an end: iFood) or a `switch`
   (a store-wide on/off: Rappi, Open Delivery's `merchantStatus`). A
   marketplace with no public way to pause has no capability, and the host
   shows that.
3. **The engine deletes only what it recorded.** One row per (store,
   marketplace) holds the closure's id, the end the marketplace took, and the
   key a create went out under while its answer is in doubt. A resume deletes
   those and nothing else; a marketplace where nothing of ours stands is not
   called at all.
4. **A renewal never opens the store.** iFood shows no call that moves an
   interruption's end, so the engine creates the later one first, then
   deletes the earlier.
5. **Never closed past the kitchen's pause.** An interruption carries the end
   itself. For anything else, and for a host that stops renewing, the sweep
   resumes a pause whose `until` has passed.
6. **A switch is opt-in per adapter** (`pauseByStoreSwitch`). It has no id, so
   rule 3 cannot be held in full: an owner who also closes the store by hand
   on Rappi or 99Food while the kitchen's pause stands sees it reopened when
   the pause ends. The engine still never turns on a store it did not turn
   off. The host decides, knowing this.

## Why each part is shaped this way

**The last ask wins.** The host's ask (`wanted`) and the marketplace's state
(`state`) are two fields, and the job re-reads the row after every call. A
resume that lands while a pause call is in flight finds the closure that call
recorded and deletes it next; a pause that lands during a resume creates a new
closure once the old is gone. A short lease on the row keeps two runs from
calling one marketplace for one store at once.

**A lost answer makes no second closure.** Every create goes out under a
stable key kept on the row until the answer is known. iFood's create is
preceded by a list, and an interruption under the key is reused; a resume of a
pause whose every answer was lost lists by the key and deletes what it finds.
A final refusal clears the key: nothing was created.

**Codes, not copy.** A failure is a machine code (`PAUSE_REFUSED`,
`PAUSE_UNANSWERED`, `RESUME_REFUSED`, `RESUME_UNANSWERED`, `NOT_CONNECTED`,
`UNSUPPORTED`) for the host's copy; the marketplace's own words travel
separately, verbatim and cut.

**Additive.** A new table, an optional delegate, an optional adapter member,
`DELETE` in the HTTP request's methods, two new job blueprints. No existing
call changes. Released as a minor: the only thing that can break is a
hand-written exhaustive `switch` over `MarketplaceHttpRequest["method"]`, or a
hand-written fake of `MarketplaceEngine` that must now implement five more
members.

## Consequences

- iFood's interruption paths and body come from two public third-party clients
  (iFood's portal refuses our reader); they are confined to
  `src/ifood/pause.ts` and marked ESTIMATED in the README, for the
  homologation run to correct in one file.
- The host (K1b) calls `pauseStore` on the kitchen's pause and on each
  renewal, `resumeStore` after its debounce, binds the two jobs, and draws
  `availabilityState`.
