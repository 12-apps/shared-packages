/**
 * The plan comparison's two pure decisions — WHAT it offers and HOW it lays
 * the rows out — and the view that applies the second.
 *
 * ## The offer
 *
 * A screen may name the tier (`plan`); otherwise the offer is the first
 * upgrade tier, in the payload's cheapest-first order (see
 * `TenantPlanPayload.comparison`), that includes every compared row. When the
 * tenant's OWN tier already includes them all, there is nothing to sell on
 * this screen and the dialog says so instead.
 *
 * ## The layout is chosen by the width MEASURED, never by a breakpoint
 *
 * A breakpoint answered the wrong question: at 600 px the dialog was no
 * longer "phone", rendered the roomy table, and cut the offered tier's column
 * off a 490 px frame. The table is drawn only where its floors fit the frame
 * the dialog actually has; anywhere narrower, every row stacks. The table's
 * frame still scrolls sideways as a safety net — nothing is ever clipped.
 */
import { useLayoutEffect, useRef, useState, type JSX, type RefObject } from 'react';

import { Box } from '@12-apps/ui/mui/Box';

import type { ComparisonLine, ComparisonTier } from '../plan-wire';
import {
  COMPACT_LABEL_MIN_PX,
  COMPACT_TIER_MIN_PX,
  ComparisonMatrix,
  type TierBadges,
} from './comparison-matrix';
import type { MatrixSection } from './comparison-rows';
import type { ComparisonTableCopy } from './copy';
import { StackedMatrix } from './stacked-matrix';

function linesOf(tier: ComparisonTier): ComparisonLine[] {
  return tier.sections.flatMap((section) => section.lines);
}

/** Whether a tier, already cut to the compared rows, includes every one of them. */
function coversAll(tier: ComparisonTier, rowCount: number): boolean {
  const lines = linesOf(tier);
  return lines.length === rowCount && lines.every((line) => line.included);
}

export interface CompareOffer {
  /** The tier the footer offers, or null for no sale. */
  tier: ComparisonTier | null;
  /** The tenant's own tier already includes every compared row. */
  covered: boolean;
}

/** Whether a tier marks every row of the matrix as included. */
function coversEveryRow(tier: ComparisonTier, sections: MatrixSection[]): boolean {
  return sections.every((section) =>
    section.rows.every((row) => row.cells.get(tier.key)?.included === true),
  );
}

/**
 * What the footer offers, from the already-filtered tiers. `rowCount` is how
 * many rows the matrix shows: a tier that leaves one out does not include
 * "every compared row", however its listed lines read.
 *
 * `sections` is given when the screen worded its OWN rows (`rows`): one
 * entitlement can then fill several rows, so the tier's lines no longer
 * count the rows and coverage is read off the matrix itself.
 */
export function compareOffer(
  tiers: ComparisonTier[],
  rowCount: number,
  plan: string | null | undefined,
  sections?: MatrixSection[],
): CompareOffer {
  const covers = (tier: ComparisonTier): boolean =>
    sections === undefined ? coversAll(tier, rowCount) : coversEveryRow(tier, sections);
  if (plan !== undefined && plan !== null) {
    return { tier: tiers.find((tier) => tier.key === plan && tier.upgrade) ?? null, covered: false };
  }
  if (rowCount === 0) return { tier: null, covered: false };
  const current = tiers.find((tier) => tier.current);
  if (current !== undefined && covers(current)) return { tier: null, covered: true };
  return { tier: tiers.find((tier) => tier.upgrade && covers(tier)) ?? null, covered: false };
}

export interface CompareOffers {
  /** Every upgrade tier in the payload, cheapest first: the ones on sale. */
  tiers: ComparisonTier[];
  /** The tenant's own tier already includes every compared row. */
  covered: boolean;
}

/**
 * The `offer: 'each'` reading: not the ONE tier that covers every row but
 * every upgrade tier the payload carries. The payload is already the tiers
 * on sale plus the tenant's own (the host's `comparison` builder), so "an
 * upgrade tier" is "a plan on sale that costs more": a plan off sale never
 * reaches here to be offered. Nothing is offered when the tenant's own tier
 * already includes every row.
 */
export function compareOffers(
  tiers: ComparisonTier[],
  rowCount: number,
  sections: MatrixSection[],
): CompareOffers {
  const current = tiers.find((tier) => tier.current);
  const covered = rowCount > 0 && current !== undefined && coversEveryRow(current, sections);
  // No rows: nothing was compared, so there is nothing to look at a plan FOR.
  // Said by the empty sentence and the all-plans link, as `'cheapest'` does.
  const offered = covered || rowCount === 0 ? [] : tiers.filter((tier) => tier.upgrade);
  return { tiers: offered, covered };
}

type CompareLayout = 'table' | 'stacked';

/**
 * The table where its floors fit, else stacked. An UNMEASURED width (null:
 * no layout pass yet, or no layout engine at all) reads as the table — a
 * browser measures before the first paint, so only a test ever sees it.
 */
export function matrixLayoutFor(width: number | null, tierCount: number): CompareLayout {
  if (width === null) return 'table';
  // +2 for the frame's border.
  return width >= COMPACT_LABEL_MIN_PX + tierCount * COMPACT_TIER_MIN_PX + 2 ? 'table' : 'stacked';
}

/** The content width of an element, kept current; null until measured. */
export function useMeasuredWidth(): [RefObject<HTMLDivElement | null>, number | null] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    const read = (): void => {
      const measured = element.getBoundingClientRect().width;
      // A zero width is "no layout engine" (a test DOM), not a real frame.
      setWidth(measured > 0 ? measured : null);
    };
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** The compared rows, laid out for the width the dialog has. */
export function CompareMatrixView({
  tiers,
  sections,
  copy,
  badges,
  width,
}: {
  tiers: ComparisonTier[];
  sections: MatrixSection[];
  copy: ComparisonTableCopy;
  badges: TierBadges;
  width: number | null;
}): JSX.Element {
  const sectionTitles = sections.length > 1;
  // Never clipped: whichever layout, a frame that cannot hold its content scrolls.
  const frame = { border: 1, borderColor: 'divider', borderRadius: 2, overflowX: 'auto' };
  if (matrixLayoutFor(width, tiers.length) === 'stacked') {
    return (
      <Box sx={frame}>
        <StackedMatrix
          tiers={tiers}
          sections={sections}
          copy={copy}
          badges={badges}
          sectionTitles={sectionTitles}
        />
      </Box>
    );
  }
  return (
    <Box sx={frame}>
      <ComparisonMatrix
        tiers={tiers}
        sections={sections}
        copy={copy}
        density="compact"
        badges={badges}
        sectionTitles={sectionTitles}
        dataTestId="plan-compare-table"
      />
    </Box>
  );
}
