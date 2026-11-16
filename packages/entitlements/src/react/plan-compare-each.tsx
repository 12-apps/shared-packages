/**
 * The comparison's footer when a screen asks for EVERY plan on sale
 * (`offer: 'each'`): one "Conhecer o <plano>" per upgrade tier, each opening
 * the plans page at that tier.
 *
 * ## One row, or one whole row each
 *
 * A label never wraps inside its button. The actions sit side by side, in
 * equal columns, only while the longest label fits ONE line in a column;
 * otherwise each takes the whole row, centred, one under the next (ADR 0184:
 * a button that does not fit takes the row, and so does the one after it —
 * never one of two on the line and the other below). That is decided by
 * measuring, not by a breakpoint: the label is a font and a plan name the host
 * chose. A label wider than even a whole row is cut with an ellipsis, its full
 * text staying the link's accessible name.
 *
 * The measure reads each label's `scrollWidth` (its full text width, whether
 * or not it is clipped) and the button's own horizontal padding, so it is the
 * same number in both layouts and cannot flip back and forth.
 *
 * ## Which one is solid
 *
 * One primary per row: the tier the host flags `recommended`, else the most
 * expensive offered (the last, in the payload's cheapest-first order). The
 * others are outlined.
 *
 * ## Where it goes
 *
 * `plansPath` with the tier's key as `?plan=<key>`. The host's plans screen is
 * the host's to route; this package's own plans page does not read `plan`
 * today, so the link lands on the plans page. It is a link, not a plan
 * request: "Conhecer" is looking, and the plan page owns asking.
 */
import { useLayoutEffect, useRef, useState, type JSX, type RefObject } from 'react';

import { Button } from '@12-apps/ui/form/Button';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';

import type { ComparisonTier } from '../plan-wire';
import type { CompareOffers } from './plan-compare-layout';
import type { ResolvedWebConfig } from './web-config';

/** The plans page at one tier. Keeps a query the host's path already has. */
export function planPathAt(plansPath: string, tierKey: string): string {
  const separator = plansPath.includes('?') ? '&' : '?';
  return `${plansPath}${separator}plan=${encodeURIComponent(tierKey)}`;
}

/** The tier whose action is solid. */
function primaryTier(tiers: ComparisonTier[]): ComparisonTier | undefined {
  return tiers.find((tier) => tier.recommended) ?? tiers[tiers.length - 1];
}

/**
 * Whether `count` equal columns, each holding the longest label plus the
 * button's horizontal padding, fit in `width` with `gap` between them. An
 * unmeasured width (0: no layout engine) reads as fitting.
 */
export function fitsOneRow(input: {
  width: number;
  gap: number;
  count: number;
  longestLabel: number;
  buttonPadding: number;
}): boolean {
  const { width, gap, count, longestLabel, buttonPadding } = input;
  if (width <= 0) return true;
  return count * (longestLabel + buttonPadding) + gap * (count - 1) <= width;
}

function pixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Reads the row's measures and says whether the labels fit side by side. */
function readFits(row: HTMLElement): boolean {
  const labels = [...row.querySelectorAll<HTMLElement>('[data-compare-label]')];
  const first = labels[0]?.closest('a, button');
  if (first === null || first === undefined) return true;
  const rowStyle = getComputedStyle(row);
  const buttonStyle = getComputedStyle(first);
  return fitsOneRow({
    width: row.clientWidth,
    gap: pixels(rowStyle.columnGap),
    count: labels.length,
    longestLabel: Math.max(...labels.map((label) => label.scrollWidth)),
    buttonPadding:
      pixels(buttonStyle.paddingLeft) +
      pixels(buttonStyle.paddingRight) +
      pixels(buttonStyle.borderLeftWidth) +
      pixels(buttonStyle.borderRightWidth),
  });
}

/** True while the labels fit one line each in equal columns of the row. */
function useFitsOneRow(): [RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const row = ref.current;
    if (row === null) return undefined;
    const read = (): void => setFits(readFits(row));
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    // The row (the dialog resized) and every label (a web font arrived).
    const observer = new ResizeObserver(read);
    observer.observe(row);
    row.querySelectorAll('[data-compare-label]').forEach((label) => observer.observe(label));
    return () => observer.disconnect();
  }, []);
  return [ref, fits];
}

/**
 * The per-plan actions. `plansPath` is passed in (already known non-null by
 * the caller) so this never links a page the host did not route. Nothing
 * offered (the tenant's tier covers every row, no row was compared, or no plan
 * is on sale) renders nothing here: the caller's own footer says so.
 */
export function EachPlanActions({
  offers,
  plansPath,
  config,
  onClose,
}: {
  offers: CompareOffers;
  plansPath: string;
  config: ResolvedWebConfig;
  onClose: () => void;
}): JSX.Element | null {
  const [rowRef, fits] = useFitsOneRow();
  const { tiers } = offers;
  if (tiers.length === 0) return null;
  const primary = primaryTier(tiers);
  const learn = config.copy.planCompare.learnPlan;
  return (
    <Stack spacing={1} sx={{ width: '100%' }} data-testid="plan-compare-each">
      <Box
        ref={rowRef}
        data-layout={fits ? 'row' : 'stacked'}
        sx={{
          display: 'grid',
          gridAutoFlow: fits ? 'column' : 'row',
          gridAutoColumns: 'minmax(0, 1fr)',
          gap: 1,
          width: '100%',
        }}
      >
        {tiers.map((tier) => {
          const label = learn?.({ planName: tier.name }) ?? tier.name;
          return (
            <Button
              key={tier.key}
              component={config.LinkComponent}
              to={planPathAt(plansPath, tier.key)}
              onClick={onClose}
              variant={tier === primary ? 'solid' : 'outline'}
              size="sm"
              fullWidth
              aria-label={label}
              data-testid={`plan-compare-learn-${tier.key}`}
              sx={{ justifyContent: 'center', textAlign: 'center' }}
            >
              <Box
                component="span"
                data-compare-label=""
                sx={{
                  display: 'block',
                  minWidth: 0,
                  maxWidth: '100%',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {label}
              </Box>
            </Button>
          );
        })}
      </Box>
    </Stack>
  );
}
