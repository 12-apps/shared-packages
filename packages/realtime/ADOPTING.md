# Adopting @12-apps/realtime

A generic, portable realtime **event system**: a typed topic/event bus behind a
swappable driver, the subscribe surface that authorizes and streams it, a runnable
WebSocket gateway, a transactional outbox for the events that must not be lost, the
browser client with its reconnect policy and hooks, and the publisher-parity gate that
keeps a subscribable domain from shipping silent.

Two factories, one config object each:

```ts
const events = createApiEvents({ surfaces, outbox });   // backend
const web    = createWebEvents({ apiBase: "/api" });    // frontend
```

## The standardized plugin surfaces

| Surface | Export | What the host does |
| --- | --- | --- |
| **Core bus** | `@12-apps/realtime` | Nothing to wire — the framework-free bus: `tenantTopic` / `userTopic`, `publishRealtimeEvent`, `subscribeRealtime`, `configureRealtime`, the driver port and the inline driver. |
| **Redis driver** | `@12-apps/realtime/redis` | `createRedisRealtimeDriver({ redisUrl, logger })`. Behind its own subpath so an emit site never drags `ioredis` into a bundle that only publishes inline. |
| **Tickets** | `@12-apps/realtime/ticket` | `mintRealtimeTicket` / `verifyRealtimeTicket` / `TicketReplayGuard`. Only a host writing its own gateway needs these directly. |
| **Server** | `@12-apps/realtime/server` | Call `createApiEvents({ surfaces, outbox })` and mount the `routes` it returns — the SSE stream and the ticket mint per surface, with `?topics=` parsing, the authorization seam, connection caps, driver bootstrap and the outbox drain inside. |
| **Hono** | `@12-apps/realtime/hono` | `const events = eventsRouter({ ...serverConfig }); app.route("/api", events.router); await events.start()`. `hono` is an OPTIONAL peer, so importing the root, `/server`, `/react` or `/gateway` never resolves it. |
| **Gateway** | `@12-apps/realtime/gateway` | `await startRealtimeGateway({ port })`, or run the shipped `realtime-gateway` bin as a container command. `ws` is an OPTIONAL peer, imported by this entry alone. |
| **React** | `@12-apps/realtime/react` | Call `createWebEvents({ apiBase })`; mount `Provider` / `UserProvider` in the shell and call `useTopics` / `useUserTopics` in a screen. `reconcileRefetchInterval` is the polling seam. |
| **Worker** | `@12-apps/realtime/worker` | A two-line worker module the HOST's bundler emits (below). Optional — without it the connection lives in the page. |
| **Parity gate** | `@12-apps/realtime/parity` | `publisherParityCli({ root, declarations })` — the host's `realtime:publisher-gate` script becomes a one-line re-export, and its CI job keeps working unchanged. |
| **Prisma** | `prisma/realtime.prisma` + `prisma/migrations/*` | Run `pnpm --filter @12-apps/realtime prisma:sync -- <host schema dir>`: the partial is **COPIED** into the host's multi-file schema folder — never symlinked (a symlinked migration is silently skipped by Prisma; a symlinked partial dangles under `turbo prune`; `npm pack` drops symlinked entries entirely). Migrations are discovered structurally from the installed package's `prisma/migrations` by the host's plugin-migration sync. |

## Host wiring rules (the ones that bite)

1. **The host resolves the subject; the package never does.** `authorize` receives the
   route params and the vetted topic SPECS, and answers with the **fully-resolved topic
   names**. Build them from ids YOU resolved — the tenant from the path slug, the user
   from the session, a seat from a cookie — and never from anything the client sent.
   That property is the whole security model: the gateway subscribes to exactly the names
   in a signed ticket and decides nothing.

2. **One refused topic refuses the whole connection**, and that refusal happens inside
   `authorize`. Do not return a narrowed list as a way of denying part of a request: a
   partial subscription hides the denial from the client, which then waits forever for
   events that were never coming. Throw `EventsDenial(403, …)`.

3. **A qualifier is the only client-controlled part of a topic name.** Domains are
   deny-by-default and so are qualifiers: list a domain in `qualifiedDomains` only when
   its `authorize` really checks the qualifier (future-pay's kitchen station reach is that
   check). A domain absent from that list cannot receive one — it is a 400 before
   `authorize` runs.

4. **Publish AFTER the commit, never inside the transaction.** A subscriber woken
   mid-transaction re-reads and does not find the row it was told about, which is
   indistinguishable from a lost event and far harder to trace. The one exception is
   `enqueueRealtimeEvent`, which writes a ROW rather than publishing.

5. **Events carry identifiers, never state.** `data: {}` is the normal payload. The event
   says "ask again"; the re-read goes through the endpoint that already decides what this
   caller may see. A payload here would be a second, unguarded copy of an authorization
   decision.

6. **Mount order.** Each surface contributes `GET <path>` and `POST <path>/ticket`. Hono
   resolves by registration order, so a host route shaped like either one must be
   registered AFTER `events.router`.

7. **`start()` reads the environment at CALL time**, not at factory time. Call it once per
   process, after your own config is in place. It is idempotent.

8. **The gateway and the API must share the ticket secret.** Both resolve
   `REALTIME_TICKET_SECRET` then `AUTH_SECRET`, in that order, on purpose — a mismatch
   shows up as every socket being refused with no other symptom.

9. **Keep your poll.** Realtime only RELAXES it. Never delete a `refetchInterval` and
   never set it to `false` on a surface where a missed event could mislead — use
   `reconcileRefetchInterval(status, fast, slow)`. A lost event must cost latency, never
   correctness, and that is the contract the whole design leans on.

10. **Never claim live without being live.** A screen that says "ao vivo" must be reading a
    real `status`.

## `createApiEvents` config, field by field

| Field | Required | Default | Notes |
| --- | --- | --- | --- |
| `surfaces` | yes | — | one `EventsSurfaceConfig` per subscribe endpoint (below) |
| `driver` | no | resolved from the env | pass one explicitly in a test or an embedded harness |
| `logger` | no | `console` | structurally satisfied by a winston logger |
| `ticketSecret` | no | env chain | a literal, a resolver, or `REALTIME_TICKET_SECRET` → `AUTH_SECRET` |
| `connectionCap` | no | 20, env-overridable | per SUBJECT, per process (`REALTIME_TENANT_CONNECTION_CAP`) |
| `outbox` | no | off | `{ db }` — enabling it is saying where the rows live |
| `installSignalHooks` | no | `true` | SIGTERM/SIGINT end open streams cleanly; turn off if the host owns shutdown |

### `EventsSurfaceConfig`

| Field | Required | Notes |
| --- | --- | --- |
| `name` | yes | identifies the surface in logs and in the returned route list |
| `path` | yes | `:param` syntax, relative to the host's mount (`/admin/:tenantSlug/realtime`). The ticket route is minted at `<path>/ticket` — the layout the browser half derives |
| `domains` | yes | subscribable domain names. Deny-by-default; wire-stable (they appear in `?topics=`) |
| `qualifiedDomains` | no | `[]` — which domains may carry qualifier segments (rule 3) |
| `topicsQuery` | no | `true`. `false` is the seat-scoped shape: one caller, one topic, nothing to choose; `authorize` gets no specs and derives everything |
| `maxTopicsPerConnection` | no | 8 — a fan-out guardrail on the REQUEST |
| `authorize` | yes | the host's decision. Throw `EventsDenial` to refuse; anything else thrown is a host bug and becomes a 500 |
| `tooManyMessage` | no | the 429 body's message |

### `createWebEvents` config

| Field | Required | Default | Notes |
| --- | --- | --- | --- |
| `apiBase` | no | `/api` | where the API is mounted |
| `tenantPath` | no | `/admin/<slug>/realtime` | must match the server surface's `path`, minus the API mount |
| `userPath` | no | `/account/realtime` | same |
| `transport.socketUrl` | no | this origin + `/ws` | the gateway, when it is not behind the page's own origin |
| `transport.ticketUrl` | no | `<path>/ticket?<query>` | only for a host that moved the mint |
| `connectWorker` | no | none (in-page) | the cross-tab optimisation; see below |

## The endpoints

Per surface, under the host's mount:

| Method | Path | Answers |
| --- | --- | --- |
| GET | `<path>?topics=a,b` | an SSE stream (`text/event-stream`), or 400 unknown/malformed topic, the seam's own 401/403/404, 503 (no driver, or an empty grant), 429 (subject at its cap) |
| POST | `<path>/ticket?topics=a,b` | `{ data: { ticket, expiresInSeconds } }`, the SAME authorization, 503 with no secret or a grant a ticket cannot carry |

Denials are deliberately **unwrapped** (`{ error }`, never `{ data }`): the success
envelope is for payloads, and a denial has none.

**"Realtime is off" is checked AFTER authorization.** An unauthorized caller learns
nothing about whether the bus is configured.

## The transactional outbox

Enable it by saying where the rows live:

```ts
const events = createApiEvents({ surfaces, outbox: { db: () => prisma } });
```

Enqueue INSIDE the transaction that causes the event:

```ts
await prisma.$transaction(async (tx) => {
  await tx.order.update({ where: { id }, data: { status } });
  await enqueueRealtimeEvent(tx, {
    topic: tenantTopic(tenantId, "orders"),
    type: "orders.changed",
  });
});
```

Drain it from a worker — `@12-apps/jobs` is the natural driver:

```ts
const jobs = createApiJobs({
  handlers: {
    "realtime.outbox.drain": async () => {
      let pass = await events.outbox!.drain();
      while (pass.more) pass = await events.outbox!.drain();
    },
    "realtime.outbox.purge": () => events.outbox!.purgePublished(7 * 24 * 60 * 60 * 1000),
  },
  schedules: [
    { name: "realtime.outbox.drain", every: "10 seconds" },
    { name: "realtime.outbox.purge", every: "1 day" },
  ],
});
```

### The delivery guarantee, stated honestly

- **Exactly-once PERSISTENCE.** The row commits atomically with the domain write, so the
  event cannot exist without its cause nor the cause without its event.
- **At-least-once PUBLISH into the bus, with idempotent consumers.** *Not* exactly-once. A
  drainer that dies after publishing but before marking will publish that row again once
  its claim lease expires. What the claim protocol removes is the CONCURRENT duplicate
  (two drains racing one row) and the lost row.
- **Best-effort DELIVERY to subscribers**, unchanged: the bus is fan-out with no replay,
  so a subscriber offline at publish time misses the event forever. Polling stays the
  correctness floor on every consumer.
- **No total ORDER.** Rows are claimed in `created_at` order, but concurrent drains can
  publish out of order and a retried row arrives after rows created later.

Duplicates are harmless **by construction** rather than by luck: an event carries
identifiers, so acting on it twice means re-reading twice. The publish additionally reuses
the ROW ID as the event id, so a consumer that wants explicit de-duplication has a stable
key instead of two indistinguishable emissions.

`attempts` counts CLAIMS, not failures — a drainer that crashes mid-publish records no
failure, so a failure counter would let a poison row retry for ever. After
`maxAttempts` the row is left for a human with its `last_error`: not deleted (that is the
loss the outbox exists to prevent) and not retried (that would grind the drain).

The table is INFRASTRUCTURE, not a tenant-scoped domain table: no `client_id`, no
`archived_at`, and the drain reads it unscoped because it fans out for the whole
deployment. The tenant lives inside the topic name. Nothing in the outbox is reachable
over HTTP — `createApiEvents` exposes no route for it.

## Running the gateway

```ts
import { startRealtimeGateway } from "@12-apps/realtime/gateway";
const gateway = await startRealtimeGateway({ port: 3100 });
// …
await gateway.close();
```

or as a command, configured entirely by the environment:

```
REALTIME_GATEWAY_PORT=3100 REDIS_URL=redis://redis:6379 npx realtime-gateway
```

| Variable | Default | Notes |
| --- | --- | --- |
| `REALTIME_TICKET_SECRET` | falls back to `AUTH_SECRET` | must match the API side |
| `REALTIME_GATEWAY_PORT` | `3100` | |
| `REALTIME_GATEWAY_MAX_CONNECTIONS` | `2000` | per process; over it, upgrades get 503 |
| `REDIS_URL` | — | unset uses the inline driver, LOUDLY: a publish from another process never arrives |

The bin needs `tsx` (an optional peer) because every `@12-apps/*` package publishes
TypeScript source and plain `node` cannot load a `.ts` entry. A host that already compiles
its own server imports `startRealtimeGateway` instead and needs nothing extra.

**It performs NO authorization.** No session, no database, no RBAC — the API surface
decides and signs the resolved topic names into a ticket. A bug in the gateway can break
the socket; it cannot leak another tenant's events. Keep it that way: a database URL
appearing in the gateway's config is the signal that a decision drifted to the wrong side
of the seam.

A host that would rather not run a second process passes its own `server`, and the gateway
attaches to it instead of listening.

## The SharedWorker (optional)

One connection per PERSON instead of per tab. Emitting a worker chunk is the host
bundler's job, so the host writes two lines:

```ts
// src/realtime-worker.ts
import { startRealtimeWorker } from "@12-apps/realtime/worker";
startRealtimeWorker();
```

```ts
const events = createWebEvents({
  apiBase: "/api",
  connectWorker: sharedWorkerConnector(
    () =>
      new SharedWorker(new URL("./realtime-worker.ts", import.meta.url), {
        type: "module",
        name: "realtime-events",
      }),
  ),
});
```

**Keep the WHOLE `new SharedWorker(new URL(…, import.meta.url), …)` expression in the host
module.** Bundlers pattern-match that entire expression to emit a compiled worker chunk;
handing the package a bare URL instead loses the match, and Vite then inlines the file as a
`data:` URI of the raw TypeScript. The worker never executes, its port never answers, and
every tab sits `disconnected` while `useTopics().host` reports `shared-worker` — a screen
that believes it is live while receiving nothing, which no runtime fallback can catch because
the construction SUCCEEDS. That is measured behaviour, and it is why `sharedWorkerConnector`
takes a spawn thunk rather than a URL.

Without a connector the connection lives in the page, which is fully functional — this is an
optimisation, and an optimisation may never be the reason a screen stops working.
`useTopics().host` reports which arrangement you got.

## Minimal host (Hono)

```ts
import { eventsRouter } from "@12-apps/realtime/hono";
import { EventsDenial } from "@12-apps/realtime/server";
import { tenantTopic } from "@12-apps/realtime";

const events = eventsRouter({
  outbox: { db: () => prisma },
  surfaces: [
    {
      name: "admin",
      path: "/admin/:tenantSlug/realtime",
      domains: ["kitchen", "tables", "orders"],
      qualifiedDomains: ["kitchen"],
      authorize: async ({ params, specs, request }) => {
        const tenant = await resolveTenantBySlug(params.tenantSlug);
        if (!tenant) throw new EventsDenial(404, "Loja não encontrada.");
        const actor = await resolveActor(request);
        if (!actor) throw new EventsDenial(401, "Não autenticado.");
        for (const spec of specs) {
          if (!(await mayRead(actor, tenant.id, spec))) {
            throw new EventsDenial(403, `Sem permissão para o tópico: ${spec.domain}.`);
          }
        }
        return {
          subjectId: tenant.id,
          topics: specs.map((spec) => tenantTopic(tenant.id, spec.domain, ...spec.qualifiers)),
        };
      },
    },
  ],
});

app.route("/api", events.router);
await events.start();
```

## Minimal host (React)

```ts
export const events = createWebEvents({ apiBase: "/api" });

// the shell, once
<events.Provider endpoint={events.tenantEndpoint(slug)}>
  <events.UserProvider>{children}</events.UserProvider>
</events.Provider>

// a screen
const { status } = events.useTopics({
  topics: ["kitchen"],
  onMessage: () => queryClient.invalidateQueries({ queryKey }),
});
useQuery({ ..., refetchInterval: reconcileRefetchInterval(status, POLL_MS, RECONCILE_MS) });
```

## The publisher-parity gate

A domain is authorizable the moment it is registered. Without an emitter a screen
connects, is told it is live, SLOWS its poll, and hears nothing — ending up staler than
before it adopted realtime while announcing the opposite. That shipped for real once
(FUT-440) and two domains sat silent for months.

The host keeps its publisher map (that is domain config) and the gate comes from here:

```ts
// scripts/realtime/publisher-gate.ts
import { publisherParityCli } from "@12-apps/realtime/parity";
import { allPublisherDeclarations } from "../../lib/realtime/publishers";

publisherParityCli({ root: REPO_ROOT, declarations: allPublisherDeclarations() });
```

with the ratchet beside it:

```json
{ "silent": [] }
```

in `.realtime-silent-domains.json`. The list may only **SHRINK** — a new silent domain is
refused, and an entry that now publishes must be deleted in the same PR, so adding the
publisher is never enough on its own. `FUTURE_PAY_PUBLISHER_DECLARATIONS` is the shipped
default for a host with the future-pay layout.

## Phase B — adopting into a host that ALREADY has these tables (future-pay)

1. **Bump the exact pin** in every consuming `package.json` and refresh the lockfile.
   Nothing raises these pins by itself.
2. **The migration is replay-safe per COLUMN, not per table.** `CREATE TABLE IF NOT
   EXISTS` skips the whole table, so a host whose `realtime_outbox_events` predates
   `claimed_at` would adopt this, see it succeed, and never get the column. Every column is
   added with its own `ADD COLUMN IF NOT EXISTS`, so applying it to a fresh database, to
   one that already has the table, and to one with an older shape of it all work.
3. **Sync the partial as a COPY** (`prisma:sync`), record the migration copy in the host's
   plugin manifest, and declare `@12-apps/realtime` as a dependency of the package that
   owns the schema folder — `turbo prune` drops an undeclared owner and the sync's
   `--check` then fails the image build on a file that is sitting right there.
4. **Replace the host's realtime library with config.** `apps/web/lib/realtime/`
   (topics, authorize, sse, connections, runtime, ticket-secret) becomes one
   `createApiEvents` call; `apps/realtime-gateway/` becomes a `startRealtimeGateway` call
   or the bin; `packages/spa-shared/src/realtime/` becomes one `createWebEvents`. What
   stays is the domain map, the RBAC tiers, the publisher hint modules and the route files
   a coverage gate forces to exist — pure declarations.
5. **Point the host's `realtime:publisher-gate` script at `/parity`** and leave
   `.realtime-silent-domains.json` where it is; the CI job shells out to the package
   script and needs no change.
6. **Static imports only** for the new subpaths: these packages publish TS source, and a
   dynamic non-literal `import()` crashes a bundled server.

## What deliberately did NOT move into the package

- **Which domains exist, and what each discloses.** `REALTIME_DOMAINS` and its RBAC read
  tiers are the host's vocabulary and the host's authorization model. The package owns
  deny-by-default; it does not own the policy.
- **The publisher hint modules.** `publishKitchenChanged(…)` knows which mutations a
  kitchen board draws. That is domain knowledge, and the parity gate is what keeps it
  honest.
- **Session, tenant resolution and RBAC.** They arrive through `authorize`.
- **The polling intervals.** A screen's fast and reconcile cadences are properties of that
  screen; the package ships the seam that computes from `status`, not the numbers.
