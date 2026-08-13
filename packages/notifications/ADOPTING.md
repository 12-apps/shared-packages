# Adopting @12-apps/notifications

This package is a **plug-and-play notification plugin** (12-15): one library,
reusable across repositories, exposing standardized surfaces. A host repo only
*points* at these surfaces — when the library updates, every host updates with
**no app changes**. The contract is the one `@12-apps/report-builder`,
`@12-apps/rbac`, `@12-apps/entity-lifecycle` and `@12-apps/payments-*`
established.

What it gives a host: an **always-on in-app inbox** (bell, badge, slide-over,
mark-read, soft delete, cursor pager), **per-user × per-category channel
preferences** with an availability probe, and **email / SMS / WhatsApp /
web-push transports** with delivery records, failure isolation and a retry
sweep — endpoints and screens included.

## The standardized plugin surfaces

| Surface | Export | What the host does |
|---|---|---|
| **Core** | `@12-apps/notifications` | Nothing to wire — the framework-free, storage-free vocabulary both halves share: types, the generator registry, the preference policy, the phone rules, the copy table, the inbox wire shape. Safe in a browser. |
| **Server** | `@12-apps/notifications/server` | Call `createApiNotifications({ db, contacts, transports })` and mount the `routes` it returns — the nine inbox / preferences / push-subscription endpoints, with parsing, statuses and the `{ data }` envelope inside. It also returns `notify` (the emit front door), `notifyByPermission`, `dispatchDeliveries`, `drainPending` and the three stores. |
| **Hono** | `@12-apps/notifications/hono` | `const notifications = notificationsRouter({ ...serverConfig, resolveActor }); app.route('/api/account', notifications.router)`. A one-call mount; `hono` is an OPTIONAL peer, so importing the root, `/server` or `/react` never resolves it. |
| **React** | `@12-apps/notifications/react` | Call `createWebNotifications({ apiBase })`. `BellWithPanel` is the whole feature as one element; `BellButton` + `Panel` are the pair for a host with its own chrome; `page` is the preferences screen you route to. pt-BR product copy and the future-pay test ids ship inside. |
| **Web Push** | `@12-apps/notifications/web-push` | `sender: vapidPushSender({ subject, publicKey, privateKey })` on the `WEB_PUSH` declaration. Its own subpath because it is the only piece that needs `web-push` — an OPTIONAL peer a host that never enables the channel never installs. |
| **Prisma** | `prisma/notifications.prisma` + `prisma/migrations/*` | Run `pnpm --filter @12-apps/notifications prisma:sync -- <host schema dir>`: the partial is **COPIED** into the host's multi-file schema folder — never symlinked (a symlinked migration is silently skipped by Prisma; a symlinked partial dangles under `turbo prune`). Migrations are discovered structurally from the installed package's `prisma/migrations` by the host's plugin-migration sync. |

## Host wiring rules (the ones that bite)

1. **The host resolves WHO; the package resolves the rest.** `resolveActor`
   answers `{ userId }` or `null` (→ 401 before any handler runs). There is no
   tenant and no permission list on that actor, and both absences are the
   design: every endpoint here is SELF-scoped — a user reads and writes their
   own inbox — so the authorization is applied by scoping every query to
   `userId` rather than by a guard that could be forgotten. An admin view of
   someone else's inbox would be a different surface with a different actor.

2. **`contacts` is not optional, and it is not the `users` table.** A transport
   needs an address: `getContact(userId) → { email, phone } | null`. future-pay's
   router read `users.email` / `users.phone` directly, which is the one thing in
   the pipeline that was always the host's — a package cannot know the shape of
   an identity table, and a host with phone VERIFICATION wants to answer the
   question differently:

   ```ts
   contacts: {
     async getContact(userId) {
       const user = await prisma.user.findUnique({
         where: { id: userId },
         select: { email: true, phone: true, phoneVerifiedAt: true },
       });
       if (!user) return null;
       // Only a VERIFIED phone is a destination — the whole reason this is a seam.
       return { email: user.email, phone: user.phoneVerifiedAt ? user.phone : null };
     },
   }
   ```

   Returning `null` means "no such recipient", and `notify` throws
   `UnknownNotificationRecipientError` on it. That is deliberate: a
   notification addressed to nobody is a caller bug, never a silent drop.

   The same answer at DISPATCH time — the account was deleted between the emit
   and the send — marks that notification's delivery rows `DEAD` rather than
   leaving them QUEUED, because a QUEUED row nobody can be reached at is a row
   every sweep picks up forever. So `getContact` must return `null` only for
   "there is no such person", never for a transient failure: **throw** on a
   database error and the sweep will retry.

3. **A channel is ON because it is DECLARED, not because an env var is set.**
   One entry per channel, and a channel with no entry reports
   `supports() === false` — no delivery row, nothing fake-sent:

   ```ts
   transports: [
     { channel: 'EMAIL', driver: 'resend', apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM, appUrl },
     { channel: 'SMS', driver: 'twilio', accountSid, authToken, from, defaultCountryCode: '55' },
     { channel: 'WHATSAPP', driver: 'meta', accessToken, phoneNumberId, templateName,
       defaultCountryCode: '55' },
     { channel: 'WEB_PUSH', driver: 'vapid', publicKey, sender: vapidPushSender({ … }) },
   ]
   ```

   **A second vendor is one more entry**, either a built-in driver key or one of
   the host's own through `drivers` — and **zero** host code either way. An
   unknown driver key throws at MOUNT rather than at the first send: a typo'd
   vendor that silently disabled a channel is the failure this seam removes.

   Two things the phone channels REQUIRE, and one they warn about:

   - **`defaultCountryCode` is mandatory** on `SMS` and `WHATSAPP`. It used to
     default to `55` (the first host's market), which for a US adopter turned
     `4155552671` into `+554155552671` — a plausible Brazilian mobile — and sent a
     stranger the customer's order details. There is no country a published
     package can assume, so it assumes none and the omission is a compile error.
   - A number that will not normalize to E.164 makes the channel unavailable for
     that recipient (no delivery row, nothing sent) rather than being mangled.
   - Declaring `WHATSAPP` with **no `templateName`** logs a warning at mount:
     free-form text is only accepted inside Meta's 24-hour customer-service
     window, which cannot be tracked from here, so a host that emits
     business-initiated notifications that way has every send rejected.

4. **Duck-typed DB, never a generated client.** `db` is a lazy provider of the
   structural `NotificationsDb` seam over the four owned tables — a Prisma
   client satisfies it directly (`$transaction` included); the harness satisfies
   it with hand-written SQL. The argument shapes are CLOSED (documented in
   `src/server/db.ts`), so a non-Prisma host has a finite surface to fill.

5. **`categories` is product vocabulary.** The default is future-pay's four
   (`orders` / `payments` / `stock` / `system`) and the preferences screen
   renders whatever the api half was given — the taxonomy travels on the
   `GET /notification-preferences` payload, so the two halves cannot disagree
   about it. The packaged migration deliberately puts **no CHECK** on
   `notifications.category` for this reason; a host that wants one adds it.

6. **`generators` are registered from the OUTSIDE, and stay the host's.** A
   generator maps a domain event to `{ title, body, link, data }`, and the
   events are exactly what does not port: `order.paid`, `stock.low` and
   `short-payment` are Future Pay's, not any host's. Pass them in `generators`,
   or call `registerGenerator` for a module imported later. The generator's
   `category` is what the router gates fan-out on.

7. **Billing stays outside, and its gate is `channelPolicy`.** The money logic
   is the host's — this package never learns what a plan is. What it owns is
   *where the answer is asked for*: `(clientId, channels) => channels`, awaited
   per emit. A tenant-scoped emit keeps only the channels the plan covers, so a
   revoked transport **degrades** to the remaining ones rather than dropping the
   notification. A platform emit (no `clientId`) is never filtered.

   A policy that THROWS degrades to the **free** channels — the intersection of
   what the other gates allowed with e-mail + web push — and not to everything.
   The half of that which is "an extra notification beats a silent one" is why it
   does not fail closed: the dunning e-mail this system carries is how payment
   gets collected. But that argument only ever covered the free channels. Failing
   fully open billed the host for SMS and WhatsApp on a transient entitlements
   error, which are the two channels that cost money per message and the exact
   two its own gate was about to refuse.

8. **Dispatch is detached by default; hand it a queue in production.**
   `scheduleDispatch(notificationId)` puts the send on the host's worker
   (`@12-apps/jobs`, BullMQ, anything). The delivery rows are the durable
   record, so a queue that is unavailable costs latency, never a notification —
   and `drainPending()` on a cron re-dispatches FAILED rows and QUEUED/SENDING
   strays. `notify(event, { sync: true })` always sends in-process, which is what
   a test or a worker about to exit needs.

   **`drainPending` needs no lease, and you may run it on every instance.** Every
   send is CLAIMED first — one conditional `UPDATE` moves the row `QUEUED →
   SENDING` and the sender proceeds only if it moved exactly one row — so two
   sweeps, two cron runners, or the two app containers a zero-downtime rollout
   briefly runs cannot both send the same delivery. Three consequences worth
   knowing:

   - `drainPending(olderThanMs, take)` is BOUNDED (default 200 rows). A run
     cannot outlive its own interval and pile up behind itself.
   - Staleness is judged on `updated_at`, so a row the sweep just re-queued is
     not stale again on the next tick.
   - Nothing is retried forever: each claim spends one of `maxDeliveryAttempts`
     (default 5) and the last failure writes `DEAD`, which no sweep selects
     again. Without a ceiling a permanently invalid destination is a billed
     provider call on every sweep for the life of the row.

   `notify` opens **its own transaction** and a host cannot enlist in it (a
   Prisma `TransactionClient` has no `$transaction` to nest). So **call `notify`
   after your own transaction commits** — called from inside one, it commits an
   inbox row and dispatches an e-mail for a payment that then rolls back.

9. **`onCommitted` is where a realtime bus hangs.** The inbox row is written
   inside this package, and the bus that should announce it is a dependency this
   package must not gain. The listener fires AFTER the transaction — never inside
   it, or a subscriber would re-read and not find the row it was told about — and
   a listener that throws is logged, never propagated: the row is committed, and
   an observer must not turn a delivered notification into a 500. Pair it with
   `subscribe` on the web config, and the badge is pushed instead of polled.

10. **`notifyByPermission` needs `audience`, and it is your engine.** "Tell
    whoever can act on this" is resolved against the host's real authorization
    engine through two queries — `listCandidates(tenantId)` and
    `getPermissions(userId, tenantId)`. The package owns the fold: the **AND**
    (not OR — pair the permission that HANDLES the thing with the one that gates
    the SURFACE it links to, and every addressee is someone that surface's own
    guard will serve), the dedup, the refusal of an empty permission list, the
    per-recipient isolation — of BOTH host queries, so a candidate whose
    `getPermissions` throws is skipped as `audience-error` and the rest are still
    notified — and the log line that tells "nobody holds it" apart from "every
    dispatch failed". Two rules for your implementation:

    - `listCandidates` must be **bounded to people who hold a role**. future-pay's
      requires a role grant, which keeps a store's storefront BUYERS out of a loop
      that resolves permissions one user at a time.
    - `getPermissions` must be **scoped to the tenant**. Unioning a user's grants
      across tenants notifies someone about a store whose money they have no
      authority over, and no upstream `where` can save it — that user is already
      a candidate.

    Configure no `audience` and the method rejects loudly rather than resolving
    to "nobody", because the alternative is a money alert nobody gets.

11. **Mount order.** Nothing in this surface is shaped `/:id`, so it captures no
    host route. The reverse is not free: a host route shaped
    `/notifications/:id` under the same prefix, registered first, captures
    `GET /notifications/unread-count`. Mount `notifications.router` before any
    such route.

12. **The service worker is the host's.** `enableWebPush` registers `/sw.js` by
    default (`webPush.swPath` overrides it) and the file itself lives in the
    host's public directory — path-routed SPAs each control their own scope. On
    iOS there is no browser-level Web Push at all, so pass
    `webPush.needsInstallFirst` + `webPush.installHint` and the screen shows the
    one instruction that leads somewhere instead of an "Ativar" button that asks
    no permission and creates no subscription.

    One property of the packaged screen worth knowing, because it explains a
    request you will see: a push **endpoint is per browser PROFILE, not per
    user**, so on a shared machine the second person to click *Ativar* re-owns
    the row and the first person's subscription is gone. Re-owning is the safer
    of the two designs — one row per `(userId, endpoint)` would push A's
    notifications to a browser now used by B, encrypted to B's keys, which
    decrypt — so the screen instead stops trusting the browser alone: it reads
    `GET /push-subscriptions?endpoint=…` and shows *Ativar* again whenever the
    server no longer has that endpoint under the caller. That also recovers the
    404/410 prune case. A re-own is logged (both user ids, never the endpoint).

13. **These endpoints are cookie-authenticated WRITES. CSRF is yours.** Eight of
    the nine change state, and `resolveActor` typically reads a session cookie —
    so the host, not this package, owns the cross-site question. In future-pay it
    is fully mitigated by the Auth.js cookie's `SameSite=Lax`; a host
    authenticating with `SameSite=None`, or one whose `resolveActor` trusts a
    header a proxy sets, inherits an unguarded write surface. The one that matters
    most is `POST /push-subscriptions`: a cross-site request riding the victim's
    cookie can register the ATTACKER's endpoint and keys under the victim's
    account, after which the attacker's browser receives the victim's
    notifications and can decrypt them. So: **enforce `SameSite` on the session
    cookie, or check a CSRF token in `resolveActor`.**

    What the package does do is refuse to parse a body whose `Content-Type` is
    not JSON. `text/plain`, `multipart/form-data` and
    `application/x-www-form-urlencoded` are the three types a cross-site `fetch`
    or a plain `<form>` can send with no preflight; refusing them means such a
    request must earn a preflight the browser will then deny. That is a speed
    bump, not the defence — it does not help a host whose cookie is
    `SameSite=None` and whose attacker can send `application/json`.

## The minimum host

```ts
// server
import { notificationsRouter } from '@12-apps/notifications/hono';
import { vapidPushSender } from '@12-apps/notifications/web-push';

const notifications = notificationsRouter({
  db: getPrismaClient,
  contacts: { getContact: (id) => loadContact(id) },
  transports: [{ channel: 'EMAIL', driver: 'resend', apiKey, from, appUrl }],
  generators: [orderPaidGenerator],
  resolveActor: async (c) => {
    const session = await auth(c);
    return session ? { userId: session.user.id } : null;
  },
});
app.route('/api/account', notifications.router);

// frontend
import { createWebNotifications } from '@12-apps/notifications/react';

const notifications = createWebNotifications({ apiBase: '/api/account' });
// header:  <notifications.BellWithPanel onNavigate={navigate} />
// route:   <Route path="/account/notifications" element={<notifications.page />} />
```

## Adopting the schema

```bash
# 1. the partial, COPIED into the host's schema folder
pnpm --filter @12-apps/notifications prisma:sync -- packages/prisma/prisma/schema

# 2. the migrations, discovered structurally by the host's plugin sync
pnpm --filter @12-apps/prisma prisma:sync-plugins

# 3. drift is a red CI step, not a surprise at deploy time
pnpm --filter @12-apps/notifications prisma:sync:check
```

The migration is **replay-safe per column**, because the first adopters already
have these tables: `CREATE TABLE IF NOT EXISTS` is followed by one
`ADD COLUMN IF NOT EXISTS` per column, and the CHECKs are guarded by a
`pg_constraint` lookup. `CREATE TABLE IF NOT EXISTS` alone is the trap it
avoids — it skips the whole table, so a host whose table predates a column
silently never gets that column, and the failure surfaces later as a
missing-column error in production.

Two statements are deliberately NOT existence-guarded, because they must
**converge** rather than be skipped:

- the delivery `status` CHECK is `DROP CONSTRAINT IF EXISTS` + `ADD`. The value
  set widened (`SENDING`, `DEAD`), so an adopter holding a constraint under that
  name holds the old three — and a guard would keep it, rejecting the claim's own
  `SENDING` write at runtime with a CHECK older than the claim;
- the sweep's index moved from `(status, created_at)` to `(status, updated_at)`,
  so the old one is dropped and the new one created.

Both are idempotent, which is the property replay safety actually needs.

The `attempts` column is new too; an adopting host gets it at `0`, which is the
correct starting point ("no claim spent yet").

There are **no foreign keys into host tables**: `user_id` and `client_id` are
by-value scalars. Add your own in a host migration — `ON DELETE CASCADE` on
both is the recommendation, so a deleted account takes its inbox with it.

## What does NOT come with it

- **The events.** Generators are host code (see rule 6).
- **A queue.** `scheduleDispatch` is a seam, not an implementation.
- **A plan model.** `channelPolicy` answers; it does not decide.
- **An authorization engine.** `audience` answers; it does not decide.
- **A service worker.** The file is the host's (rule 12).
