import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { HARNESS_BACKEND_ORIGIN, HARNESS_GATEWAY_ORIGIN } from '../backend/src/port';

/**
 * Deliberately bare: no aliases, no optimizeDeps, no ssr.noExternal.
 *
 * Every one of those is a way for a host to paper over a package that does not
 * resolve on its own, and this harness exists to find out whether they resolve
 * on their own. A consumer that needs special Vite config to use these packages
 * is a bug here, not a note in their README.
 *
 * The proxy is not one of those. It is the ordinary arrangement of a SPA in
 * front of an API on another port — the reason the reports surface can reach
 * `/api/admin/...` with a plain same-origin `fetch` and no `transport` seam at
 * all, exactly as future-pay's admin does against `apps/web`. `/__harness` is
 * the suite's reset control on the same server; it is deliberately NOT under
 * `/api`, so nothing can mistake it for part of the package's surface.
 *
 * Both `server` and `preview` carry it: `npm run build` is served by the
 * latter, which is what Playwright drives, and a proxy present in only one of
 * them fails as an app that works while you develop it and 404s in the suite.
 *
 * `/ws` needs `ws: true` — it is an UPGRADE, not a request (12-16). It reaches the realtime
 * gateway on its own port, which is the arrangement a real deployment has: the browser only
 * ever sees one origin, and the socket process is deployed and restarted independently of the
 * API. Without the flag the upgrade is proxied as a plain GET, the handshake never completes,
 * and the channel sits in `connecting` — open to nothing, reporting nothing.
 */
const proxy = {
  '/api': { target: HARNESS_BACKEND_ORIGIN, changeOrigin: true },
  '/__harness': { target: HARNESS_BACKEND_ORIGIN, changeOrigin: true },
  // @12-apps/pwa's two assets (12-23), and they belong HERE rather than under
  // `/api`: a worker's directory bounds its scope and the manifest is linked from
  // `index.html`, so both are served from the ORIGIN ROOT in every real
  // deployment. Proxying them one level up is the same arrangement future-pay
  // has, where the SPA's origin answers them and `apps/web` produces them.
  '/manifest.webmanifest': { target: HARNESS_BACKEND_ORIGIN, changeOrigin: true },
  '/sw.js': { target: HARNESS_BACKEND_ORIGIN, changeOrigin: true },
  '/ws': { target: HARNESS_GATEWAY_ORIGIN, changeOrigin: true, ws: true },
};

export default defineConfig({ plugins: [react()], server: { proxy }, preview: { proxy } });
