# @12-apps/card-terminal

A paired card terminal at a point of sale, as a package of its own: the capture
ledger, the LAN link between a station and its terminal, the station's link
server, and the charge screens.

It depends on no other `@12-apps` package, and no payments package depends on
it. A point of sale depends on payments and on this package; payments knows
nothing of either, so a storefront that loads payments pulls none of the
terminal flow (FUT-4996).

| subpath | what | runs in |
|---|---|---|
| `./server` | the capture ledger, its stores (memory, Prisma), the readers, the refund sweep's job blueprint, and the caller-driven acts, excess and typed claims | any server |
| `./link` | the LAN protocol: messages, strict reading, HMAC-SHA256 signing | Node and React Native |
| `./station` | the station's link server, its sealed link cache, the offline capture book | Node |
| `./react` | the headless charge flow and its MUI screens (every word a prop) | browser |

`react`, `react-dom`, `@mui/material` and Emotion are optional peers: only
`./react` needs them.

## Caller-driven: the package decides, the caller writes

Every act moves only the capture (payment state) and answers with a result that
says what the caller must write in its OWN records: its sale, the sale's legs,
its till, its audit. Nothing here reads or writes those. The ledger takes the
caller's transaction handle, so the caller opens one transaction, calls the
package with it, then writes its own rows on the same handle.

The ledger's ports are the capture table (`TerminalCaptureStore`) and two
read-only directories that say whether a terminal, a sale or a payment row is
the tenant's.

### The refund sweep

`flag-unbound-captures` flags, every ten minutes, the captures whose money
nothing will claim once the ledger's `unboundRefundAfterMs` has passed:

- `UNBOUND_TIMEOUT`: no sale took the capture. A late bind clears it.
- `SALE_NOT_PAID`: a sale took it (ORDER_CREATED, so the terminal was
  acknowledged and never reports it again) and then was abandoned, neither
  paid nor cancelled. Implement `SaleDirectory.staleUnpaidSales(sales, cutoff)`
  to answer, of the sales asked, those written at or before `cutoff` and not
  paid. Name only what you know is unpaid: every sale you answer has its held
  captures flagged, and a bind does not clear that flag. Without the method
  the sweep leaves held captures alone and the job warns once a tick
  (`HELD_SWEEP_OFF_WARNING`). Your table needs a `created_at` beside
  `captured_at`; a partial index on the ORDER_CREATED rows by
  `(captured_at, id)` keeps the read cheap.

The held read pages on, by `(captured_at, id)`, past the rows you do not name
(a paid sale's leftover capture, a sale still inside the window), a few pages a
tick, and keeps its place between ticks, so such rows never hide a newer
abandoned capture. Its place lives in memory, on the ledger you create: create
the ledger once per process and run the job in a long-lived worker. A process
started fresh for every tick starts from the oldest rows every time and never
reaches past the first pages. Two things it does not judge: a sale paid by another tender
between your answer and the flag is still flagged, and a sale you leave open
(to be received later) past the window is flagged for good, so a receive after
it charges again.

### Refund a capture (`createCaptureActs(...).refund`)

1. Open a transaction.
2. `refund({ clientId, transactionCode, refundReason, capture?, orderId? }, tx)`.
   `RECEIVED_TWICE` fits only an unbound capture: on a capture a sale already
   holds it answers `{ ok: false, code: 'BOUND_ELSEWHERE' }` — even when the
   holder is this very sale — so word that code as "already paid on a sale",
   not "bound to another sale". Any other reason is yours.
3. `{ ok: true, flagged: true, record }`: write your audit row from `record`.
   `{ ok: true, flagged: false }`: a repeat; write nothing. `{ ok: false, code }`:
   show your words for `code`.
4. Commit.

### Pay a cash leg with the capture instead (`rebind`)

1. Open a transaction and LOCK the sale row (`SELECT … FOR UPDATE`) before
   reading your settled sale, its payment row and its legs. The lock is
   required: the engine plans from the legs you pass, so two different
   captures rebound onto one sale without it would both plan from the same
   cash leg and give back more cash than it held. A sale that is not a settled
   sale of the tenant is your refusal, not the package's.
2. `rebind({ clientId, transactionCode, orderId, paymentId, legs }, tx)`. The
   capture binds to the payment row by compare-and-set, on `tx` (required: an
   undefined handle throws, since the bind would otherwise commit alone).
3. `{ ok: true, moved: true, legs, cashBackCents, record }`: replace the sale's
   legs with `legs`, give `cashBackCents` back from the till, write your audit
   from `record`.
   `{ ok: true, moved: false }`: a repeat, or a concurrent twin moved it first;
   write nothing. `{ ok: false, code }`: `NO_CASH_LEG`, `NOT_FOUND`,
   `BOUND_ELSEWHERE`, `FLAGGED`, `CONTENDED`…
4. Commit. Throw instead and the bind rolls back with your writes.

### A capture above the total (`planExcess`, `admitExcess`, `createCaptureExcess(...).settle`)

1. `planExcess({ captures, dueCents, choice })` — pure.
2. `admitExcess(plan, { buyerHoldsCredit })` before anything is written — pure;
   you answer whether the sale has an identified buyer.
3. Open a transaction, write your sale, then `settle(plan, { clientId, orderId }, tx)`
   (`tx` required). It flags `REFUND_AND_RECHARGE`'s captures with the
   `refundReason` code you configured (e.g. a reduced total), on `tx`. It
   writes nothing else.
4. From the answer, in the same transaction: book `cashRefundCents` in your
   till (`CHANGE`), charge `rechargeCents` again (`REFUND_AND_RECHARGE`),
   write your audit from `record`. For `STORE_CREDIT`, also write the credit
   as an OUTBOX row of your own (`credit.dedupeKey`, `amountCents`, the
   buyer's sale `orderId`), so it commits with the sale or not at all; the
   `record` carries the same `dedupeKey` and `transactionCodes`. On
   `{ ok: false }`, roll back: some flags may already be on `tx`.
5. After the COMMIT, post each outbox credit to your wallet with its
   `dedupeKey` as the idempotency key, and retry until the wallet answers. The
   key is the tenant and the captures' codes, which a retry keeps (a retried
   sale gets a new id), so retries and a rolled-back attempt credit once, and
   a post that failed is never lost. If the wallet shares your database, post
   inside the transaction instead.

### A settle refused because the bill moved (`decideCaptureRefusal`)

A settle with terminal legs that you refused because the bill changed between
the charge and the settle: ask the package what the captures become, then write
it. `decideCaptureRefusal({ reason, captures, dueCents, changeLegCents?, choice?, withoutChoice? })`
is pure. `reason` is `UNDERCHARGED` (the bill grew), `OVERCHARGED` (collected
above the bill) or `WRITTEN_OFF_LINE` (a line came off since the charge);
`dueCents` is the bill now less every leg that is neither a capture nor the
change leg; `changeLegCents` is the cash handed over, if any.

| the bill… | change leg | choice | `kind` | you write |
|---|---|---|---|---|
| grew | any | any | `HOLD` (`refused`) | `ledger.hold` each of `hold` under your context key; charge `shortCents` |
| went down, nothing over | any | any | `HOLD` (`refused`) | as above |
| went down, cash covers the excess | cash ≥ excess | any | `CHANGE` (not refused) | settle with the cash leg less `changeCents` |
| went down, captures alone above it | none or too small | none (`withoutChoice: 'FLAG'`, the default) | `FLAG` (`refused`) | `ledger.flag` each of `flag` with your reduced-bill reason (once each); `ledger.hold` each of `hold`; charge `rechargeCents` |
| as above | none or too small | none, `withoutChoice: 'ASK'` | `ASK` (`refused`, `CAPTURES_EXCEED_TOTAL`) | nothing: ask the operator |
| as above | none or too small | given | `EXCESS` (not refused) | `admitExcess(plan)`, then `createCaptureExcess(...).settle` |
| — no capture at all | | | `NONE` | nothing |

`FLAG` takes the latest captures off until the rest fit the bill, as
`REFUND_AND_RECHARGE` does: a capture is flagged or held, never both, and one
that fits is never refunded. Write the flags and holds on your refusal's own
transaction (or right after it): a capture used by another settle in between is
the double count.

### Captures held for a sale context (`ledger.hold`, `ledger.findHeld`, `legs.heldFor`)

A capture a settle refused because the bill GREW is still good money: hold it
for the sale context it was taken for, under a key of your own (`holdKey`: an
opaque string, e.g. your bill's or tab's id), and ANY terminal settling that
context is offered it, not only the one that took it.

1. `ledger.hold({ clientId, transactionCode }, holdKey, tx?)` → `{ held }`.
   Holding it again for the same key writes nothing (`held: false`). Refused
   (`CaptureError`, nothing written): `NOT_FOUND`; `NOT_UNBOUND` (a sale holds
   it); `FLAGGED` (its flag is live: money owed back is never held);
   `BOUND_ELSEWHERE` (held for another key). Two keys racing: one wins, the
   other is refused.
2. `legs.heldFor(clientId, holdKey)` (or `ledger.findHeld`) — one read: the
   UNBOUND captures held for the key whose flag is not live, oldest first, as
   the leg wire. Offer them as already received; charge only the rest.
3. Settle with them as legs as usual (`heldForSale`, `bindingFor`). The bind
   lets go of the hold, and so does `markSaleCreated`; a bind that rolls back
   leaves it held.

A hold does not extend the sweep's window: a held capture still UNBOUND after
`unboundRefundAfterMs` is flagged `UNBOUND_TIMEOUT` and stops being offered.

**Your table must map the hold.** Add a nullable `hold_key` TEXT column
(`holdKey` on the model) to `terminal_captures`, ideally with a partial index
on `(client_id, hold_key) WHERE state = 'UNBOUND'`, and build the Prisma store
with `{ holds: true }`:
`createPrismaTerminalCaptureStore(client, { holds: true })` or
`prismaTerminalCaptureStoreFor(root, { holds: true })`. Without the option the
store never names the column (a table migrated before it keeps working),
answers no `findHeld`, `ledger.holdsReady` is false, and `hold` / `findHeld`
throw. A store of your own keeps holds by answering `findHeld` and honouring
`holdKey` in `writeIfUnchanged` (a predicate when `seen.holdKey` is present, a
column in the patch).

### Book a typed capture as a sale of its own (`createTypedCaptureClaims`)

1. `claimable({ clientId, deviceId, capture })`. Not `FREE`: answer
   `heldAnswer(claim, yourSaleBookedForThisCode)` (`BOOKED` `created: false`,
   `BOUND`, `FLAGGED` or `REFUSED`).
2. `FREE`: first `timeoutHold(claim, confirmedFlaggedAt)`. A capture the
   refund sweep flagged `UNBOUND_TIMEOUT` ("A estornar") may already have been
   refunded on the terminal, so it is booked only once a person confirmed that
   very flag: pass the `flaggedAt` the inbox's `book` hands you (null unless a
   person answered an entry showing the flag), unchanged: it is compared byte
   for byte with the flag's `toISOString()`, so never reformat it. Not null:
   answer it (`FLAGGED_TIMEOUT`, `flaggedAt` as ISO, `ack: false`) and write
   nothing. `timeoutHold` runs before your policy, so a store whose policy
   refuses "on its own" first shows the flag and only then `NOT_ALLOWED`.
   `claim.timeoutFlaggedAt` carries the flag date (D9-R22).
3. Then, if your policy and an open session allow it — otherwise answer your
   own `NOT_ALLOWED` / `WAITING` with `ack: false`, and the capture stays
   unbound: open a transaction and write your sale and its one payment row,
   sold by `claim.deviceId`.
4. `bind(tx, claim, { orderId, paymentId })` on that transaction → `BOOKED`
   `created: true`. The bind clears a timeout flag.
5. A lost race throws the ledger's `CaptureError`: your transaction rolls the
   sale back; go to step 1, which now answers the winner. Decide at most three
   times in all; still losing, answer `typedRefusalOf(error)` (`REFUSED`
   `CONTENDED`, `ack: false`) and let the terminal report the capture again.
6. Acknowledge the terminal only AFTER your transaction commits, and only on
   an answer with `ack: true`. `bind`'s `ack: true` means nothing if your
   transaction then rolls back.

### A typed capture flagged for a refund (`entry.flaggedAt`)

On the inbox, a `FLAGGED_TIMEOUT` answer puts the entry back on the band as
`asking`, with `entry.flaggedAt` (ISO) for the line "marcado para estorno em
{data}; confirme que não foi estornado na maquininha". An arrival, a resend or
`retry` never confirms a flag. A person does, by answering while the flag is
shown: `chooseStandalone`, or `chooseSale`. The confirmation is kept on the
entry (`entry.confirmedFlaggedAt`) until the capture is accounted for, so every
`book` sends it as its third argument, a `retry` after `WAITING` or a dropped
link included. A new `FLAGGED_TIMEOUT` (a re-flag, another date) clears it,
and a person answers again.

**The sale route.** A typed capture may match a due sale before anyone knows it
is flagged, and the general bind clears a timeout flag. So when you settle a
sale with a capture a person picked (`chooseSale`), first ask
`claims.pickHold({ clientId, deviceId, capture }, entry.confirmedFlaggedAt)`.
`FLAGGED_TIMEOUT`: do not bind that capture; hand the answer to the page,
`inbox.pickRefused(code, answer)`, which puts the entry back to `asking` with
the flag, unacknowledged. A person's second pick confirms it, and `pickHold`
answers null; your bind then clears the flag.

### Upgrading to 1.2.0 (held captures)

Additive: nothing you built before needs a change to compile or run.
`TerminalCaptureRecord.holdKey`, `CaptureVersion.holdKey`, `CapturePatch.holdKey`
and `TerminalCaptureStore.findHeld` are optional; `TerminalCaptureLedger` gains
`hold`, `findHeld` and `holdsReady`, and `TerminalLegs` gains `heldFor` — a
hand-built double of either needs them. To use holds, migrate the column and
pass `{ holds: true }` (above).

### Upgrading to 1.1.0

The additions are new fields and a new answer, so a host that builds these
objects by hand, or switches over them exhaustively, has to follow:

- `TypedBookAnswer` has a new member, `FLAGGED_TIMEOUT` (`flaggedAt`, `ack:
  false`): an exhaustive `switch` on `outcome` must handle it (answer it, write
  nothing, do not acknowledge).
- `TypedClaim`'s `FREE` carries `timeoutFlaggedAt`; `TypedCaptureClaims` gains
  `pickHold`. Test doubles of either need them.
- `TypedEntry` carries `unheldFrom`, `flaggedAt` and `confirmedFlaggedAt`;
  `TypedCaptureInbox` gains `unhold` and `pickRefused`. Hand-built entries and
  inbox doubles need them.
- `TypedCaptureInboxConfig.book` receives a third argument,
  `confirmedFlaggedAt`; an implementation that ignores it still compiles, but
  must pass it to `timeoutHold` for a flagged capture ever to be booked.

### A tapped sale that left without its capture (`inbox.unhold`)

On the station, `createTypedCaptureInbox` (`./react`) holds a typed capture the
cashier tapped onto a sale (`chooseSale` → `held`) until that sale settles with
it (`bound(codes)`, which acknowledges the terminal). When the sale leaves your
receivables WITHOUT it instead — paid another way, cancelled, discarded — call
`inbox.unhold(codes, reason?)`, with `reason` one of `'paid-elsewhere'`,
`'cancelled'` or `'discarded'`:

- each `held` capture goes back to `asking`, its sale cleared and its matches
  recomputed against the sales due now. `entry.unheldFrom` is
  `{ saleKey, reason }`, so the band can name the sale it left and how;
- it never acknowledges the terminal and never books, and an unheld capture is
  never booked by itself later either, even when nothing matches: only a
  person's "on its own" (`chooseStandalone`) books it;
- subscribers are notified once per capture it moves;
- a code that is not held, or whose sale already settled with it and only the
  acknowledgement is left (`waitingFor: 'link'`), is left as it is, so calling
  it again changes nothing.

A bind wins. Call `unhold` only once you know the sale left without settling
with that capture, never while your own settle of it is in flight. If a
`bound(codes)` still arrives for an unheld capture nobody answered since, it
settles it under the sale it left and acknowledges the terminal. Never use
`bound` in place of `unhold`: it acknowledges a capture no sale took.

## Moving from the payments subpaths

The deprecated `@12-apps/payments-backend/terminal` ships the same refund
sweep: both blueprints are named `flag-unbound-captures` on the `sweeps`
queue. While a host moves over, install exactly one of them. Two would only
run the same idempotent flagging twice, but there is no reason to.

## Release

Released on its own by semantic-release from the commits that touch
`packages/card-terminal` (`.releaserc.json`, `release-packages.txt`). Its first
publish is the token bootstrap described in the repository README.
