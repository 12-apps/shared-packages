import type { JSX } from 'react';
import { useCallback, useState } from 'react';

import { createWebEvents, reconcileRefetchInterval, sharedWorkerConnector } from '@12-apps/realtime/react';

/**
 * The whole wiring a frontend host performs for `@12-apps/realtime` (12-16).
 *
 * Everything the browser half IS — the wire, the ws→sse demotion, the reconnect policy and
 * its jitter, the liveness watch, the ticket handshake, the union across screens and tabs,
 * and the routing of an event back to the screen that asked for it — lives inside the
 * package. This file names where the API is mounted and hands over a worker module its own
 * bundler emits. That is the only part that is genuinely the host's.
 *
 * There is no `transport` seam and no stubbed `fetch`, deliberately: the package's default is
 * same-origin, Vite proxies `/api` to `harness/backend`, and so the stream below crosses a
 * real socket into the package's own Hono router.
 *
 * ## Why the identity is a COOKIE
 *
 * `EventSource` cannot set a header — which is the whole reason the SSE endpoint authorizes
 * itself while the WebSocket needs a signed ticket. So the only way a browser presents an
 * identity is the way a real deployment does: a cookie the request carries by itself. A real
 * host has a session; this harness has one line. Without it every stream answers 401, the
 * channel exhausts its initial-attempt budget and reports `unavailable` — and a spec written
 * around that would be proving the DEGRADED path works.
 *
 * ## Which transport carries it
 *
 * The WebSocket, and the whole path is real: the channel POSTs the API for a ticket (the
 * cookie authorizes it), opens `/ws`, and Vite proxies that upgrade to the package's own
 * gateway running on its own port beside the backend. So the browser drives ticket mint →
 * socket handshake → bus fan-out, across two published surfaces and a proxy. Nothing in the
 * loop is a fixture, and if the gateway were unreachable the channel would demote to SSE
 * without this page changing a line.
 *
 * ## What the spec beside this page proves, and what it deliberately does not
 *
 * It proves a LIVE ROUND TRIP: the suite publishes through `/__harness/realtime/publish`, and
 * the counter below moves. That is the claim worth making, and it is true on either host.
 *
 * It does NOT probe the network for "did the app subscribe". Since the connection may live in
 * a SharedWorker, the ticket request is issued by the worker and neither `page.on("request")`
 * nor `context.on("request")` sees it — a SharedWorker is attached to no page. A probe that
 * passed would only be observing the in-page fallback, i.e. asserting the optimisation is
 * OFF. Hence `data-testid="events-host"`, which reports which arrangement carried it.
 */
/**
 * The seeded identity, before anything mounts.
 *
 * `document.cookie` rather than a fetch: it must be present on the FIRST request the channel
 * makes, and the provider's effect runs immediately after this module is evaluated.
 */
document.cookie = 'harness-actor=owner; path=/; SameSite=Lax';

const events = createWebEvents({
  apiBase: '/api',
  // The cross-tab optimisation, wired the way ADOPTING.md documents it: the WHOLE
  // `new SharedWorker(new URL(…, import.meta.url), { type: "module" })` expression stays in
  // this host module, because that is the expression a bundler pattern-matches to emit a
  // compiled worker chunk. Split it up and Vite inlines the raw TypeScript as a data URI, the
  // worker never executes, and every tab sits disconnected while reporting `shared-worker` —
  // measured, and the reason `sharedWorkerConnector` takes a spawn thunk rather than a URL.
  connectWorker: sharedWorkerConnector(
    () =>
      new SharedWorker(new URL('../realtime/worker.ts', import.meta.url), {
        type: 'module',
        name: 'realtime-events',
      }),
  ),
});

/** How often the screen would re-read without realtime, and with it. */
const POLL_MS = 5_000;
const RECONCILE_MS = 30_000;

/**
 * One screen, registering one domain.
 *
 * The counter stands in for `queryClient.invalidateQueries` — the only thing a consumer is
 * ever supposed to do with a message. Events carry identifiers, never state, so what is
 * rendered here is HOW MANY hints arrived and never their payload.
 */
function KitchenBoard(): JSX.Element {
  const [hints, setHints] = useState(0);
  const onMessage = useCallback(() => setHints((count) => count + 1), []);
  const { status, connected, host } = events.useTopics({ topics: ['kitchen'], onMessage });

  return (
    <section>
      <h3>Cozinha</h3>
      <p data-testid="kitchen-status">{status}</p>
      <p data-testid="kitchen-hints">{hints}</p>
      {/* The poll is a permanent FLOOR; realtime only relaxes it. Rendered so a spec can
          assert the cadence really moved rather than trusting the chip. */}
      <p data-testid="kitchen-poll">{String(reconcileRefetchInterval(status, POLL_MS, RECONCILE_MS))}</p>
      {/* Never claim live without being live: this reads a real `status`. */}
      <p data-testid="kitchen-chip">{connected ? 'Ao vivo' : 'Atualizando'}</p>
      <p data-testid="events-host">{host ?? 'none'}</p>
    </section>
  );
}

/** A second screen on a DIFFERENT domain, sharing the one connection. */
function OrdersBoard(): JSX.Element {
  const [hints, setHints] = useState(0);
  const onMessage = useCallback(() => setHints((count) => count + 1), []);
  const { status } = events.useTopics({ topics: ['orders'], onMessage });

  return (
    <section>
      <h3>Pedidos</h3>
      <p data-testid="orders-status">{status}</p>
      {/* The routing claim: a kitchen hint must NOT move this counter. */}
      <p data-testid="orders-hints">{hints}</p>
    </section>
  );
}

/** A user-scoped consumer, on the other endpoint and the other context. */
function NotificationBell(): JSX.Element {
  const { status } = events.useUserTopics({ topics: ['notifications'] });
  return <p data-testid="bell-status">{status}</p>;
}

export function RealtimeEventsPage(): JSX.Element {
  return (
    <events.Provider endpoint={events.tenantEndpoint('loja-a')}>
      <events.UserProvider>
        <h2>Realtime events</h2>
        <KitchenBoard />
        <OrdersBoard />
        <NotificationBell />
      </events.UserProvider>
    </events.Provider>
  );
}
