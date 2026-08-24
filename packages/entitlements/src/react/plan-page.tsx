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
import { Chip } from '@12-apps/ui/data-display/Chip';
import { ErrorState } from '@12-apps/ui/data-display/ErrorState';
import { LoadingState } from '@12-apps/ui/data-display/LoadingState';
import { Button } from '@12-apps/ui/form/Button';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Heading } from '@12-apps/ui/typography/Heading';
import { Text } from '@12-apps/ui/typography/Text';

import type { ComparisonTier, OpenPlanRequest, TenantFeatureView } from '../plan-wire';
import { ComparisonTable } from './comparison-table';
import type { PlanPageCopy } from './copy';
import { createPlanApi, useRead } from './plan-api';
import { TierCards } from './tier-cards';
import type { ResolvedWebConfig } from './web-config';

/**
 * A quota ceiling, or nothing at all for an on/off capability.
 *
 * A ZERO ceiling returns null rather than the "up to 0" wording — that is
 * not a limit a customer can act on, it is a denial pretending to be one,
 * and the row's own note already says the feature is not included.
 */
function ceilingLabel(limit: TenantFeatureView['limit'], copy: PlanPageCopy): string | null {
  if (limit === null) return null;
  if (limit === 'unlimited') return copy.ceilingUnlimited;
  if (limit === 0) return null;
  return copy.ceilingUpTo({ limit });
}

/**
 * The way back to their own switch, named by the host (`copy.openSwitch`).
 *
 * Rendered ONLY for `disabled-by-tenant`, and keyed off that code rather than
 * off `enabled === false`: a tenant-switched feature can equally be dark
 * because the plan never granted it, and offering the toggle there would send
 * them to flip something that cannot help.
 */
function TenantSwitchLink({
  feature,
  config,
}: {
  feature: TenantFeatureView;
  config: ResolvedWebConfig;
}): JSX.Element | null {
  if (feature.reason !== 'disabled-by-tenant') return null;
  const location = config.switchLocation(feature.feature);
  if (location === null) return null;
  const Link = config.LinkComponent;
  return (
    <Text as="div" size="sm" data-testid={`plan-switch-${feature.feature}`}>
      <Link to={location.path}>{config.copy.planPage.openSwitch({ label: location.label })}</Link>
    </Text>
  );
}

/**
 * Why a row is off, and what to do about it — the second line, rendered only
 * for a row that HAS something to explain.
 *
 * Its own component because a row that is simply ON has nothing to say: the
 * chip is the whole message, and every one of the ~40 rows used to carry this
 * block whether or not it applied.
 */
function FeatureDenial({
  feature,
  config,
}: {
  feature: TenantFeatureView;
  config: ResolvedWebConfig;
}): JSX.Element {
  const copy = config.copy.planPage;
  return (
    <Box sx={{ mt: 0.25 }}>
      <Text as="div" size="sm" color="secondary">
        {feature.note}
        {/* Only where upgrading is actually the remedy — the payload already
            withholds this for a feature the store switched off itself. The
            BUTTON lives on the tier's card instead of here: one press per tier
            reads better than the same offer repeated on every denied row.

            SEPARATED rather than merely spaced: these are two sentences from
            two sources, and the note's own language decides whether it ends in
            punctuation. Run together they read as one broken sentence —
            "Não incluído no seu plano Disponível no plano Max." */}
        {feature.requiredPlan === null ? null : (
          <Text
            as="span"
            size="sm"
            color="secondary"
            data-testid={`plan-upsell-${feature.feature}`}
          >
            {' · '}
            {copy.availableOn({
              planLabel: feature.requiredPlanLabel ?? feature.requiredPlan,
            })}
          </Text>
        )}
      </Text>
      {/* The mirror image of the upsell line: this row is off because of a
          switch the tenant owns, so the useful thing to hand them is the way
          back to it. */}
      <TenantSwitchLink feature={feature} config={config} />
    </Box>
  );
}

/**
 * One capability, as one line — with a second line ONLY where something is
 * wrong.
 *
 * Every row used to carry a label, a note, an upsell sentence and a link as
 * four stacked blocks, on all ~40 features, enabled ones included. A row that
 * is simply on has nothing to explain: the chip is the whole message, and the
 * ceiling ("até 100") rides beside it because that is the only other fact a
 * working feature has. The prose is kept for the rows that are OFF, which is
 * where the screen actually has something to say.
 */
function FeatureRow({
  feature,
  config,
}: {
  feature: TenantFeatureView;
  config: ResolvedWebConfig;
}): JSX.Element {
  const copy = config.copy.planPage;
  const ceiling = ceilingLabel(feature.limit, copy);
  return (
    <Box
      data-testid={`plan-feature-${feature.feature}`}
      sx={{ py: 1, borderBottom: '1px solid', borderColor: 'divider' }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1.5,
        }}
      >
        <Text as="span" size="sm" weight="medium">
          {feature.description ?? feature.feature}
        </Text>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexShrink: 0 }}>
          {ceiling === null ? null : (
            <Text as="span" size="sm" color="secondary">
              {ceiling}
            </Text>
          )}
          {/* A CHIP, not a Badge. `@12-apps/ui`'s Badge wraps MUI's, which is
              the notification-DOT primitive: it renders its children as bare
              text with an invisible dot anchored to them, so the one marker
              distinguishing an available row from a withheld one arrived as
              unstyled grey text at the far right of the row. A chip is the
              pill this always meant to be, and it is what the tier badges
              above already use. */}
          <Chip
            label={feature.enabled ? copy.statusBadge.enabled : copy.statusBadge.disabled}
            size="sm"
            color={feature.enabled ? 'success' : 'neutral'}
            data-testid={`plan-status-${feature.feature}`}
          />
        </Stack>
      </Box>
      {feature.enabled ? null : <FeatureDenial feature={feature} config={config} />}
    </Box>
  );
}

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

/**
 * What is on for THIS tenant right now, and why it is off if it is.
 *
 * Kept separate from the cards because it is the only place that
 * distinguishes "your plan does not include this" from "you switched this off
 * yourself" — collapsing those two sells an upgrade that changes nothing.
 *
 * Opens on the BLOCKED rows alone. A registry of forty-odd capabilities
 * printed in full is a wall a customer scrolls past, and all but a handful of
 * it says "on" — which is the half nobody came to read. What is withheld, and
 * why, is the actionable half and the reason this section exists; the rest is
 * one press away and stays exactly one press away, because a store that wants
 * the whole inventory should not have to hunt for it either.
 */
function CurrentStatus({
  features,
  config,
}: {
  features: TenantFeatureView[];
  config: ResolvedWebConfig;
}): JSX.Element {
  const copy = config.copy.planPage;
  const [showAll, setShowAll] = useState(false);
  const blocked = features.filter((feature) => !feature.enabled);
  const hidden = features.length - blocked.length;
  const shown = showAll ? features : blocked;

  return (
    <Box>
      <Heading level="h3">{copy.statusHeading}</Heading>
      <Box sx={{ mb: 1 }}>
        <Text as="div" color="secondary" size="sm">
          {copy.statusIntro}
        </Text>
      </Box>
      {features.length === 0 ? (
        <Text color="secondary">{copy.statusEmpty}</Text>
      ) : (
        <>
          {shown.length === 0 ? (
            <Text as="div" color="secondary" size="sm" data-testid="plan-status-none-blocked">
              {copy.statusNothingBlocked}
            </Text>
          ) : (
            shown.map((feature) => (
              <FeatureRow key={feature.feature} feature={feature} config={config} />
            ))
          )}
          {hidden === 0 ? null : (
            <Box sx={{ mt: 1 }}>
              <Button
                variant="text"
                size="sm"
                onClick={() => setShowAll((was) => !was)}
                aria-expanded={showAll}
                data-testid="plan-status-toggle"
              >
                {showAll ? copy.statusShowBlocked : copy.statusShowAll({ count: hidden })}
              </Button>
            </Box>
          )}
        </>
      )}
    </Box>
  );
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

      <CurrentStatus features={plan.features} config={config} />
    </Stack>
  );
}
