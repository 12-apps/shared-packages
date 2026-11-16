/**
 * The comparison where a table cannot fit: each feature's label on its own
 * full-width line, and under it ONE line of tiers, each cell its mark (or
 * ceiling) over the tier's name.
 *
 * A table at 320 px gave the label column ~35% of the card, and a label like
 * "Atendente de chat com IA" stood one word per line. Stacked, the label gets
 * the whole width and the tiers share the line beneath it in equal columns —
 * three, four or five fit at 320 px, because a cell holds only a mark and a
 * short name.
 *
 * The tier names head the columns once and repeat small under each mark, so
 * a row reads on its own after a scroll. The tenant's own tier and the
 * offered tier are worded in a legend line ABOVE the columns (text, never
 * colour alone): a badge over a column a fifth of 260 px wide would have to
 * break "Recomendado" mid-word.
 */
import type { JSX } from 'react';

import { Box } from '@12-apps/ui/mui/Box';
import { Text } from '@12-apps/ui/typography/Text';

import type { ComparisonTier } from '../plan-wire';
import { CellValue, type TierBadges } from './comparison-matrix';
import type { MatrixRow, MatrixSection } from './comparison-rows';
import type { ComparisonTableCopy } from './copy';

/**
 * Equal shares of the row, but never narrower than a column's longest word:
 * a tier name wraps between words and is never broken inside one. Five tiers
 * with real names fit 320 px this way; past that, the frame scrolls.
 */
function gridSx(count: number): Record<string, unknown> {
  return { display: 'grid', gridTemplateColumns: `repeat(${count}, minmax(min-content, 1fr))` };
}

function shade(tier: ComparisonTier, badges: TierBadges): string | undefined {
  return tier.current && badges.currentLabel !== null ? 'action.hover' : undefined;
}

/** One legend entry: the badge's word, then the tier's name. */
function LegendItem({
  text,
  tier,
  testId,
}: {
  text: string;
  tier: ComparisonTier;
  testId: string;
}): JSX.Element {
  return (
    // No gap: the colon follows the badge word directly ("Seu plano: Pro").
    <Box sx={{ display: 'inline-flex', alignItems: 'baseline' }}>
      <Text as="span" size="xs" weight="bold" data-testid={testId}>
        {text}
      </Text>
      <Text as="span" size="xs">
        {`: ${tier.name}`}
      </Text>
    </Box>
  );
}

function StackedLegend({
  tiers,
  badges,
}: {
  tiers: ComparisonTier[];
  badges: TierBadges;
}): JSX.Element | null {
  const current = tiers.find((tier) => tier.current);
  const offered = tiers.find((tier) => !tier.current && tier.key === badges.offeredKey);
  const items = [
    { text: badges.currentLabel, tier: current, testId: 'plan-matrix-current' },
    { text: badges.offeredLabel, tier: offered, testId: 'plan-matrix-offered' },
  ].filter(
    (item): item is { text: string; tier: ComparisonTier; testId: string } =>
      item.text !== null && item.tier !== undefined,
  );
  if (items.length === 0) return null;
  return (
    // One sentence, not two labels: two words spaced like headers read as the
    // columns below them, one off ("Seu plano Pro" over Gratuito, FUT-5062).
    <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1, rowGap: 0.5, px: 1, pt: 1, pb: 0.5 }}>
      {items.map((item, index) => (
        // The dot travels with the entry it introduces, so a wrap never leaves it hanging.
        <Box key={item.testId} sx={{ display: 'inline-flex', columnGap: 1, alignItems: 'baseline' }}>
          {index > 0 ? (
            <Text as="span" size="xs" aria-hidden="true">
              ·
            </Text>
          ) : null}
          <LegendItem {...item} />
        </Box>
      ))}
    </Box>
  );
}

function StackedHead({
  tiers,
  badges,
}: {
  tiers: ComparisonTier[];
  badges: TierBadges;
}): JSX.Element {
  return (
    <Box sx={{ ...gridSx(tiers.length), borderBottom: '2px solid', borderColor: 'divider' }}>
      {tiers.map((tier) => (
        <Box
          key={tier.key}
          data-current={tier.current ? 'true' : undefined}
          data-testid={`plan-matrix-tier-${tier.key}`}
          sx={{
            py: 1,
            px: 0.25,
            textAlign: 'center',
            bgcolor: shade(tier, badges),
            borderBottom: '2px solid',
            borderColor: tier.current ? 'primary.main' : 'transparent',
            mb: '-2px',
          }}
        >
          <Text as="span" size="xs" weight="bold">
            {tier.name}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

function StackedRow({
  row,
  tiers,
  copy,
  badges,
}: {
  row: MatrixRow;
  tiers: ComparisonTier[];
  copy: ComparisonTableCopy;
  badges: TierBadges;
}): JSX.Element {
  return (
    <Box data-testid="plan-matrix-row" sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ px: 1, pt: 1, pb: 0.5 }}>
        <Text as="div" size="sm" data-testid="plan-matrix-label">
          {row.label}
        </Text>
      </Box>
      <Box sx={gridSx(tiers.length)}>
        {tiers.map((tier) => (
          <Box
            key={tier.key}
            sx={{
              py: 0.75,
              px: 0.25,
              textAlign: 'center',
                bgcolor: shade(tier, badges),
            }}
          >
            <CellValue line={row.cells.get(tier.key)} copy={copy} size="xs" />
            <Text as="div" size="xs" color="secondary">
              {tier.name}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export function StackedMatrix({
  tiers,
  sections,
  copy,
  badges,
  sectionTitles,
}: {
  tiers: ComparisonTier[];
  sections: MatrixSection[];
  copy: ComparisonTableCopy;
  badges: TierBadges;
  sectionTitles: boolean;
}): JSX.Element {
  return (
    <Box data-testid="plan-compare-stacked">
      <StackedLegend tiers={tiers} badges={badges} />
      <StackedHead tiers={tiers} badges={badges} />
      {sections.map((section) => (
        <Box key={section.title}>
          {sectionTitles ? (
            <Box sx={{ px: 1, py: 1, bgcolor: 'action.hover' }}>
              <Text as="div" size="xs" weight="bold" color="secondary">
                {section.title.toUpperCase()}
              </Text>
            </Box>
          ) : null}
          {section.rows.map((row) => (
            <StackedRow key={row.id} row={row} tiers={tiers} copy={copy} badges={badges} />
          ))}
        </Box>
      ))}
    </Box>
  );
}
