/**
 * `@12-apps/app-shell/server` — the backend half (12-18).
 *
 * One factory: {@link createApiAppShell}. Everything else exported here is a type a
 * host needs in order to satisfy the config, or a helper an adapter needs in order
 * to mount the descriptors.
 *
 * Framework-free: nothing here imports Hono. `@12-apps/app-shell/hono` adapts the
 * descriptors in about forty lines, behind its own subpath with `hono` as an
 * OPTIONAL peer.
 */
export { createApiAppShell, type ApiAppShell } from './create-api-app-shell';

export {
  AppShellApiError,
  DEFAULT_SERVER_MESSAGES,
  foldApiError,
  messagesOf,
  noContent,
  ok,
  type AppShellCookie,
  type AppShellRequest,
  type AppShellResponse,
  type AppShellRoute,
  type AppShellServerConfig,
  type AppShellServerMessages,
  type ConsentActor,
  type ConsentCookieConfig,
  type ConsentSeam,
  type ResolveConsentActor,
} from './config';

export { appShellRoutes } from './routes';
