'use client';

/**
 * The unit-price plausibility caveat (FUT-497), built to the same recipe as the
 * out-of-area badge. Deliberately a SEPARATE component rather than a variant of
 * that one — the two caveats say different things and each surface may show
 * either, both or neither.
 *
 * It sits beside the per-unit price, because that is the number the buyer would
 * otherwise trust: this offer claims a single unit at many times the run's
 * median unit price, which almost always means the vendor's listing is a
 * multipack its title never mentioned. The price is never hidden or re-ordered
 * — information beats silence, flagged.
 *
 * The explanation travels through {@link CaveatChip} (FUT-495), so it is
 * announced by assistive tech and available on touch. A native `title` alone
 * reaches neither, and a caveat nobody can read is not a caveat.
 */
import type { JSX } from 'react';

import { CaveatChip } from './caveat-chip';
import type { ResearchMessages } from './messages';

interface SuspectUnitPriceBadgeProps {
  /**
   * The RESOLVED bundle. Each surface resolves the messages once and passes
   * them down — re-resolving per flagged row was pure waste (FUT-491 review).
   */
  t: ResearchMessages;
  /** Test id of the wrapper — the hook every surface's test asserts on. */
  dataTestId: string;
}

export function SuspectUnitPriceBadge({ t, dataTestId }: SuspectUnitPriceBadgeProps): JSX.Element {
  return (
    <CaveatChip
      label={t.suspectUnitPriceBadge}
      hint={t.suspectUnitPriceHint}
      dataTestId={dataTestId}
    />
  );
}
