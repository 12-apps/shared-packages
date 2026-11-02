import { evidenceAmounts, type EvidenceAmounts } from './sandbox-buyer';
import type { EvidenceEnvironment } from './types';

/** The environment a run's deps name (FUT-4198): SANDBOX unless the host says PRODUCTION. */
export function environmentOf(deps: { environment?: EvidenceEnvironment }): EvidenceEnvironment {
  return deps.environment ?? 'SANDBOX';
}

/** What each of the run's orders charges, in cents, in its environment. */
export function amountsOf(deps: { environment?: EvidenceEnvironment }): EvidenceAmounts {
  return evidenceAmounts(environmentOf(deps));
}
