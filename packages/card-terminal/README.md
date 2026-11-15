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

### Refund a capture (`createCaptureActs(...).refund`)

1. Open a transaction.
2. `refund({ clientId, transactionCode, refundReason, capture?, orderId? }, tx)`.
   `RECEIVED_TWICE` fits only an unbound capture; any other reason is yours.
3. `{ ok: true, flagged: true, record }`: write your audit row from `record`.
   `{ ok: true, flagged: false }`: a repeat; write nothing. `{ ok: false, code }`:
   show your words for `code`.
4. Commit.

### Pay a cash leg with the capture instead (`rebind`)

1. Open a transaction; read your settled sale, its payment row and its legs.
   A sale that is not a settled sale of the tenant is your refusal, not the
   package's.
2. `rebind({ clientId, transactionCode, orderId, paymentId, legs }, tx)`. The
   capture binds to the payment row by compare-and-set, on `tx`.
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
3. Open a transaction, write your sale, then `settle(plan, { clientId, orderId }, { tx, note })`.
   It flags `REFUND_AND_RECHARGE`'s captures with the `refundReason` code you
   configured (e.g. a reduced total) and posts `STORE_CREDIT` through the
   `credit` port you wire to your wallet (which must dedupe per sale: it runs
   outside your transaction).
4. From the answer: book `cashRefundCents` in your till (`CHANGE`), charge
   `rechargeCents` again (`REFUND_AND_RECHARGE`), write your audit from
   `record`. On `{ ok: false }`, roll back.

### Book a typed capture as a sale of its own (`createTypedCaptureClaims`)

1. `claimable({ clientId, deviceId, capture })`. Not `FREE`: answer
   `heldAnswer(claim, yourSaleBookedForThisCode)` (`BOOKED` `created: false`,
   `BOUND`, `FLAGGED` or `REFUSED`).
2. `FREE`, and your policy and an open session allow it — otherwise answer your
   own `NOT_ALLOWED` / `WAITING` with `ack: false`, and the capture stays
   unbound: open a transaction and write your sale and its one payment row,
   sold by `claim.deviceId`.
3. `bind(tx, claim, { orderId, paymentId })` on that transaction → `BOOKED`
   `created: true`.
4. A lost race throws the ledger's `CaptureError`: your transaction rolls the
   sale back; go to step 1, which now answers the winner. Acknowledge the
   terminal only on an answer with `ack: true`.

## Release

Released on its own by semantic-release from the commits that touch
`packages/card-terminal` (`.releaserc.json`, `release-packages.txt`). Its first
publish is the token bootstrap described in the repository README.
