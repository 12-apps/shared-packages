# @12-apps/realtime

Typed topic-based pub/sub behind a swappable driver port — Redis pub/sub
across processes in production, inline in-process delivery in dev/tests
(the same seam shape as `@12-apps/jobs`).

```ts
import { publishRealtimeEvent, tenantTopic } from "@12-apps/realtime";

await publishRealtimeEvent(tenantTopic(tenantId, "kitchen"), {
  type: "kitchen.ticket.updated",
  data: { ticketId }, // identifiers only, never state
});
```

- Publishing **never throws** — realtime is a latency optimisation over the
  consumers' polling fallback, so a bus outage degrades to "the next poll
  sees it".
- Delivery is **best-effort** (no replay): every event is a hint to re-read,
  the database stays the source of truth.
- The Redis driver lives at `@12-apps/realtime/redis` so ioredis never enters a
  bundle that only publishes inline.

Host wiring (driver choice, the SSE subscribe endpoint, auth, the client
hook) and the full decision record live in [docs/REALTIME.md](../../docs/REALTIME.md).
