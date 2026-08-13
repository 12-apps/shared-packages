# @12-apps/realtime

A portable realtime **event system**: the bus, the subscribe surface that authorizes and
streams it, a runnable WebSocket gateway, a transactional outbox, the browser client, and the
gate that keeps a subscribable domain from shipping silent.

Two factories, one config object each — full contract in [ADOPTING.md](./ADOPTING.md).

```ts
// backend
const events = eventsRouter({ surfaces, outbox: { db: () => prisma } });
app.route("/api", events.router);
await events.start();

// frontend
const web = createWebEvents({ apiBase: "/api" });
const { status } = web.useTopics({ topics: ["kitchen"], onMessage: invalidate });
useQuery({ /* … */ refetchInterval: reconcileRefetchInterval(status, POLL_MS, RECONCILE_MS) });
```

| Subpath | What it is |
| --- | --- |
| `.` | the framework-free bus: topics, `publishRealtimeEvent`, `subscribeRealtime`, the driver port, the inline driver |
| `./redis` | the cross-process driver, behind its own subpath so an emit site never drags `ioredis` into a bundle |
| `./ticket` | connection tickets: mint, verify, single-use guard |
| `./server` | `createApiEvents` — topic registry, the authorization seam, the SSE transport, connection caps, the outbox |
| `./hono` | `eventsRouter` — one-call mount (`hono` is an optional peer) |
| `./gateway` | `startRealtimeGateway`, plus a `realtime-gateway` bin (`ws` is an optional peer) |
| `./react` | `createWebEvents` — client, reconnect policy, ws→sse demotion, liveness watch, hooks |
| `./worker` | the SharedWorker body, for a host that wants one connection per person |
| `./parity` | the publisher-parity gate: library + CLI |
| `prisma/` | the outbox model + its migration, copied into a host's schema folder |

## The three rules everything else follows from

- **Publishing never throws.** Realtime is a latency optimisation over the consumers' polling
  fallback, so a bus outage degrades to "the next poll sees it" — never to a failed mutation.
- **Delivery is best-effort** and there is no replay. Every event is a hint to RE-READ; the
  database stays the source of truth and the poll is a permanent floor that realtime only
  relaxes. `data` carries identifiers, never state — a payload here would be a second,
  unguarded copy of an authorization decision.
- **The gateway performs no authorization.** The API surface decides with the host's own rules
  and signs the RESOLVED topic names into a short-lived, single-use ticket. A topic that was
  never handed over is never subscribed to, so a gateway bug can break the socket but cannot
  leak another tenant's events.

The outbox is the one durable exception to "best-effort", and its guarantee is stated plainly:
exactly-once persistence, **at-least-once publish with idempotent consumers**, no total order.
See ADOPTING.md — it is not exactly-once and does not pretend to be.
