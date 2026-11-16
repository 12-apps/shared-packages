/**
 * The comparison's footer when a screen asks for EVERY plan on sale
 * (`offer: 'each'`): one "Conhecer o <plano>" per upgrade tier, side by side,
 * each opening the plans page at that tier.
 *
 * ## One line at every width
 *
 * The actions answer one question — which plan do you want to look at — so
 * they sit on ONE line however narrow the dialog is: equal columns, never a
 * wrapped second row and never a sideways scroll. A label that does not fit
 * its column wraps INSIDE its button instead (the tier name is a word the
 * host chose, and a long one must not push a sibling out of the row).
 *
 * ## Which one is solid
 *
 * One primary per row: the tier the host flags `recommended`, else the most
 * expensive offered (the last, in the payload's cheapest-first order). The
 * others are outlined, so the row reads as one act with a preferred answer.
 *
 * ## Where it goes
 *
 * `plansPath` with the tier's key as `?plan=<key>` — the host's plans screen
 * is the host's to route, so this package only names the tier. It is a link,
 * not a plan request: "Conhecer" is looking, and the plan page owns asking.
 */
import type { JSX } from 'react';

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
 * The per-plan actions. `plansPath` is passed in (already known non-null by
 * the caller) so this never links a page the host did not route. Nothing
 * offered (the tenant's tier covers every row, or no plan is on sale) renders
 * nothing here: the caller's own footer says so.
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
  const { tiers } = offers;
  if (tiers.length === 0) return null;
  const primary = primaryTier(tiers);
  return (
    <Stack spacing={1} sx={{ width: '100%' }} data-testid="plan-compare-each">
      <Box
        sx={{
          display: 'grid',
          gridAutoFlow: 'column',
          gridAutoColumns: 'minmax(0, 1fr)',
          gap: 1,
          width: '100%',
        }}
      >
        {tiers.map((tier) => (
          <Button
            key={tier.key}
            component={config.LinkComponent}
            to={planPathAt(plansPath, tier.key)}
            onClick={onClose}
            variant={tier === primary ? 'solid' : 'outline'}
            size="sm"
            fullWidth
            data-testid={`plan-compare-learn-${tier.key}`}
          >
            {config.copy.planCompare.learnPlan({ planName: tier.name })}
          </Button>
        ))}
      </Box>
    </Stack>
  );
}
