/**
 * The comparison's footer: the one ask (`'cheapest'`), or one action per plan on
 * sale (`'each'`, `plan-compare-each.tsx`), always ending where there is
 * nothing else to offer on the all-plans link.
 */
import type { JSX } from 'react';

import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import { EachPlanActions } from './plan-compare-each';
import type { CompareOffer, CompareOffers } from './plan-compare-layout';
import { PlanPitchLine, UpgradeCta } from './upgrade-cta';
import type { ResolvedWebConfig } from './web-config';

/** The all-plans link, with a 40 px hit area (a 16 px line of text is not a target). */
function AllPlansLink({
  config,
  onClose,
}: {
  config: ResolvedWebConfig;
  onClose: () => void;
}): JSX.Element | null {
  if (config.plansPath === null) return null;
  const Link = config.LinkComponent;
  return (
    <Box
      sx={{
        '& a': { display: 'inline-flex', alignItems: 'center', minHeight: 40 },
      }}
      data-testid="plan-compare-all-plans-target"
    >
      <Text as="span" size="sm">
        <Link to={config.plansPath} onClick={onClose} data-testid="plan-compare-all-plans">
          {config.copy.upsell.allPlansLink}
        </Link>
      </Text>
    </Box>
  );
}

/** The one ask: for the offered tier, then the all-plans link. */
function SingleAskFooter({
  offer,
  feature,
  config,
  onClose,
}: {
  offer: CompareOffer;
  feature: string | undefined;
  config: ResolvedWebConfig;
  onClose: () => void;
}): JSX.Element {
  const offered = offer.tier;
  const requiredPlan = offered?.key ?? null;
  const target = feature === undefined ? { requiredPlan } : { requiredPlan, feature };
  return (
    <Stack spacing={1} sx={{ width: '100%' }} data-testid="plan-compare-footer">
      {offer.covered ? (
        <Text as="div" data-testid="plan-compare-already-included">
          {config.copy.planCompare.alreadyIncluded}
        </Text>
      ) : null}
      <PlanPitchLine planName={offered?.name ?? null} config={config} />
      <UpgradeCta target={target} planName={offered?.name ?? null} config={config} />
      <AllPlansLink config={config} onClose={onClose} />
    </Stack>
  );
}

export function CompareFooter({
  offer,
  each,
  feature,
  config,
  onClose,
}: {
  offer: CompareOffer;
  each: CompareOffers | null;
  feature: string | undefined;
  config: ResolvedWebConfig;
  onClose: () => void;
}): JSX.Element {
  if (each !== null && config.plansPath !== null && each.tiers.length > 0) {
    return (
      <EachPlanActions
        offers={each}
        plansPath={config.plansPath}
        config={config}
        onClose={onClose}
      />
    );
  }
  return <SingleAskFooter offer={offer} feature={feature} config={config} onClose={onClose} />;
}
