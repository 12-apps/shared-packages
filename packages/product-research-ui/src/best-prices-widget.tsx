'use client';

/**
 * The compact top-3 for a product, embedded where the daily workflow already
 * happens (host product/inventory pages). Shows the LATEST completed
 * research for the term — exact matches first, then accent/case and near
 * variants (FUT-430) — freshness-stamped: prices age, and a widget that
 * hides its age would launder yesterday's price as today's. No research
 * yet is a teaching state with the one obvious action.
 */
import { useEffect, useState, type JSX } from 'react';

import { Chip } from '@12-apps/ui/data-display/Chip';
import { Button } from '@12-apps/ui/form/Button';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import type { ResearchApiClient } from './client';
import { formatCentsBRL, formatStamp } from './format';
import { resolveMessages, type ResearchMessages } from './messages';
import { OutsideAreaBadge } from './outside-area-badge';
import type { OfferOutput, ResearchRequestView } from './types';

export interface BestPricesWidgetProps {
  client: ResearchApiClient;
  /** The product to look up — matched against past research terms, exact first. */
  term: string;
  /** Open the full results screen for the shown research. */
  onOpenRequest: (requestId: string) => void;
  /** Start a fresh research for this product (host navigates, prefilled). */
  onStartResearch: () => void;
  maxOffers?: number;
  messages?: Partial<ResearchMessages>;
}

type WidgetState =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'ready'; request: ResearchRequestView; offers: OfferOutput[] };

/** The latest COMPLETED research for the term, with its top offers. */
function useLatestResearch(client: ResearchApiClient, term: string, maxOffers: number): WidgetState {
  const [state, setState] = useState<WidgetState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      const { data } = await client.listRequests({ page: 1, pageSize: 1, term });
      const request = data[0];
      if (request === undefined || request.latestRun?.status !== 'COMPLETED') {
        if (!cancelled) setState({ kind: 'empty' });
        return;
      }
      const run = await client.getRun(request.latestRun.id);
      if (!cancelled) setState({ kind: 'ready', request, offers: run.offers.slice(0, maxOffers) });
    };
    setState({ kind: 'loading' });
    load().catch(() => {
      // The widget is a convenience on someone else's page — degrade to the
      // teaching state rather than an error banner in a foreign layout.
      if (!cancelled) setState({ kind: 'empty' });
    });
    return () => {
      cancelled = true;
    };
  }, [client, term, maxOffers]);

  return state;
}

function OfferLine({
  offer,
  index,
  t,
}: {
  offer: OfferOutput;
  index: number;
  t: ResearchMessages;
}): JSX.Element {
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
      data-testid={`widget-offer-${index}`}
    >
      <Text variant="body" as="span" size="sm">
        {formatCentsBRL(offer.unitPriceCents)}/un
      </Text>
      <Text variant="caption" as="span" color="secondary">
        {offer.supplierName}
      </Text>
      <Chip label={offer.sourceType} size="sm" variant="outlined" />
      {/* FUT-495: the same OfferOutput the full screen badges. This widget
          showed these prices UNFLAGGED, so a store that does not deliver to the
          buyer looked ordinary on the product subpage — which defeats the whole
          "unmissable caveat" the FUT-491 decision rests on. */}
      {offer.outsideDeliveryArea ? (
        <OutsideAreaBadge t={t} dataTestId={`widget-outside-area-${offer.id}`} />
      ) : null}
      {/* NO shipping caveat here, deliberately (FUT-518): this line renders
          `unitPriceCents`, which is `priceCents / packQuantity` and never
          carries freight — so an unknown shipping cost qualifies no number on
          screen. That badge belongs with `totalCents`, which only the offers
          table and the hero card show. Put shipping into this line and the
          caveat has to come with it. */}
    </Stack>
  );
}

export function BestPricesWidget({
  client,
  term,
  onOpenRequest,
  onStartResearch,
  maxOffers = 3,
  messages,
}: BestPricesWidgetProps): JSX.Element {
  const t = resolveMessages(messages);
  const state = useLatestResearch(client, term, maxOffers);

  return (
    <Box
      sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}
      data-testid="best-prices-widget"
    >
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
          <Text variant="heading" as="h3" size="sm">
            {t.widgetTitle}
          </Text>
          {state.kind === 'ready' && (
            <Text variant="caption" as="span" color="secondary" data-testid="widget-freshness">
              {t.widgetFreshness(formatStamp(state.request.createdAt))}
            </Text>
          )}
        </Stack>
        {state.kind === 'loading' && (
          <Text variant="caption" as="p" color="secondary" role="status">
            …
          </Text>
        )}
        {state.kind === 'empty' && (
          <Text variant="body" as="p" color="secondary" data-testid="widget-empty">
            {t.widgetEmpty}
          </Text>
        )}
        {state.kind === 'ready' &&
          state.offers.map((offer, index) => (
            <OfferLine key={offer.id} offer={offer} index={index} t={t} />
          ))}
        <Stack direction="row" spacing={1.5}>
          {state.kind === 'ready' && (
            <Button
              variant="text"
              size="sm"
              onClick={() => onOpenRequest(state.request.id)}
              dataTestId="widget-open-research"
            >
              {t.widgetOpen}
            </Button>
          )}
          {state.kind !== 'loading' && (
            <Button
              variant="text"
              size="sm"
              onClick={onStartResearch}
              dataTestId="widget-start-research"
            >
              {t.widgetSearch}
            </Button>
          )}
        </Stack>
      </Stack>
    </Box>
  );
}
