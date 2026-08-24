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

import type { ComparisonTier, OpenPlanRequest, TenantPlanPayload } from '../plan-wire';
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

/**
 * The read every plan screen makes, plus the two states none of them renders
 * anything else in.
 *
 * Three screens now read the same payload — the catalog, the audit and the
 * summary line — and each is a separate ROUTE, so each makes its own request.
 * That is not waste: they are different pages, reached at different times, and
 * a shared cache would be a second mechanism to keep honest for no gain a user
 * can see.
 */
function usePlanShell(config: ResolvedWebConfig): {
  plan: TenantPlanPayload | null;
  fallback: JSX.Element | null;
} {
  const api = createPlanApi(config.apiBase, config.fetchImpl, config.copy.requestFailed);
  const planRead = useRead(api.getPlan);
  if (planRead.pending) return { plan: null, fallback: <LoadingState dataTestId="plan-loading" /> };
  if (planRead.error !== null || planRead.data === null) {
    return {
      plan: null,
      fallback: (
        <ErrorState
          title={config.copy.planPage.loadFailedTitle}
          message={planRead.error?.message ?? ''}
        />
      ),
    };
  }
  return { plan: planRead.data.plan, fallback: null };
}

/** The heading and the one line under it: what this tenant is on, priced. */
function PlanHeader({
  title,
  plan,
  copy,
}: {
  title: string;
  plan: TenantPlanPayload;
  copy: PlanPageCopy;
}): JSX.Element {
  return (
    <Box>
      <Heading level="h2">{title}</Heading>
      <Box sx={{ mt: 0.5 }}>
        {/* The name slot is markup, so the sentence ships as prefix + detail
            around it — each half carries its own spacing and the detail
            carries the closing punctuation. */}
        <Text as="div" color="secondary" size="sm">
          {copy.currentPlanPrefix}
          <strong data-testid="plan-name">{plan.name}</strong>
          {copy.currentPlanDetail({ price: plan.price })}
        </Text>
      </Box>
    </Box>
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

/**
 * The CATALOG — what every tier is and costs, and the full matrix under it.
 *
 * One of the two halves the plan surface splits into as separate routes, and
 * the one somebody arrives at deliberately: from an upsell prompt, or because
 * they are thinking about paying more. It carries the ask flow, because asking
 * for a tier is the action a catalog exists to offer.
 *
 * The AUDIT is not here. "Why is this locked for me" and "what would the next
 * tier give me" are one journey, but they are two questions, and a page that
 * answered both was ~35 rows of cards followed by ~40 rows of audit — the
 * screen this split exists to end.
 */
export function PlansScreen({ config }: { config: ResolvedWebConfig }): JSX.Element {
  const copy = config.copy.planPage;
  const api = createPlanApi(config.apiBase, config.fetchImpl, config.copy.requestFailed);
  const requestRead = useRead(api.getOpenRequest);
  const { asking, askError, askFor } = useAskForPlan(config, requestRead.reload);
  const { plan, fallback } = usePlanShell(config);
  if (plan === null) return fallback ?? <LoadingState dataTestId="plan-loading" />;

  const openRequest = requestRead.data?.request ?? null;
  const canRequest = mayAsk(config, requestRead, openRequest);

  return (
    <Stack spacing={3} data-testid="plans-page">
      <PlanHeader title={copy.title} plan={plan} copy={copy} />
      <RequestBanners openRequest={openRequest} error={askError} copy={copy} />
      <TierCards
        tiers={plan.comparison}
        onRequest={canRequest ? askFor : null}
        pending={asking}
        copy={config.copy.tierCards}
      />
      <ComparisonTable tiers={plan.comparison} copy={config.copy.comparisonTable} />
    </Stack>
  );
}

/**
 * The AUDIT — what is on for THIS tenant, and why it is off where it is.
 *
 * Its own route because it is reached for a specific reason (something was
 * locked) rather than browsed, and because it is long: a registry of forty-odd
 * capabilities has no business sitting under a price list somebody is reading
 * for a different question.
 */
export function PlanFeaturesScreen({ config }: { config: ResolvedWebConfig }): JSX.Element {
  const copy = config.copy.planPage;
  const { plan, fallback } = usePlanShell(config);
  if (plan === null) return fallback ?? <LoadingState dataTestId="plan-loading" />;
  return (
    <Stack spacing={3} data-testid="plan-features-page">
      <PlanHeader title={copy.statusHeading} plan={plan} copy={copy} />
      <CurrentStatus
        features={plan.features}
        planOrder={plan.comparison.map((tier) => tier.key)}
        config={config}
        headed={false}
      />
    </Stack>
  );
}

/**
 * The SUMMARY — the whole plan surface as it appears on an account page.
 *
 * What this tenant is on, and the two ways in. Deliberately not a third copy
 * of the catalog: an account page answers "what am I paying", and the two
 * links are how somebody who came for that question leaves with a different
 * one. The features link carries the COUNT, because "21 recursos
 * indisponíveis" is the only part of a forty-row audit that belongs on a page
 * this short — and it is what makes opening it worth the click.
 */
export function PlanSummary({ config }: { config: ResolvedWebConfig }): JSX.Element {
  const copy = config.copy.planPage;
  const { plan, fallback } = usePlanShell(config);
  if (plan === null) return fallback ?? <LoadingState dataTestId="plan-loading" />;

  const Link = config.LinkComponent;
  const blocked = plan.features.filter(
    (feature) => !feature.enabled || feature.requiredPlan !== null,
  ).length;

  return (
    <Stack spacing={1} data-testid="plan-summary">
      <PlanHeader title={copy.title} plan={plan} copy={copy} />
      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
        {config.plansPath === null ? null : (
          <Text as="span" size="sm" data-testid="plan-summary-plans">
            <Link to={config.plansPath}>{copy.summaryPlansLink}</Link>
          </Text>
        )}
        {config.featuresPath === null ? null : (
          <Text as="span" size="sm" data-testid="plan-summary-features">
            <Link to={config.featuresPath}>{copy.summaryFeaturesLink({ blocked })}</Link>
          </Text>
        )}
      </Stack>
    </Stack>
  );
}
