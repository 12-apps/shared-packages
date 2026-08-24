/**
 * The two background jobs getting a message out actually needs.
 *
 * ## Why they are declared here and not left to the host
 *
 * `notify()` commits the inbox record and one QUEUED delivery per channel in a
 * transaction, and that row IS the durable record of the send. Everything after
 * it is a decision about WHEN the provider call happens — and every one of
 * those decisions is this package's knowledge, not a host's:
 *
 * - the fast path retries only INFRASTRUCTURE faults, because a provider
 *   rejecting one channel does not throw here (the row goes FAILED and the
 *   sweep owns the retry), so three spaced attempts is about surviving a
 *   restart rather than chasing a provider;
 * - the sweep's five-minute cadence is the resolution at which "my customer
 *   never got the e-mail" stops being an incident;
 * - the sweep runs single-flight, because overlapping passes are duplicate
 *   billed provider calls;
 * - and the sweep is what makes the system UNSTUCK-ABLE: it re-dispatches
 *   FAILED rows and stale claims whose dispatching process died mid-flight.
 *   Before it existed a provider blip left a delivery FAILED forever.
 *
 * A host asked to restate all of that is a host that can get it wrong — and,
 * far more likely, a host that never schedules the sweep at all and quietly
 * has no retry. That is the `paymentsJobBlueprints()` incident exactly: a
 * mechanism a host must remember to schedule is a mechanism most hosts do not
 * have. The origin host DID write both jobs, correctly, by hand — cadence,
 * lease ttl, attempts and concurrency restated in its own `lib/jobs` — which
 * is the drift this declaration ends rather than a gap it fills.
 *
 * What stays the host's: whether to run them at all, on which queue runtime,
 * and the lease implementation. A host with no worker declines the `jobs`
 * capability in writing and the wiring report says so.
 */

import type { JobsContribution, WireJobBlueprint } from '@12-apps/wiring';

import type { ApiNotifications } from './create-api-notifications';

/**
 * What the host closes over at bind time — the mounted api's two send paths,
 * and nothing else. Deliberately a `Pick` of the real thing rather than a
 * parallel interface: a reshape of either method stops compiling here.
 */
export type NotificationsJobDeps = Pick<
  ApiNotifications,
  'dispatchDeliveries' | 'drainPending'
>;

/**
 * The single-flight queue name — the same string `@12-apps/jobs` exports as
 * `SWEEP_QUEUE`, stated as a literal because this package does not depend on
 * the job library (the payments-backend precedent, for the same reason).
 */
export const NOTIFICATIONS_SWEEP_QUEUE = 'sweeps';

/** Five minutes — see the header on why this number is the package's. */
export const NOTIFICATIONS_DRAIN_CRON = '*/5 * * * *';

/**
 * Comfortably longer than a drain pass, and under the cadence's own patience:
 * every delivery a pass re-dispatches is a provider call.
 */
export const NOTIFICATIONS_DRAIN_LEASE_MS = 4 * 60_000;

/** Deliver one already-committed notification through its enabled channels. */
const dispatch: WireJobBlueprint<{ notificationId: string }, NotificationsJobDeps> = {
  name: 'dispatch',
  // INFRASTRUCTURE faults only — a lost database connection, an OOM-killed
  // worker. A provider rejecting one channel is recorded FAILED on that row
  // and picked up by the drain below, so retrying here would re-send the
  // channels that DID succeed.
  attempts: 3,
  backoff: { type: 'exponential', delayMs: 10_000 },
  handle: async (payload, deps) => {
    await deps.dispatchDeliveries(payload.notificationId);
  },
};

/**
 * Re-dispatch everything that did not get out.
 *
 * Idempotent and cheap when there is nothing to do (one indexed read), and it
 * only touches rows whose `updated_at` is older than its own cutoff — so it
 * never races the fast path and never re-picks a row it just re-queued.
 *
 * The lease stays even though the package's per-delivery CLAIM already makes
 * concurrent sweeps safe: the claim stops two passes sending the same row, the
 * lease stops one container stacking overlapping passes at all.
 */
const drain: WireJobBlueprint<void, NotificationsJobDeps> = {
  name: 'drain',
  queue: NOTIFICATIONS_SWEEP_QUEUE,
  concurrency: 1,
  schedule: { pattern: NOTIFICATIONS_DRAIN_CRON },
  // Never retried by the queue: the next tick re-finds everything from durable
  // state anyway, and a retry storm against a provider that is already down is
  // the failure this avoids.
  attempts: 1,
  lease: { ttlMs: NOTIFICATIONS_DRAIN_LEASE_MS },
  handle: async (_payload, deps, context) => {
    const { dispatched } = await deps.drainPending();
    if (dispatched > 0) {
      context.logger.info(`notifications.drain re-dispatched ${dispatched} delivery(ies).`);
    }
  },
};

/**
 * The jobs contribution. `namespace` is prepended once at bind time, so these
 * arrive at a runner as `notifications.dispatch` and `notifications.drain` —
 * the wire names the origin host already uses, so adopting is a deletion
 * rather than a rename.
 */
export const NOTIFICATIONS_JOBS = {
  namespace: 'notifications',
  blueprints: { dispatch, drain },
} as const satisfies JobsContribution<NotificationsJobDeps>;
