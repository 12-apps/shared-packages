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

import { createHarnessBackend } from './app';
import { HARNESS_BACKEND_PORT } from './port';

const { app } = await createHarnessBackend();

serve({ fetch: app.fetch, port: HARNESS_BACKEND_PORT }, (info) => {
  // The one line a human needs when they run this by hand; Playwright waits on
  // /health rather than on stdout.
  console.log(`harness backend listening on http://localhost:${info.port}`);
});
