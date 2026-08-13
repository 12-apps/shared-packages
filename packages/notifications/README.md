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

Failure is isolated per channel: one provider failing marks only its row FAILED
(with the provider's error) and never blocks the inbox record or the other
channels. Delivery is at-least-once — the unique `(notification, channel)` row
makes fan-out idempotent, and a re-dispatch may re-send if a crash landed
between the provider call and the SENT flip, so transports must tolerate it.

## The endpoints

Mounted under whatever prefix the host chooses (future-pay: `/api/account`):

| | |
|---|---|
| `GET /notifications` | the owner's inbox — newest first, cursor-paginated, `filter=unread` |
| `GET /notifications/unread-count` | the badge number, a single indexed COUNT |
| `POST /notifications/mark-read` | `{ ids }` or `{ all: true }`; idempotent, reports what moved |
| `POST /notifications/delete` | soft delete, 1..100 ids; the delivery trail survives |
| `GET` / `PUT /notification-preferences` | the category × channel matrix, plus per-channel AVAILABILITY (destination on file + channel declared) so dead toggles render disabled with a hint |
| `GET` / `POST` / `DELETE /push-subscriptions` | the VAPID public key + device count; register / drop this browser |

Success is `{ data }`; a denial is `{ error }`, unwrapped.

## The channels

| Channel | Built-in drivers | Destination |
|---|---|---|
| `EMAIL` | `resend`, `log` | the contact directory's `email` |
| `SMS` | `twilio`, `log` | `phone`, normalized to E.164 |
| `WHATSAPP` | `meta`, `log` | `phone`, free-form or a pre-approved template |
| `WEB_PUSH` | `vapid`, `log` | the user's `push_subscriptions` rows, all of them |

`log` is the dev/e2e driver: it logs instead of sending, and deliberately logs
**no destination** — an address and a phone number are PII, and a push endpoint
is a bearer capability for that browser.

Web Push prunes a subscription the push service reports GONE (404/410) and
succeeds when at least one browser accepted the payload, so the table self-heals
as browsers expire subscriptions. A transient failure (503) prunes nothing:
pruning there would destroy a live destination.

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
pnpm --filter @12-apps/notifications test         # 139 unit tests
```

The unit suites pin the logic against an in-memory db seam. The same contracts
are then re-run against a **real Postgres**, out of the **published tarball**, in
`harness/backend` — and the frontend surface is driven by Playwright against that
same server in `harness/frontend` (page `notifications-center`). An in-memory
double can agree with a wrong SQL translation; the harness is what makes the port
real.
