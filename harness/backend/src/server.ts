/**
 * The harness backend, on a socket.
 *
 * `npm run dev` in `harness/backend`, or Playwright's first `webServer` — one
 * process, one port, one in-process Postgres behind it. The SPA reaches it
 * through Vite's `/api` proxy, so what the browser performs is an ordinary
 * same-origin `fetch` and the reports surface needs no `transport` at all:
 * the arrangement a real consumer has.
 */
import { serve } from '@hono/node-server';
import { startRealtimeGateway } from '@12-apps/realtime/gateway';

import { createHarnessBackend } from './app';
import { HARNESS_BACKEND_PORT, HARNESS_GATEWAY_PORT } from './port';
import { HARNESS_TICKET_SECRET } from './realtime-host';

const { app, realtimeDriver } = await createHarnessBackend();

serve({ fetch: app.fetch, port: HARNESS_BACKEND_PORT }, (info) => {
  // The one line a human needs when they run this by hand; Playwright waits on
  // /health rather than on stdout.
  console.log(`harness backend listening on http://localhost:${info.port}`);
});

/**
 * The realtime GATEWAY, on its own port (12-16).
 *
 * Started HERE and not inside `createHarnessBackend`, deliberately: every backend test builds
 * a backend, and a gateway inside the factory would have twenty test files racing for one
 * port. This file is the only place that binds anything.
 *
 * It is the package's own runnable entry — the same `startRealtimeGateway` a real deployment
 * calls — sharing this process's bus so the API's publish reaches a socket the gateway holds.
 * Vite proxies `/ws` here with `ws: true`, so the SPA's WebSocket is same-origin exactly as it
 * is behind a real reverse proxy, and the browser spec drives the WHOLE path: ticket minted by
 * the API, socket accepted by the gateway, event carried by the bus.
 */
await startRealtimeGateway({
  port: HARNESS_GATEWAY_PORT,
  ticketSecret: HARNESS_TICKET_SECRET,
  redisUrl: null,
  driver: realtimeDriver,
});
console.log(`harness realtime gateway listening on ws://localhost:${HARNESS_GATEWAY_PORT}/ws`);
