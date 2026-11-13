/**
 * `@12-apps/fiscal/jobs` — the package's job blueprints, deps left open (the
 * wiring contract's `jobs` capability; `@12-apps/wiring` is a type-only
 * dependency).
 *
 * - `sweep` (every 5 minutes): re-issues PENDING and SUBMITTED documents left
 *   stale, and settles every number SEFAZ never used (a lookup, a cancel or
 *   an inutilization), so a series has no unexplained gap.
 * - `transmit-contingency` (every 5 minutes, offset): transmits the documents
 *   signed offline, and warns the owner of every one still offline after 20
 *   hours (SEFAZ's deadline is 24).
 * - `certificate-expiry` (daily, 10:07 UTC): tells each owner whose A1 expires
 *   within 30 days, on the 30th, 15th, 7th, 3rd and last day, and every day
 *   once it has expired.
 *
 * The host binds the service, its store and its notifier, nothing more.
 */

import type { JobsContribution } from "@12-apps/wiring";

import { FISCAL_CERTIFICATE_EXPIRING, type FiscalNotifyPort } from "./documents/context";
import type { FiscalStore } from "./documents/ports";
import type { FiscalDocuments, SweepReport } from "./documents/service";
import { FISCAL_MANAGE } from "./manifest/permissions";

export interface FiscalJobDeps {
  readonly documents: Pick<FiscalDocuments, "sweep" | "transmitContingency">;
  readonly store: Pick<FiscalStore, "listExpiringCertificates">;
  readonly notify: FiscalNotifyPort;
  readonly now: () => Date;
}

/** The single-flight lease a sweep or a transmission run holds. */
export const FISCAL_JOB_LEASE_MS = 30 * 60_000;

/**
 * The worst one document can cost a run: an issue call and the offline
 * signing after it, each bounded by the issuer's timeout (90 s recommended
 * for the sidecar adapter, whose own SEFAZ call gets 50 s and a lookup).
 */
export const FISCAL_WORST_STEP_MS = 2 * 90_000;

/**
 * At most this many documents per run, derived so that a run of the worst
 * steps still ends inside its lease: a second run can never overlap the
 * first. A backlog drains over several five-minute runs.
 */
export const FISCAL_SWEEP_BATCH = Math.floor(FISCAL_JOB_LEASE_MS / FISCAL_WORST_STEP_MS);

/** The days before expiry the owner is told; after expiry, every day. */
export const CERTIFICATE_WARNING_DAYS: readonly number[] = [30, 15, 7, 3, 1];

const DAY_MS = 86_400_000;

function report(name: string, result: SweepReport, logger: { info(m: string): void; error(m: string): void }): void {
  if (result.advanced.length > 0 || result.failures.length > 0) {
    logger.info(`fiscal ${name}: ${result.advanced.length} advanced, ${result.failures.length} failed`);
  }
  for (const failure of result.failures) logger.error(`fiscal ${name} failed for document ${failure.documentId}: ${failure.message}`);
}

/** Whole days from `now` to `expiresAt`, rounded up: 0 is "today", negative is "expired". */
export function daysLeft(expiresAt: string, now: Date): number {
  // `|| 0` turns the -0 of a part-day already gone into "today".
  return Math.ceil((Date.parse(expiresAt) - now.getTime()) / DAY_MS) || 0;
}

export const FISCAL_JOBS = {
  namespace: "fiscal",
  blueprints: {
    sweep: {
      name: "sweep",
      schedule: { pattern: "*/5 * * * *" },
      /** The batch is sized so a run of worst-case steps ends inside this lease. */
      lease: { ttlMs: FISCAL_JOB_LEASE_MS },
      /** A missed run is caught up by the next tick. */
      attempts: 1,
      async handle(_payload, deps, context) {
        report("sweep", await deps.documents.sweep(FISCAL_SWEEP_BATCH), context.logger);
      },
    },
    transmitContingency: {
      name: "transmit-contingency",
      schedule: { pattern: "2-59/5 * * * *" },
      lease: { ttlMs: FISCAL_JOB_LEASE_MS },
      attempts: 1,
      async handle(_payload, deps, context) {
        report("transmit-contingency", await deps.documents.transmitContingency(FISCAL_SWEEP_BATCH), context.logger);
      },
    },
    certificateExpiry: {
      name: "certificate-expiry",
      schedule: { pattern: "7 10 * * *" },
      lease: { ttlMs: 10 * 60_000 },
      attempts: 1,
      async handle(_payload, deps, context) {
        const now = deps.now();
        const horizon = new Date(now.getTime() + (Math.max(...CERTIFICATE_WARNING_DAYS) + 1) * DAY_MS).toISOString();
        const profiles = await deps.store.listExpiringCertificates(horizon);
        let told = 0;
        for (const profile of profiles) {
          const days = daysLeft(profile.certificateExpiresAt ?? "", now);
          if (days > 0 && !CERTIFICATE_WARNING_DAYS.includes(days)) continue;
          await deps.notify.emit({
            type: FISCAL_CERTIFICATE_EXPIRING,
            recipient: { tenantId: profile.ownerId, permission: FISCAL_MANAGE },
            payload: { ownerId: profile.ownerId, expiresAt: profile.certificateExpiresAt, daysLeft: days },
          });
          told += 1;
        }
        if (told > 0) context.logger.info(`fiscal certificate-expiry: ${told} owner(s) told`);
      },
    },
  },
} satisfies JobsContribution<FiscalJobDeps>;
