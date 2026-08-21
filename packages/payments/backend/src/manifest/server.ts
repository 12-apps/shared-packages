/**
 * `@12-apps/payments-backend/manifest/server` — the server capability.
 *
 * `jobs` is `PAYMENTS_JOBS`: the reconcile-pending sweep with its cadence,
 * queue, concurrency, no-retry posture and five-minute single-flight lease
 * all declared — the host binds only the deps (`charges`, `gateway`,
 * `settle`), which is the same object it already handed the sweep by hand.
 *
 * Untyped like `./index` — see there for why the wiring contract cannot be
 * imported here and where the producer assertions run instead.
 */

import { PAYMENTS_JOBS } from '../jobs';

export const paymentsBackendServerManifest = {
  name: '@12-apps/payments-backend',
  jobs: PAYMENTS_JOBS,
} as const;
