'use client';

/**
 * The out-of-area caveat (FUT-491), one component so every surface that shows
 * such a price — the hero card, the ranked table, the product-page widget —
 * cannot drift apart. A store that does not deliver to the researched CEP still
 * returns its default-region prices (information beats silence) and this badge
 * is what keeps that honest.
 *
 * The explanation travels through {@link CaveatChip} (FUT-495), so it is
 * announced by assistive tech and available on touch — the accessibility gap
 * the FUT-491 review found in the original native-`title` spelling.
 */
import type { JSX } from 'react';

import { CaveatChip } from './caveat-chip';
import type { ResearchMessages } from './messages';

interface OutsideAreaBadgeProps {
  /**
   * The RESOLVED bundle. Each surface resolves the messages once and passes
   * them down — re-resolving per flagged row was pure waste (FUT-491 review).
   */
  t: ResearchMessages;
  /** Test id of the wrapper — the hook every surface's test asserts on. */
  dataTestId: string;
}

export function OutsideAreaBadge({ t, dataTestId }: OutsideAreaBadgeProps): JSX.Element {
  return (
    <CaveatChip label={t.outsideAreaBadge} hint={t.outsideAreaHint} dataTestId={dataTestId} />
  );
}
