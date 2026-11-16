import { isValidTimeZone } from '../time';

import type { ReportActor, ReportBuilderServerConfig } from './context';

/**
 * The zone a schedule written by `actor` is stamped in (FUT-776): the host's
 * per-tenant answer from `config.resolveTimeZone` when it gives a zone this
 * runtime knows, else `config.timeZone`. A hook that is absent, answers
 * something that is not an IANA zone, or answers nothing never blocks a save.
 *
 * The stamped zone is what the schedule fires in, and it keeps firing there
 * until its author saves again. It does not move a run's window or date
 * buckets, which read `config.timeZone`: a run has no actor to ask.
 */
export async function scheduleTimeZoneOf(config: ReportBuilderServerConfig, actor: ReportActor): Promise<string> {
  if (!config.resolveTimeZone) return config.timeZone;
  const zone = await config.resolveTimeZone(actor);
  return typeof zone === 'string' && isValidTimeZone(zone) ? zone : config.timeZone;
}
