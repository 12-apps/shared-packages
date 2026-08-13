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
| **Server** | `@12-apps/notifications/server` | Call `createApiNotifications({ db, contacts, transports })` and mount the `routes` it returns — the eight inbox / preferences / push-subscription endpoints, with parsing, statuses and the `{ data }` envelope inside. It also returns `notify` (the emit front door), `notifyByPermission`, `dispatchDeliveries`, `drainPending` and the three stores. |
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

3. **A channel is ON because it is DECLARED, not because an env var is set.**
   One entry per channel, and a channel with no entry reports
   `supports() === false` — no delivery row, nothing fake-sent:

   ```ts
   transports: [
     { channel: 'EMAIL', driver: 'resend', apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM, appUrl },
     { channel: 'SMS', driver: 'twilio', accountSid, authToken, from },
     { channel: 'WHATSAPP', driver: 'meta', accessToken, phoneNumberId, templateName },
     { channel: 'WEB_PUSH', driver: 'vapid', publicKey, sender: vapidPushSender({ … }) },
   ]
   ```

   **A second vendor is one more entry**, either a built-in driver key or one of
   the host's own through `drivers` — and **zero** host code either way. An
   unknown driver key throws at MOUNT rather than at the first send: a typo'd
   vendor that silently disabled a channel is the failure this seam removes.

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
   notification. A platform emit (no `clientId`) is never filtered, and a policy
   that THROWS fails **open** — an extra notification beats a silent one, because
   the dunning e-mail this system carries is how payment gets collected.

8. **Dispatch is detached by default; hand it a queue in production.**
   `scheduleDispatch(notificationId)` puts the send on the host's worker
   (`@12-apps/jobs`, BullMQ, anything). The delivery rows are the durable
   record, so a queue that is unavailable costs latency, never a notification —
   and `drainPending()` on a cron re-dispatches FAILED rows and QUEUED strays.
   `notify(event, { sync: true })` always sends in-process, which is what a test
   or a worker about to exit needs.

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
    per-recipient isolation, and the log line that tells "nobody holds it" apart
    from "every dispatch failed". Two rules for your implementation:

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

There are **no foreign keys into host tables**: `user_id` and `client_id` are
by-value scalars. Add your own in a host migration — `ON DELETE CASCADE` on
both is the recommendation, so a deleted account takes its inbox with it.

## What does NOT come with it

- **The events.** Generators are host code (see rule 6).
- **A queue.** `scheduleDispatch` is a seam, not an implementation.
- **A plan model.** `channelPolicy` answers; it does not decide.
- **An authorization engine.** `audience` answers; it does not decide.
- **A service worker.** The file is the host's (rule 12).
