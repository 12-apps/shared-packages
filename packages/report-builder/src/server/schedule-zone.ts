import { isValidTimeZone } from '../time';

import type { ReportActor, ReportBuilderServerConfig } from './context';

/** The part of the server config that says which zone a schedule is stamped in. */
export interface ScheduleZoneConfig {
  /**
   * The zone a SCHEDULE is stamped in, per tenant (FUT-776). Called with the saving actor (whose
   * `clientId` is the tenant) only when a save or a publish writes a schedule. Its answer becomes
   * `schedule.timeZone` and the clock `startsOn` is read on, and the schedule keeps firing there
   * until its author saves again.
   *
   * Optional and never blocking: absent, an answer that is not an IANA zone this runtime knows, or a
   * hook that throws or rejects all fall back to `timeZone`. It does not move a run's window or date
   * buckets, which read `timeZone` (a run has no actor to ask). Keep it cheap: the editor re-sends the
   * schedule on every save.
   */
  resolveTimeZone?: (actor: ReportActor) => string | Promise<string>;
  /** Hears why `resolveTimeZone` failed (it threw or rejected). Absent: the failure is silent. */
  onTimeZoneError?: (error: unknown, actor: ReportActor) => void;
}

/**
 * The zone a schedule written by `actor` is stamped in: the host's per-tenant
 * answer when it gives a zone this runtime knows, else `config.timeZone`.
 */
export async function scheduleTimeZoneOf(config: ReportBuilderServerConfig, actor: ReportActor): Promise<string> {
  if (!config.resolveTimeZone) return config.timeZone;
  try {
    const zone = await config.resolveTimeZone(actor);
    return typeof zone === 'string' && isValidTimeZone(zone) ? zone : config.timeZone;
  } catch (error) {
    config.onTimeZoneError?.(error, actor);
    return config.timeZone;
  }
}
