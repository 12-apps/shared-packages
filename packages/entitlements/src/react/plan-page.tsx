/**
 * The plan screen — what this store is on, and what every tier gives.
 *
 * The page leads with the pricing cards and keeps the store's live status
 * BELOW them, because the two answer different questions and only one of them
 * is why somebody opens this screen:
 *
 *   cards   what each tier includes — the catalog, identical for every store
 *   status  what is on for THIS store right now, and why it is off if it is
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
import { Badge } from '@12-apps/ui/data-display/Badge';
import { ErrorState } from '@12-apps/ui/data-display/ErrorState';
import { LoadingState } from '@12-apps/ui/data-display/LoadingState';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Heading } from '@12-apps/ui/typography/Heading';
import { Text } from '@12-apps/ui/typography/Text';

import type { ComparisonTier, OpenPlanRequest, TenantFeatureView } from '../plan-wire';
import { createPlanApi, useRead } from './plan-api';
import { TierCards } from './tier-cards';
import type { ResolvedWebConfig } from './web-config';

/**
 * A quota ceiling, or nothing at all for an on/off capability.
 *
 * A ZERO ceiling returns null rather than `até 0` — "até 0" is not a limit a
 * customer can act on, it is a denial pretending to be one, and the row's own
 * note already says the feature is not included.
 */
function ceilingLabel(limit: TenantFeatureView['limit']): string | null {
  if (limit === null) return null;
  if (limit === 'unlimited') return 'ilimitado';
  if (limit === 0) return null;
  return `até ${String(limit)}`;
}

/**
 * "Ativar em Configuração › Mesas" — the way back to the store's own switch.
 *
 * Rendered ONLY for `disabled-by-tenant`, and keyed off that code rather than
 * off `enabled === false`: a tenant-switched feature can equally be dark
 * because the plan never granted it, and offering the toggle there would send
 * the store to flip something that cannot help.
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
      <Link to={location.path}>Ativar em {location.label}</Link>
    </Text>
  );
}

function FeatureRow({
  feature,
  config,
}: {
  feature: TenantFeatureView;
  config: ResolvedWebConfig;
}): JSX.Element {
  const ceiling = ceilingLabel(feature.limit);
  return (
    <Box
      data-testid={`plan-feature-${feature.feature}`}
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 2,
        py: 1.25,
        borderBottom: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        {/* `as="div"` on both: an inline default would render the label and
            the note as one run-on string. */}
        <Text as="div" weight="medium">
          {feature.description ?? feature.feature}
        </Text>
        <Text as="div" size="sm" color="secondary">
          {feature.note}
          {ceiling === null ? '' : ` · ${ceiling}`}
        </Text>
        {/* Only where upgrading is actually the remedy — the payload already
            withholds this for a feature the store switched off itself. The
            BUTTON lives on the tier's card instead of here: one press per
            tier reads better than the same offer repeated on every denied
            row. */}
        {feature.requiredPlan === null ? null : (
          <Text
            as="div"
            size="sm"
            color="secondary"
            data-testid={`plan-upsell-${feature.feature}`}
          >
            Disponível no plano {feature.requiredPlanLabel}.
          </Text>
        )}
        {/* The mirror image of the upsell line: this row is off because of a
            switch the store owns, so the useful thing to hand them is the way
            back to it. */}
        <TenantSwitchLink feature={feature} config={config} />
      </Box>
      <Badge color={feature.enabled ? 'success' : 'neutral'}>
        {feature.enabled ? 'Ativo' : 'Indisponível'}
      </Badge>
    </Box>
  );
}

/**
 * The two things that can be true about an ask: one is open, or the last one
 * failed. Both are page-level rather than card-level — a store has ONE
 * conversation with us, not one per tier.
 */
function RequestBanners({
  openRequest,
  error,
}: {
  openRequest: OpenPlanRequest | null;
  error: Error | null;
}): JSX.Element | null {
  if (openRequest !== null) {
    return (
      <Alert severity="info" data-testid="plan-request-open">
        Recebemos seu pedido para o plano {openRequest.requestedPlanKey}. Vamos entrar em
        contato para combinar os detalhes.
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
 * What is on for THIS store right now, and why it is off if it is.
 *
 * Kept separate from the cards because it is the only place that
 * distinguishes "your plan does not include this" from "you switched this off
 * yourself" — collapsing those two sells an upgrade that changes nothing.
 */
function CurrentStatus({
  features,
  config,
}: {
  features: TenantFeatureView[];
  config: ResolvedWebConfig;
}): JSX.Element {
  return (
    <Box>
      <Heading level="h3">Seu plano hoje</Heading>
      <Box sx={{ mb: 1 }}>
        <Text as="div" color="secondary" size="sm">
          O que está ativo nesta loja agora — e, quando não está, por quê.
        </Text>
      </Box>
      {features.length === 0 ? (
        <Text color="secondary">Nenhum recurso gerenciado por plano no momento.</Text>
      ) : (
        features.map((feature) => (
          <FeatureRow key={feature.feature} feature={feature} config={config} />
        ))
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
    createPlanApi(config.apiBase, config.fetchImpl)
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
 * accept: the plan READ is staff-wide on purpose — explaining a denial to
 * whoever hit it is the whole point of this screen — but committing the store
 * to a price conversation is an admin decision, and the POST enforces exactly
 * that tier. Offering a button that answers 403 is the same defect as linking
 * a page a role cannot open. Also hidden while the request read is in flight,
 * so it cannot appear and then vanish under someone already mid-click.
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
  const api = createPlanApi(config.apiBase, config.fetchImpl);
  const planRead = useRead(api.getPlan);
  const requestRead = useRead(api.getOpenRequest);
  const { asking, askError, askFor } = useAskForPlan(config, requestRead.reload);

  if (planRead.pending) return <LoadingState dataTestId="plan-loading" />;
  if (planRead.error !== null || planRead.data === null) {
    return (
      <ErrorState
        title="Não foi possível carregar seu plano"
        message={planRead.error?.message ?? ''}
      />
    );
  }

  const plan = planRead.data.plan;
  const openRequest = requestRead.data?.request ?? null;
  const canRequest = mayAsk(config, requestRead, openRequest);

  return (
    <Stack spacing={3} data-testid="plan-page">
      <Box>
        <Heading level="h2">Planos</Heading>
        <Box sx={{ mt: 0.5 }}>
          <Text as="div" color="secondary" size="sm">
            Seu plano hoje é <strong data-testid="plan-name">{plan.name}</strong>
            {plan.price === null ? '' : ` · ${plan.price}`}.
          </Text>
        </Box>
      </Box>

      <RequestBanners openRequest={openRequest} error={askError} />

      <TierCards tiers={plan.comparison} onRequest={canRequest ? askFor : null} pending={asking} />

      <CurrentStatus features={plan.features} config={config} />
    </Stack>
  );
}
