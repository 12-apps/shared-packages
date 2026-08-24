/**
 * The pricing cards.
 *
 * ## What a card is for, and what it stopped being
 *
 * A card answers two questions and nothing else: **is this me** (the pitch,
 * the headline number) and **what does it cost**. The reason to move up is
 * the DIFFERENCE from the tier before it, so that is the list a card carries
 * — four lines of it — and the full matrix lives in the comparison table
 * below, where each label is stated once across all tiers instead of once per
 * card.
 *
 * It used to print every section of every line on every card. Four cards
 * ~35 rows tall each: the same thirty labels four times over, the price and
 * the button pushed under all of them, and the side-by-side comparison the
 * layout was built for impossible to actually perform because no two cards
 * fit on a screen together. Order follows from that — price and CTA sit ABOVE
 * the list now, because they are the reason the customer is on this screen and
 * a list is no reason to scroll past them.
 *
 * Every tier's wording and every number still arrive PRE-FORMATTED from the
 * server; the card chrome's own words (badges, CTAs, the unpriced slot, the
 * "everything in X, plus" line) are required host copy. Nothing here decides
 * how a zero quota reads, because that is a product statement and it belongs
 * somewhere a test can reach it.
 */
import type { JSX } from 'react';

import { Chip } from '@12-apps/ui/data-display/Chip';
import { Button } from '@12-apps/ui/form/Button';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Heading } from '@12-apps/ui/typography/Heading';
import { Text } from '@12-apps/ui/typography/Text';

import type { ComparisonLine, ComparisonTier } from '../plan-wire';
import type { TierCardsCopy } from './copy';
import { IncludedMark } from './marks';
import { tierHighlights } from './tier-highlights';

/**
 * How many differences a card shows before it starts counting.
 *
 * Four, because that is what fits above the fold beside three sibling cards
 * on a laptop — and because a list long enough to need scanning is the full
 * matrix, which is one press away.
 */
const HIGHLIGHT_LIMIT = 4;

interface TierCardsProps {
  tiers: ComparisonTier[];
  /** Press-to-ask, or null when this caller may not ask (or already has). */
  onRequest: ((tier: ComparisonTier) => void) | null;
  pending: boolean;
  /** The cards' own words (badges, CTAs, the unpriced slot) — the host's. */
  copy: TierCardsCopy;
}

/**
 * One difference. The mark is decoration here (`label: null`) — the line's
 * own text carries the meaning, and a screen reader announcing "included"
 * before every one of them would read the list twice.
 */
function HighlightRow({ line }: { line: ComparisonLine }): JSX.Element {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', py: 0.375 }}>
      <Box sx={{ mt: '1px' }}>
        <IncludedMark included label={null} />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        {/* `neutral` is body text; `primary` is the BRAND colour and would
            render every line as if it were a link. */}
        <Text as="span" size="sm">
          {line.label}
        </Text>
        {line.detail === null ? null : (
          <Text as="span" size="sm" color="secondary">
            {' · '}
            {line.detail}
          </Text>
        )}
      </Box>
    </Stack>
  );
}

/** The badge strip: at most one of the current / recommended badges. */
function TierBadge({
  tier,
  copy,
}: {
  tier: ComparisonTier;
  copy: TierCardsCopy;
}): JSX.Element | null {
  // The tenant's own badge wins over the recommendation when both apply —
  // telling a tenant that the tier they already pay for is a great offer is
  // noise, and knowing which card is theirs is the thing they came for.
  if (tier.current) {
    return (
      <Chip
        label={copy.currentBadge}
        size="sm"
        color="primary"
        data-testid={`tier-badge-${tier.key}`}
      />
    );
  }
  if (tier.recommended) {
    return (
      <Chip
        label={copy.recommendedBadge}
        size="sm"
        color="success"
        data-testid={`tier-badge-${tier.key}`}
      />
    );
  }
  return null;
}

/**
 * The price, and whatever the host words beside it.
 *
 * `priceNote` arrives from the host's billing rather than being written here.
 * It used to be a hardcoded "/mês" suppressed on free tiers — which is two
 * product statements this package is in no position to make: that the host
 * bills monthly, and that a zero price is not a recurring charge. A host
 * billing annually rendered its yearly price as a monthly one.
 */
function TierPrice({ tier, copy }: { tier: ComparisonTier; copy: TierCardsCopy }): JSX.Element {
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'baseline', mt: 1.5 }}>
      <Text size="xl" weight="bold" data-testid={`tier-price-${tier.key}`}>
        {tier.price ?? copy.priceUnpriced}
      </Text>
      {tier.priceNote === null ? null : (
        <Text size="sm" color="secondary" data-testid={`tier-price-note-${tier.key}`}>
          {tier.priceNote}
        </Text>
      )}
    </Stack>
  );
}

/**
 * The card's action, or nothing.
 *
 * Three states, and the two that render NOTHING are the deliberate ones: a
 * cheaper tier gets no button (asking for it through an upgrade flow would
 * file a downgrade as a sale), and neither does any tier when the caller may
 * not ask — the write requires `plan:request` server-side, and a button that
 * answers 403 is the same defect as linking a page a role cannot open.
 */
function TierCta({
  tier,
  onRequest,
  pending,
  copy,
}: {
  tier: ComparisonTier;
  onRequest: ((tier: ComparisonTier) => void) | null;
  pending: boolean;
  copy: TierCardsCopy;
}): JSX.Element | null {
  if (tier.current) {
    return (
      <Button size="sm" variant="outline" disabled fullWidth data-testid={`tier-cta-${tier.key}`}>
        {copy.currentAction}
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
      {copy.requestAction}
    </Button>
  );
}

/** The delta list, headed by the tier it builds on. */
function TierDelta({
  tiers,
  index,
  copy,
}: {
  tiers: ComparisonTier[];
  index: number;
  copy: TierCardsCopy;
}): JSX.Element | null {
  const tier = tiers[index];
  if (tier === undefined) return null;
  const { lines, more, inheritsFrom } = tierHighlights(tiers, index, HIGHLIGHT_LIMIT);
  if (lines.length === 0) return null;
  return (
    <Box sx={{ mt: 2 }} data-testid={`tier-highlights-${tier.key}`}>
      <Box sx={{ mb: 0.5 }}>
        <Text as="div" size="xs" weight="bold" color="secondary">
          {inheritsFrom === null
            ? copy.highlightsHeading
            : copy.inheritsFrom({ planName: inheritsFrom })}
        </Text>
      </Box>
      {lines.map((line) => (
        <HighlightRow key={line.label} line={line} />
      ))}
      {more === 0 ? null : (
        <Box sx={{ mt: 0.5 }}>
          <Text as="div" size="xs" color="secondary" data-testid={`tier-more-${tier.key}`}>
            {copy.moreIncluded({ count: more })}
          </Text>
        </Box>
      )}
    </Box>
  );
}

function TierCard({
  tiers,
  index,
  onRequest,
  pending,
  copy,
}: {
  tiers: ComparisonTier[];
  index: number;
  onRequest: ((tier: ComparisonTier) => void) | null;
  pending: boolean;
  copy: TierCardsCopy;
}): JSX.Element | null {
  const tier = tiers[index];
  if (tier === undefined) return null;
  return (
    <Box
      data-testid={`tier-card-${tier.key}`}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        border: 1,
        borderRadius: 2,
        // The tenant's own card is outlined, so it is findable without reading.
        borderColor: tier.current ? 'primary.main' : 'divider',
        borderWidth: tier.current ? 2 : 1,
        p: 2,
        minWidth: 0,
      }}
    >
      <Box sx={{ minHeight: 28 }}>
        <TierBadge tier={tier} copy={copy} />
      </Box>

      <Heading level="h3">{tier.name}</Heading>

      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline', mt: 0.5 }}>
        <Text size="md" weight="bold" data-testid={`tier-headline-${tier.key}`}>
          {tier.headline}
        </Text>
        <Text size="sm" color="secondary">
          {tier.headlineUnit}
        </Text>
      </Stack>

      {/* Price and action ABOVE the list: they are why the customer opened
          this screen, and a feature list is no reason to scroll past them. */}
      <TierPrice tier={tier} copy={copy} />
      <Box sx={{ mt: 1.5 }}>
        <TierCta tier={tier} onRequest={onRequest} pending={pending} copy={copy} />
      </Box>

      <Box sx={{ mt: 1.5, minHeight: 40 }}>
        <Text as="div" size="sm" color="secondary">
          {tier.pitch}
        </Text>
      </Box>

      <TierDelta tiers={tiers} index={index} copy={copy} />
    </Box>
  );
}

export function TierCards({ tiers, onRequest, pending, copy }: TierCardsProps): JSX.Element {
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
      {tiers.map((tier, index) => (
        <TierCard
          key={tier.key}
          tiers={tiers}
          index={index}
          onRequest={onRequest}
          pending={pending}
          copy={copy}
        />
      ))}
    </Box>
  );
}
