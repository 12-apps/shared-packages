'use client';

/**
 * The "Melhor preço" hero: unit price large, total for the requested
 * quantity, who sells it and how trustworthy the match is — with the CTA
 * explicit that phase-1 buying happens AT the store. Trust is shown, not
 * implied: relevance chip, source badge and the fardo math are all visible.
 */
import type { JSX } from 'react';

import { Chip } from '@12-apps/ui/data-display/Chip';
import { Button } from '@12-apps/ui/form/Button';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import { formatCentsBRL } from './format';
import { resolveMessages, type ResearchMessages } from './messages';
import { OutsideAreaBadge } from './outside-area-badge';
import { ShippingUnknownBadge } from './shipping-unknown-badge';
import type { OfferOutput } from './types';

export interface BestOfferCardProps {
  offer: OfferOutput;
  /** The requested quantity the total was computed for. */
  quantity: number;
  messages?: Partial<ResearchMessages>;
}

/** pt-BR availability label, tolerant of unknown wire values. */
export function availabilityLabel(
  availability: string | null,
  t: ResearchMessages,
): string {
  if (availability === 'IN_STOCK') return t.availabilityInStock;
  if (availability === 'OUT_OF_STOCK') return t.availabilityOutOfStock;
  return t.availabilityUnknown;
}

export function BestOfferCard({ offer, quantity, messages }: BestOfferCardProps): JSX.Element {
  const t = resolveMessages(messages);
  const unitLabel = formatCentsBRL(offer.unitPriceCents);
  const packLabel = formatCentsBRL(offer.priceCents);

  return (
    <Box
      sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2.5 }}
      data-testid="best-offer-card"
    >
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Chip label={t.bestOfferTitle} size="sm" color="success" variant="filled" />
          <Chip label={offer.sourceType} size="sm" variant="outlined" />
          <Chip
            label={t.relevance(Math.round(offer.relevanceScore * 100))}
            size="sm"
            variant="outlined"
          />
          {/* FUT-491: the cheapest price may come from a store that does not
              deliver here. It still leads — but never without the caveat. */}
          {offer.outsideDeliveryArea ? (
            <OutsideAreaBadge t={t} dataTestId="best-offer-outside-area" />
          ) : null}
        </Stack>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
          <Text variant="heading" as="p" size="xl" data-testid="best-offer-unit-price">
            {unitLabel}
            <Text variant="body" as="span" size="sm" color="secondary">
              {t.unitPriceSuffix}
            </Text>
          </Text>
          <Text variant="body" as="p" color="secondary" data-testid="best-offer-total">
            {formatCentsBRL(offer.totalCents)} {t.totalFor(quantity)}
          </Text>
          {/* FUT-518: the hero total is a MINIMUM when the store stated no
              shipping cost. It still leads on the ranking's arithmetic — the
              caveat travels with it rather than demoting it. */}
          {offer.shippingCents === null ? (
            <ShippingUnknownBadge t={t} dataTestId="best-offer-shipping-unknown" />
          ) : null}
        </Stack>
        <Text variant="body" as="p" data-testid="best-offer-title">
          {offer.title}
        </Text>
        <Text variant="caption" as="p" color="secondary">
          {offer.supplierName}
          {offer.packQuantity > 1
            ? ` · ${t.packMath(packLabel, offer.packQuantity, unitLabel)}`
            : ''}
          {' · '}
          {availabilityLabel(offer.availability, t)}
          {offer.etaDays !== null ? ` · ${t.etaDays(offer.etaDays)}` : ''}
        </Text>
        {offer.url !== null && (
          <Stack direction="row">
            {/* Explicitly off-platform: a plain anchor to a NEW TAB at the
                store, styled by the host's link rules — no window.open. */}
            <a
              href={offer.url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="best-offer-open"
            >
              <Button tabIndex={-1}>{t.openOffer}</Button>
            </a>
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
