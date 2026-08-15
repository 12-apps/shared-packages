# @12-apps/notifications

The channel-agnostic notification system: an always-on in-app inbox, per-user ×
per-category channel preferences, and email / SMS / WhatsApp / web-push
transports behind vendor drivers — both halves, one factory each.

```ts
const notifications = createApiNotifications({ db, contacts, transports });  // backend
const notifications = createWebNotifications({ apiBase });                   // frontend
```

Adoption contract, wiring rules and the seams: **[ADOPTING.md](./ADOPTING.md)**.

## Three layers, each open without touching the others

```
GENERATORS          domain event  →  agnostic content   { title, body, link, data }
      ↓
CHANNEL ROUTER      always writes the inbox record, then fans out one QUEUED
                    delivery per channel that is (a) enabled by the recipient's
                    preferences for the generator's category and (b) supported by
                    its transport for this recipient
      ↓
TRANSPORTS          format the agnostic content for one channel and send it,
                    through a vendor DRIVER
```

Adding an event type is a generator. Adding a channel is a transport. Adding a
**vendor** is a config entry. None of the three touches the other two.

## What one emit does

```ts
await notifications.notify({
  type: 'order.paid',
  recipient: { userId, clientId },
  payload: { code: 'A-1024' },
});
```

1. Resolves the registered generator for `type` → agnostic content.
2. **Always** writes the inbox record — the always-on channel — atomically with…
3. …one QUEUED delivery per channel that survives the preference gate, the
   transport's `supports()` gate and the host's plan policy.
4. Hands the deliveries to the transports asynchronously, so an emit site never
   blocks on provider I/O.

`notify` opens its **own** transaction and a host cannot join it, so call it
**after** your own transaction commits — from inside one it commits an inbox row
and dispatches an e-mail for a payment that then rolls back.

Failure is isolated per channel: one provider failing marks only its row FAILED
(with the provider's error) and never blocks the inbox record or the other
channels.

## The delivery lifecycle

```
QUEUED ──claim──▶ SENDING ──▶ SENT
                     │
                     ├──▶ FAILED ──sweep──▶ QUEUED   (attempts < max)
                     └──▶ DEAD                        (attempts = max, terminal)
```

Every send is **claimed** first: one conditional `UPDATE` moves the row out of
`QUEUED`, and the sender proceeds only if it moved exactly one row. So two
dispatchers racing one delivery — two cron runners, a sweep overlapping itself,
the two app containers a zero-downtime rollout briefly runs — produce exactly one
provider call. Delivery is still at-least-once, but the remaining window is the
unavoidable one: a crash between the provider call and the `SENT` flip. Transports
must tolerate that.

`drainPending(olderThanMs, take)` is the retry sweep a host puts on a cron. It
selects on `updated_at` (so a row it just re-queued is not stale again on the next
tick), takes at most `take` rows (default 200), and re-queues each with the same
conditional shape — so it can never drag a committed `SENT` row back. Each claim
spends one of `maxDeliveryAttempts` (default 5); the last failure writes `DEAD`,
which no sweep selects again.

## The endpoints

Mounted under whatever prefix the host chooses (the origin host: `/api/account`):

| | |
|---|---|
| `GET /notifications` | the owner's inbox — newest first, cursor-paginated, `filter=unread` |
| `GET /notifications/unread-count` | the badge number, a single indexed COUNT |
| `POST /notifications/mark-read` | `{ ids }` or `{ all: true }`; idempotent, reports what moved |
| `POST /notifications/delete` | soft delete, 1..100 ids; the delivery trail survives |
| `GET` / `PUT /notification-preferences` | the category × channel matrix, plus per-channel AVAILABILITY (destination on file + channel declared) so dead toggles render disabled with a hint |
| `GET` / `POST` / `DELETE /push-subscriptions` | the VAPID public key + device count; register / drop this browser. `GET ?endpoint=…` also answers whether the server still has THAT endpoint under the caller |

Success is `{ data }`; a denial is `{ error }`, unwrapped. Every endpoint takes its
subject from the actor and never from the request — and eight of the nine are
cookie-authenticated writes, so the host owes them a CSRF story (ADOPTING rule 13).

## The channels

| Channel | Built-in drivers | Destination |
|---|---|---|
| `EMAIL` | `resend`, `log` | the contact directory's `email` |
| `SMS` | `twilio`, `log` | `phone`, normalized to E.164 (`defaultCountryCode` required) |
| `WHATSAPP` | `meta`, `log` | `phone`, free-form or a pre-approved template |
| `WEB_PUSH` | `vapid`, `log` | the user's `push_subscriptions` rows, all of them |

`log` is the dev/e2e driver: it logs instead of sending, and deliberately logs
**no destination** — an address and a phone number are PII, and a push endpoint
is a bearer capability for that browser.

`defaultCountryCode` is required on both phone channels rather than defaulting to
Brazil: a US adopter that forgot it turned `4155552671` into `+554155552671` — a
plausible Brazilian mobile — and texted a stranger the customer's order.

Web Push prunes a subscription the push service reports GONE (404/410) and
succeeds when at least one browser accepted the payload, so the table self-heals
as browsers expire subscriptions. A transient failure (503) prunes nothing:
pruning there would destroy a live destination. A push endpoint belongs to a
browser PROFILE, not to a user, so registering the same browser as a second user
re-owns the row (the safe choice — the alternative leaks A's notifications to B in
a form B's keys decrypt) and the preferences screen derives "this browser is
receiving alerts" from the SERVER's answer, not from the browser's own
subscription object.

## The models

`prisma/notifications.prisma` — `Notification`, `NotificationDelivery`,
`NotificationPreference`, `PushSubscription` — plus this package's own
migrations, COPIED into a host's schema folder (never symlinked). See ADOPTING.

`notification_preferences.channels` is a JSON map rather than a boolean column
per channel: the channel set is open-ended, and a stored row missing a key falls
back to that channel's default, which is what makes the ARRIVAL of a channel a
no-op for every existing row.

## Testing

```bash
pnpm --filter @12-apps/notifications test         # 159 unit tests
```

The unit suites pin the logic against an in-memory db seam. The same contracts
are then re-run against a **real Postgres**, out of the **published tarball**, in
`harness/backend` — and the frontend surface is driven by Playwright against that
same server in `harness/frontend` (page `notifications-center`). An in-memory
double can agree with a wrong SQL translation; the harness is what makes the port
real.

The **concurrency** contracts are the clearest case for that, and they are pinned
in both places on purpose. A single-threaded fake agrees quite happily with a
read-validate-write dispatcher — the send resolves before any second caller can
reach the row — so "two dispatchers, one delivery" is asserted over real SQL with
the sends held open, where the predicate is evaluated by Postgres against the row
version the other dispatcher committed.
