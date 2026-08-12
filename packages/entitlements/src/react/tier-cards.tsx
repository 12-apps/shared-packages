/**
 * The pricing cards.
 *
 * Four cards, side by side, the store's own marked and every tier's contents
 * spelled out. The columns are the comparison: every card renders the same
 * sections in the same order, so a row means the same thing across all cards
 * and the eye can travel sideways — the host's `comparison` builder
 * guarantees that shape.
 *
 * All wording and every number arrive PRE-FORMATTED from the server. Nothing
 * here decides that a zero quota reads as "not included" rather than "até 0",
 * because that is a product statement and it belongs somewhere a test can
 * reach it.
 */
import type { JSX } from 'react';

import { Chip } from '@12-apps/ui/data-display/Chip';
import { Button } from '@12-apps/ui/form/Button';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Heading } from '@12-apps/ui/typography/Heading';
import { Text } from '@12-apps/ui/typography/Text';

import type { ComparisonLine, ComparisonTier } from '../plan-wire';

interface TierCardsProps {
  tiers: ComparisonTier[];
  /** Press-to-ask, or null when this caller may not ask (or already has). */
  onRequest: ((tier: ComparisonTier) => void) | null;
  pending: boolean;
}

/**
 * The ✓ / − marks, as plain SVG: this package takes no icon-font dependency
 * for two glyphs, and both are decoration (`aria-hidden`) — the line's
 * `included` state is what carries the meaning.
 */
function IncludedMark({ included }: { included: boolean }): JSX.Element {
  const stroke = included ? 'var(--mui-palette-success-main, #2e7d32)' : 'currentColor';
  return (
    <svg
      aria-hidden
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      style={{ flexShrink: 0, marginTop: 2, opacity: included ? 1 : 0.35 }}
    >
      <circle cx="12" cy="12" r="9" stroke={stroke} strokeWidth="2" />
      {included ? (
        <path d="M8 12.5l2.5 2.5L16 9.5" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
      ) : (
        <path d="M8 12h8" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
      )}
    </svg>
  );
}

function LineRow({ line }: { line: ComparisonLine }): JSX.Element {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', py: 0.5 }}>
      <IncludedMark included={line.included} />
      {/* The LABEL and the detail must not run together the way two inline
          spans would — hence the explicit block and the separated detail
          line. */}
      <Box sx={{ minWidth: 0 }}>
        {/* `neutral` is body text; `primary` is the BRAND colour and would
            render every included line as if it were a link. */}
        <Text as="div" size="sm" color={line.included ? 'neutral' : 'secondary'}>
          {line.label}
        </Text>
        {line.detail === null ? null : (
          <Text as="div" size="xs" color="secondary">
            {line.detail}
          </Text>
        )}
      </Box>
    </Stack>
  );
}

/** The badge strip: at most one of "seu plano" / "melhor oferta". */
function TierBadge({ tier }: { tier: ComparisonTier }): JSX.Element | null {
  // "Seu plano" wins over "melhor oferta" when both apply — telling a store
  // that the tier they already pay for is a great offer is noise, and knowing
  // which card is theirs is the thing they came for.
  if (tier.current) {
    return (
      <Chip label="SEU PLANO" size="sm" color="primary" data-testid={`tier-badge-${tier.key}`} />
    );
  }
  if (tier.recommended) {
    return (
      <Chip
        label="MELHOR OFERTA"
        size="sm"
        color="success"
        data-testid={`tier-badge-${tier.key}`}
      />
    );
  }
  return null;
}

function TierPrice({ tier }: { tier: ComparisonTier }): JSX.Element {
  return (
    <Box sx={{ mt: 2 }}>
      <Text size="lg" weight="bold" data-testid={`tier-price-${tier.key}`}>
        {tier.price ?? 'Sob consulta'}
      </Text>
      {tier.priceCents === null || tier.priceCents === 0 ? null : (
        // The interval belongs to a charge, and a free tier is not one:
        // "Grátis/mês" reads like a recurring bill of zero.
        <Text size="sm" color="secondary">
          {' '}
          /mês
        </Text>
      )}
    </Box>
  );
}

/**
 * The card's action, or nothing.
 *
 * Three states, and the two that render NOTHING are the deliberate ones: a
 * cheaper tier gets no button (asking for it through an upgrade flow would
 * file a downgrade as a sale), and neither does any tier when the caller may
 * not ask — the write is admin-only server-side, and a button that answers
 * 403 is the same defect as linking a page a role cannot open.
 */
function TierCta({
  tier,
  onRequest,
  pending,
}: {
  tier: ComparisonTier;
  onRequest: ((tier: ComparisonTier) => void) | null;
  pending: boolean;
}): JSX.Element | null {
  if (tier.current) {
    return (
      <Button size="sm" variant="outline" disabled fullWidth data-testid={`tier-cta-${tier.key}`}>
        Plano atual
      </Button>
    );
  }
  if (!tier.upgrade || onRequest === null) return null;
  return (
    <Button
      size="sm"
      fullWidth
      disabled={pending}
      onClick={() => onRequest(tier)}
      data-testid={`tier-cta-${tier.key}`}
    >
      Quero este plano
    </Button>
  );
}

function TierCard({
  tier,
  onRequest,
  pending,
}: {
  tier: ComparisonTier;
  onRequest: ((tier: ComparisonTier) => void) | null;
  pending: boolean;
}): JSX.Element {
  return (
    <Box
      data-testid={`tier-card-${tier.key}`}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        border: 1,
        borderRadius: 2,
        // The store's own card is outlined, so it is findable without reading.
        borderColor: tier.current ? 'primary.main' : 'divider',
        borderWidth: tier.current ? 2 : 1,
        p: 2,
        minWidth: 0,
      }}
    >
      <Box sx={{ minHeight: 28 }}>
        <TierBadge tier={tier} />
      </Box>

      <Heading level="h3">{tier.name}</Heading>

      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline', mt: 1 }}>
        <Text size="xl" weight="bold" data-testid={`tier-headline-${tier.key}`}>
          {tier.headline}
        </Text>
        <Text size="sm" color="secondary">
          {tier.headlineUnit}
        </Text>
      </Stack>

      <Box sx={{ mt: 1, minHeight: 40 }}>
        <Text as="div" size="sm" color="secondary">
          {tier.pitch}
        </Text>
      </Box>

      <Box sx={{ mt: 2, flex: 1 }}>
        {tier.sections.map((section) => (
          <Box key={section.title} sx={{ mb: 1.5 }}>
            <Box sx={{ mb: 0.5 }}>
              <Text as="div" size="xs" weight="bold" color="secondary">
                {section.title.toUpperCase()}
              </Text>
            </Box>
            {section.lines.map((line) => (
              <LineRow key={line.label} line={line} />
            ))}
          </Box>
        ))}
      </Box>

      <TierPrice tier={tier} />
      <Box sx={{ mt: 1.5 }}>
        <TierCta tier={tier} onRequest={onRequest} pending={pending} />
      </Box>
    </Box>
  );
}

export function TierCards({ tiers, onRequest, pending }: TierCardsProps): JSX.Element {
  return (
    <Box
      data-testid="tier-cards"
      sx={{
        display: 'grid',
        // Side by side on a desktop, stacked on a phone — a four-column grid
        // squeezed onto 360px would make every card unreadable rather than
        // comparable.
        gridTemplateColumns: {
          xs: '1fr',
          md: 'repeat(2, minmax(0, 1fr))',
          lg: `repeat(${String(tiers.length)}, minmax(0, 1fr))`,
        },
        gap: 2,
        alignItems: 'stretch',
      }}
    >
      {tiers.map((tier) => (
        <TierCard key={tier.key} tier={tier} onRequest={onRequest} pending={pending} />
      ))}
    </Box>
  );
}
