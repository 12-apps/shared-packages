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
| `GET /notifications/unread-count` | the inbox half of the badge number, a single indexed COUNT |
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

## One mail layout, and a console that previews it

`EMAIL` used to render a mail as three bare `<p>` tags. That is a **layout**
problem rather than a wording one — a paragraph with no document around it
inherits whatever the client decides: 13px Arial in Gmail, Times New Roman in
Outlook, no centring anywhere — so the layout ships here, beside the transport
that needed it.

```ts
import { renderEmail } from '@12-apps/notifications/email';
import { PT_BR_EMAIL_CHROME } from '@12-apps/notifications/email/locales';
```

`renderEmail(document)` takes STRUCTURE — a heading, paragraphs, an optional
facts table, at most one call to action — and never markup. Three things follow,
and each was a real defect in the renderers it replaces:

1. **Escaping cannot be forgotten.** It happens in one place.
2. **The plain-text twin cannot drift.** Both halves render from the same
   object. A `text/html` part with no `text/plain` twin is scored by every major
   spam filter.
3. **A preview is honest**, because the console renders exactly this.

The client constraints are encoded once so no caller has to know them: tables
rather than divs (Outlook lays HTML out with Word), inline styles only (Gmail
strips `<style>`), no web fonts or `color-mix()` or CSS variables, a hidden
preheader, a `bgcolor` attribute **and** a background style on the CTA.

**The EMAIL transport opts in.** Declare `layout` on the driver declaration and
`formatEmail` renders the shared document; omit it and you keep the previous
rendering byte for byte. Opt-in rather than automatic because `brand` and
`chrome` are required with no default — a package that defaulted them would sign
another company's mail, in a language nobody chose — so making them mandatory
would break every host already declaring EMAIL, at runtime, on the first send.

```ts
{ channel: 'EMAIL', driver: 'resend', apiKey, from, linkLabel: 'Ver detalhes',
  layout: { brand: 'Loja Exemplo', chrome: PT_BR_EMAIL_CHROME, locale: 'pt-BR' } }
```

### The preview console

There is normally no way to *see* a transactional mail without triggering the
event that sends it — signing up with a throwaway address for the verification
mail, settling an order for the receipt. So nobody looks, and a product
rendering three ways does not find out. A layout nobody can see is one release
from being three again, which is why the console ships in the same package.

It is the package's **second wiring manifest**
(`@12-apps/notifications-email-previews`), because the first has already spent
`http` on the account inbox and `surface` on the bell. That split is deliberate:
the inbox ships to every signed-in user, and this console publishes the whole
mail inventory and the exact wording and link shape of the verification and
reset mails. **You gate the mount** — the routes declare `kind: 'authenticated'`
and name no permission id, because the ids are the host's.

WHICH messages exist is yours too, declared as `sources` that are asked **per
request** (a source backed by a registry that fills at import time would
otherwise answer with whatever was imported first). A source reports its own
`coverage` — what it cannot show — and the screen renders that as a warning
strip rather than pretending to be complete. Nothing can be sent from it: it
holds no driver, no transport and no address.

See **[ADOPTING.md](./ADOPTING.md)** for the mount, the gate and the sources.

## Live activities — the centre's second kind of entry

An inbox notification is an EVENT: it happened, it is stamped, it is read or
unread, and tomorrow it still says the same thing. A **live activity** is
ONGOING STATE — pinned above the list, no read/unread, nothing to delete, it
updates itself, and it is gone the moment the thing it tracks finishes.

The distinction is not cosmetic. "Your order is on its way", read an hour later,
is a claim about the past presented as news; the more reliable the inbox is, the
more of those a person accumulates, and somewhere in the pile is the question
they actually have — *where is it now*.

Opt-in, and absent means absent: a host that passes nothing renders the panel it
had, with no section, no heading and no reserved space.

```ts
createWebNotifications({
  apiBase: '/api/account',
  messages,
  liveActivities: {
    // A HOOK, so it may read context — the tenant, the session, a query client.
    useActivities: ({ active }) => useMyLiveThings({ enabled: active }),
    messages: { sectionTitle, openActivity, updated },
    renderIcon: (activity) => ICONS[activity.kind],
  },
});
```

`active` is whether anyone is looking — `false` while the panel is shut. Pass it
to your query's `enabled`. It is a hint about NEED, never about correctness.

It is NOT a promise that a shut panel costs nothing: the bell calls the same
hook, and the bell is always mounted. `active` earns its keep on the closing
transition, where a query told to stand down does not fire one last time on the
way out.

One activity is `{ id, kind, title, body, link, steps, activeStepId, updatedAt }`
— `LiveActivity`, importable from either entry (`@12-apps/notifications` or
`@12-apps/notifications/react`, so a host wiring the surface needs one import
line, not two). It is defined in `src/live.ts`. `steps` + `activeStepId` draw a lane, because "how far along is
this" is the shape almost every ongoing subject has; both are optional in effect
— an activity with no lane is a heading, a sentence and a timestamp that keeps
moving. An `activeStepId` naming no step draws NO lane rather than a lane with
nothing lit, which would read as a process that has stopped.

### On a phone: one tray entry, one buzz

The other half is the OS notification, and it is one field. A generator whose
event is about something also tracked live puts the activity's id in `data`:

```ts
import { LIVE_SUBJECT_KEY } from '@12-apps/notifications';   // the root entry

data: { [LIVE_SUBJECT_KEY]: `order:${orderId}` }
```

`formatWebPush` turns that into a `tag` on the push payload, and a tag makes the
next push about the same subject **replace** the one already in the tray —
silently — instead of stacking under it. Four stages then cost one entry and one
buzz, and the entry that remains is the current one. Without it a phone
accumulates one alert per stage, each still asserting a stage the subject has
since left.

`tag` is `null` for an ordinary event rather than absent, so a service worker
reads one payload shape. A worker that ignores it keeps today's behaviour
exactly — which is what makes the field safe to ship ahead of the workers:

```js
self.registration.showNotification(payload.title, {
  body: payload.body,
  data: { link: payload.link },
  ...(payload.tag ? { tag: payload.tag, renotify: false } : {}),
});
```

## Attention — the third kind of entry

An inbox notification is an event that happened; a live activity is state a
reader follows. **Attention** is something waiting on the person looking at the
screen, with a clock on it: a plate under the lamp, a call nobody answered, a
courier at the door. It is never read or dismissed; it leaves when the work is
done, and until then it grows more urgent.

`@12-apps/notifications/attention` (framework-free) and
`@12-apps/notifications/attention/react` draw it as ONE round button for the
next thing to do, wherever the host mounts it.

| piece | what it does |
|---|---|
| `defineAttention({ categories, kinds })` | the host's wiring, checked once: category order, and per kind its budget, its conditions (`severity`), its permission |
| `readAttention(registry, items, { now, can })` | the queue: **severity first** (spent → late → calm), then category order, then kind order, then the longest wait |
| `AttentionHost` | the button, a quiet "+N" for the rest, sound/vibration for news, and the sheet each kind declares (`renderSheet`) or the host's own action (`onOpen`) |
| `AttentionHost` + `collapsed` | the folded mode: given its words (`tab`, `collapse`, `empty`), the button rests as a half disc on the right edge, halfway down, at every width — always drawn, even with nothing waiting, carrying the count in the worst severity's colour and pulsing as the open button would (still when it is still). A tap opens the button with a round "−" over or under it, away from the nearer edge, that folds it back; with nothing waiting it says so. It folds itself back when the last item leaves; a drag holds only while it is open. Sound, vibration and push keep working while it is folded |
| `createAttentionPreferences({ storageKey })` | sound, vibration, push level and the button's position, **per device** |
| `AttentionPreferencesPanel`, `AttentionQuickSettings` | the same settings, as a section of the host's user settings and as a small control for a sheet's header |

The ladder is fixed so every adopter agrees on "late": calm under one lap of the
kind's budget, late from one, spent from two — unless a kind's own `severity`
says otherwise (a courier at the door is late the moment it arrives). The button
asks harder as the clock runs: still under 40% of the budget, a soft pulse to
70%, a full one from there and while late, and once spent a faster pulse, a
shake and a second outline, so a reader who cannot tell green from amber still
tells the states apart. Nothing moves under `prefers-reduced-motion`.

Every sentence is the host's (`AttentionMessages`); there is no default table.
Sound is synthesised (or the host's files); vibration is `navigator.vibrate`,
which Safari on iPhone does not implement — `canVibrate()` says so and the
settings show it.

### Attention pushes, filtered per device

Push rides the `WEB_PUSH` channel above. A notification is an ATTENTION push
when its `data` carries the reserved key `attention` (`ATTENTION_DATA_KEY`) set
to the item's severity — `calm` for an arrival, `late` or `spent` once the clock
ran out. The transport then sends it only to the devices whose own push level
wants it (`wantsAttentionPush`): `off` takes none, `late` only the urgent ones,
`all` everything. A device that never chose takes them all, and a notification
without the key is not attention and reaches every device as before. None of
the user's devices wanting it is their choice, so the delivery succeeds without
sending rather than retrying.

The level is set in the browser (`createAttentionPreferences`, in
`localStorage`, where no server can read it), so the host's app sends it with
the subscription: `POST /push-subscriptions` takes an optional
`attentionPush` (`off` | `late` | `all`), stored on that device's
`push_subscriptions` row. Leaving it out keeps the stored level, so a
re-subscribe from a flow that knows nothing about attention cannot reset it;
`null` clears it. Re-post on every change of the level (`store.subscribe`).
A host on the packaged client sends it through
`api.savePushSubscription({ endpoint, keys, attentionPush })`.

On the server, a generator marks its notification with the key from the
framework-free entry:

```ts
import { ATTENTION_DATA_KEY } from '@12-apps/notifications/attention';

generate: (p) => ({ title, body, link, data: { [ATTENTION_DATA_KEY]: p.late ? 'late' : 'calm' } }),
```

A level the transport does not recognise (a newer app's, an older server's)
fails OPEN — the device takes every attention push — because an over-delivered
alert costs a glance and a dropped one costs a table. A push filtered out on
every device is recorded as `SENT` (it was delivered as the devices asked); it
is not retried. On a live activity (`liveSubject`), give the CLOSING stage a
severity every non-`off` level takes, or no `attention` key at all: a `late`
device never receives a `calm` replacement, and its earlier entry stays in the
tray.

What the push may NOT do while the app is open on that device — interrupt
someone already looking at the button — is the host's service worker's call:
skip `showNotification` when a visible client exists.

Sound needs a user gesture first, and Safari holds that per audio context: the
host unlocks on the page's first tap or key press (`useAttentionAlerts` listens
for it), so a later announcement can play. Pass `ready={false}` while the host
is still loading, so what was already waiting when the page opened never rings.
Check the views against the registry with `defineAttentionViews` — a typo in a
key would otherwise drop a whole kind silently.

## Toasts — the fourth kind of entry

An inbox notification is kept; a live activity is followed; attention waits
with a clock on it. A **toast** is the answer to the tap that just happened —
"Saved", "Item moved · Undo", "Could not move" — and it leaves
on its own unless it must be acknowledged.

Every toast in an app goes through ONE queue and is drawn in ONE place: a
column at the **top of the screen, centred**, no wider than `sm`, on the
**inverse surface** — near-black on a light theme, near-white on a dark one
(`neutralTones(theme).inverseSurface`, the tooltip's ground). Before this
surface each package drew its own, and the same news landed in four corners in
four looks.

| piece | what it does |
|---|---|
| `toast(message, options?)` (`@12-apps/notifications/toast`) | raise into the process-wide queue; `toast.success/info/warning/error/loading`, `toast.update(id, patch)`, `toast.dismiss(id?)`, `toast.promise(p, { loading, success, error })`. Framework-free |
| `options.id` | the same id REPLACES the toast in place and restarts its clock — a "last move" receipt, a retry |
| `options.actions` | buttons (`{ label, onClick, disabled?, keepOpen? }`); a tap runs it and the toast leaves unless `keepOpen` |
| `options.duration` | ms, or `null` to stay until closed. Defaults: 5s, 8s for `error`, `null` for `loading` |
| `ToastHost` (`@12-apps/notifications/toast/react`) | mount ONCE at the root with `dismissLabel` and `moreLabel(n)` — the only words it says. Draws the newest `max` (3) toasts; the rest wait with their clocks stopped |
| `<Toast open …>` | the packaged card for a toast whose state the HOST owns (an undo that greys out while its write is in flight) — live props, same column |
| `<ToastPortal>` + `<ToastSurface>` | a body of the host's own (its own buttons, a scroller) in the same column and the same frame. The subtree reads the inverse palette (`InverseTheme`), so library components inside it need no overrides |

The column is portalled under `<body>`, sits over every stacked sheet, takes
no room in the page and no taps outside its cards. A toast's clock stops under
the pointer and while focus is inside it. Errors are announced assertively
(`role="alert"`), everything else through the column's polite live region.

A `<ToastPortal>` with no `ToastHost` above it stands in a column of its own in
the same place, so a screen mounted alone (a test, a story) keeps its toasts
where the app would draw them.

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
