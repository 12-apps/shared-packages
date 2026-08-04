'use client';

/**
 * The unknown-freight caveat (FUT-518), built to the same recipe as the
 * out-of-area (FUT-491) and suspect-unit-price (FUT-497) badges — a separate
 * component rather than a variant of either, because the three say different
 * things and a row may show any combination of them.
 *
 * It sits beside the TOTAL, and only there: `totalCents` is the one rendered
 * number shipping enters (`unitPriceCents` is `priceCents / packQuantity` and
 * never touches freight). When the source stated no shipping cost the pipeline
 * floors it at 0 rather than inventing an estimate, which makes that total a
 * LOWER BOUND — this badge is what keeps showing it honest. The offer is never
 * hidden, re-ordered or demoted for it: information beats silence, flagged.
 *
 * The explanation travels through {@link CaveatChip} (FUT-495), so it is
 * announced by assistive tech and available on touch.
 */
import type { JSX } from 'react';

import { CaveatChip } from './caveat-chip';
import type { ResearchMessages } from './messages';

interface ShippingUnknownBadgeProps {
  /**
   * The RESOLVED bundle. Each surface resolves the messages once and passes
   * them down — re-resolving per flagged row was pure waste (FUT-491 review).
   */
  t: ResearchMessages;
  /** Test id of the wrapper — the hook every surface's test asserts on. */
  dataTestId: string;
}

export function ShippingUnknownBadge({ t, dataTestId }: ShippingUnknownBadgeProps): JSX.Element {
  return (
    <CaveatChip
      label={t.shippingUnknownBadge}
      hint={t.shippingUnknownHint}
      dataTestId={dataTestId}
    />
  );
}
