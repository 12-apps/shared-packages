/**
 * The plan screen — what this tenant is on, and what every tier gives.
 *
 * Three bands, in the order the questions get asked:
 *
 *   cards   what each tier is FOR, what it costs, and what it adds over the
 *           one below it — four short cards, not four catalogs
 *   table   the full matrix, closed, for the visit that is actually comparing
 *   status  what is on for THIS tenant right now, and why it is off if it is
 *
 * The middle band is the whole shape of this screen and it is a subtraction.
 * Every card printed every line of every section, so the four of them stood
 * ~35 rows tall, repeated the same thirty labels four times, and pushed the
 * price and the button below the fold — a comparison layout in which no two
 * cards could be seen at once. The rows moved into one table where a label is
 * stated once; the cards kept the delta.
 *
 * The status half is not decoration and is deliberately not merged into the
 * cards: it is the only place that distinguishes "your plan does not include
 * this" from "you switched this off yourself" — and, for the second, links to
 * the settings screen that actually holds the switch. Collapsing those two
 * sells an upgrade that changes nothing, which is the single most damaging
 * thing this screen could do.
 *
 * The page reads; it never writes a tier. The one action on it asks the
 * platform to change the plan and records a lead for a human to answer.
 */
import { useState, type JSX } from 'react';

import { Alert } from '@12-apps/ui/data-display/Alert';
import { ErrorState } from '@12-apps/ui/data-display/ErrorState';
import { LoadingState } from '@12-apps/ui/data-display/LoadingState';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Heading } from '@12-apps/ui/typography/Heading';
import { Text } from '@12-apps/ui/typography/Text';

import type { ComparisonTier, OpenPlanRequest } from '../plan-wire';
import { ComparisonTable } from './comparison-table';
import type { PlanPageCopy } from './copy';
import { createPlanApi, useRead } from './plan-api';
import { CurrentStatus } from './plan-status';
import { TierCards } from './tier-cards';
import type { ResolvedWebConfig } from './web-config';

/**
 * The two things that can be true about an ask: one is open, or the last one
 * failed. Both are page-level rather than card-level — a tenant has ONE
 * conversation with us, not one per tier.
 */
function RequestBanners({
  openRequest,
  error,
  copy,
}: {
  openRequest: OpenPlanRequest | null;
  error: Error | null;
  copy: PlanPageCopy;
}): JSX.Element | null {
  if (openRequest !== null) {
    return (
      <Alert severity="info" data-testid="plan-request-open">
        {copy.requestReceived({ plan: openRequest.requestedPlanKey })}
      </Alert>
    );
  }
  if (error !== null) {
    return (
      <Alert severity="error" data-testid="plan-request-error">
        {error.message}
      </Alert>
    );
  }
  return null;
}

/** The press-to-ask flow: one pending flag, one error, reload on success. */
function useAskForPlan(
  config: ResolvedWebConfig,
  onFiled: () => void,
): { asking: boolean; askError: Error | null; askFor: (tier: ComparisonTier) => void } {
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<Error | null>(null);
  const askFor = (tier: ComparisonTier): void => {
    setAsking(true);
    setAskError(null);
    createPlanApi(config.apiBase, config.fetchImpl, config.copy.requestFailed)
      .requestPlanChange({ requestedPlan: tier.key })
      .then(
        () => {
          setAsking(false);
          onFiled();
        },
        (error: unknown) => {
          setAsking(false);
          setAskError(error instanceof Error ? error : new Error(String(error)));
        },
      );
  };
  return { asking, askError, askFor };
}

/**
 * Whether the ask buttons render at all. Shown only to callers the WRITE will
 * accept: the plan READ takes no permission on purpose — explaining a denial to
 * whoever hit it is the whole point of this screen — but committing the tenant
 * to a price conversation needs `plan:request`, and the POST enforces exactly
 * that. Offering a button that answers 403 is the same defect as linking a page
 * a role cannot open. Also hidden while the request read is in flight, so it
 * cannot appear and then vanish under someone already mid-click.
 */
function mayAsk(
  config: ResolvedWebConfig,
  requestRead: { pending: boolean; error: Error | null },
  openRequest: OpenPlanRequest | null,
): boolean {
  return (
    config.canRequestPlanChange &&
    !requestRead.pending &&
    requestRead.error === null &&
    openRequest === null
  );
}

export function PlanScreen({ config }: { config: ResolvedWebConfig }): JSX.Element {
  const copy = config.copy.planPage;
  const api = createPlanApi(config.apiBase, config.fetchImpl, config.copy.requestFailed);
  const planRead = useRead(api.getPlan);
  const requestRead = useRead(api.getOpenRequest);
  const { asking, askError, askFor } = useAskForPlan(config, requestRead.reload);

  if (planRead.pending) return <LoadingState dataTestId="plan-loading" />;
  if (planRead.error !== null || planRead.data === null) {
    return (
      <ErrorState title={copy.loadFailedTitle} message={planRead.error?.message ?? ''} />
    );
  }

  const plan = planRead.data.plan;
  const openRequest = requestRead.data?.request ?? null;
  const canRequest = mayAsk(config, requestRead, openRequest);

  return (
    <Stack spacing={3} data-testid="plan-page">
      <Box>
        <Heading level="h2">{copy.title}</Heading>
        <Box sx={{ mt: 0.5 }}>
          {/* The name slot is markup, so the sentence ships as prefix +
              detail around it — each half carries its own spacing and the
              detail carries the closing punctuation. */}
          <Text as="div" color="secondary" size="sm">
            {copy.currentPlanPrefix}
            <strong data-testid="plan-name">{plan.name}</strong>
            {copy.currentPlanDetail({ price: plan.price })}
          </Text>
        </Box>
      </Box>

      <RequestBanners openRequest={openRequest} error={askError} copy={copy} />

      <TierCards
        tiers={plan.comparison}
        onRequest={canRequest ? askFor : null}
        pending={asking}
        copy={config.copy.tierCards}
      />

      {/* The rows the cards no longer print, stated once each instead of once
          per card, and closed until somebody is actually comparing. */}
      <ComparisonTable tiers={plan.comparison} copy={config.copy.comparisonTable} />

      <CurrentStatus
        features={plan.features}
        planOrder={plan.comparison.map((tier) => tier.key)}
        config={config}
      />
    </Stack>
  );
}
