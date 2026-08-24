/**
 * The cadence constants, in a leaf module both halves import.
 *
 * They lived in `./index` until the blueprints moved to `./sweeps` at the
 * 400-line gate, and that made a CYCLE: `index` imports `sweeps` for the
 * exported set, `sweeps` imported these back, and a blueprint object literal
 * evaluated while `index` was still initialising captured `undefined` for
 * every one of them. The result type-checked perfectly and declared sweeps
 * with no queue and no schedule — which is to say, sweeps that never run.
 *
 * A leaf both sides depend on has no order to get wrong. The wiring suite's
 * compliance run is what caught it, and it still pins every value below.
 */

/**
 * The single-flight queue name. Stated as a literal rather than imported for
 * the reason in the header; it is the same string `@12-apps/jobs` exports as
 * `SWEEP_QUEUE`, and `paymentsJobBlueprints.test.ts` pins the pair.
 */
export const PAYMENTS_SWEEP_QUEUE = 'sweeps';

/** Five minutes — the resolution at which "paid but still pending" is a delay. */
export const RECONCILE_CRON = '*/5 * * * *';

/** Same five minutes, same reason: an unsettled delivery is a delay, not news. */
export const WEBHOOK_DRAIN_CRON = '*/5 * * * *';

/** And again: an activation whose proof never landed is the same class of wait. */
export const ACTIVATION_RECONCILE_CRON = '*/5 * * * *';

/**
 * Hourly. The renewal window below is measured in weeks, so this only decides
 * how fast a transient provider outage is retried.
 */
export const OAUTH_RENEWAL_CRON = '0 * * * *';

/**
 * How far ahead to renew a grant.
 *
 * Generous on purpose. Renewing early costs one request against a grant that
 * had months left; renewing late costs a merchant that cannot take money until
 * a human notices. Against an observed lifetime near a year, a fortnight of
 * runway is a rounding error and still leaves room for a dozen failed attempts.
 */
export const OAUTH_RENEW_WITHIN_MS = 14 * 24 * 60 * 60_000;

/**
 * Connections per tick. Renewal is one outbound call each and the pass holds a
 * lease while it runs, so this bounds how long one tick can hold that lease
 * rather than throughput: whatever is left is picked up an hour later, still
 * far inside the window above.
 */
export const OAUTH_RENEWAL_BATCH = 100;
