/**
 * `@12-apps/payments-frontend/live` — the host's realtime channel handed to
 * every payment wait below it (FUT-1055).
 *
 * Its own entry rather than the root barrel's: a host mounts this provider at
 * its root, on first paint, long before any checkout screen exists, so it must
 * not reach one. One context and its types; React is its only package. The
 * module graph is pinned by `__tests__/narrow-entries.test.ts`.
 */
export {
  CheckoutLiveProvider,
  DEFAULT_LIVE_INTERVAL_MS,
  type CheckoutLiveSignal,
} from '../components/checkout/live-context';
