import { describe, expect, it } from 'vitest';

import { declineForbidsRetry, declineMeansInstrumentDead } from '../core/decline-verdict';
import type { DeclineReason } from '../core/types';

/**
 * Taxonomy properties, not policy (FUT-761): which reasons kill the
 * INSTRUMENT and which snapshots forbid another presentation. Hosts keep the
 * retry ladders and grace windows; what a decline MEANS must not drift per
 * adopter, which is what these pins are for.
 */

describe('declineMeansInstrumentDead', () => {
  it('the card-is-finished reasons: only a different instrument can ever work', () => {
    for (const reason of ['INVALID_CARD', 'EXPIRED_CARD', 'FRAUD_SUSPECTED'] as const) {
      expect(declineMeansInstrumentDead(reason)).toBe(true);
    }
  });

  it('a bad MOMENT is not a dead instrument', () => {
    for (const reason of ['INSUFFICIENT_FUNDS', 'DO_NOT_HONOR', 'GENERIC'] as DeclineReason[]) {
      expect(declineMeansInstrumentDead(reason)).toBe(false);
    }
  });
});

describe('declineForbidsRetry', () => {
  it('only the provider explicitly saying NO forbids another presentation', () => {
    expect(declineForbidsRetry({ declineRetriable: false })).toBe(true);
  });

  it('yes and no-position both leave the decision to host policy', () => {
    expect(declineForbidsRetry({ declineRetriable: true })).toBe(false);
    expect(declineForbidsRetry({})).toBe(false);
  });
});
