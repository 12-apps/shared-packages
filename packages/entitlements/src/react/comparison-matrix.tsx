/**
 * The comparison matrix — tiers across, rows down — as ONE renderer shared by
 * the plan page's full table (`ComparisonTable`) and a screen's own plan
 * comparison (`PlanCompareDialog`). Two surfaces, one matrix: the moment they
 * drew their own, they would start disagreeing about what a cell means.
 *
 * ## Every word here is the host's, including the cells
 *
 * Rows and labels come from the payload. The two MARKS do not — a card's tick
 * sits beside a label that carries the meaning, but a matrix cell has no text
 * of its own, so ✓ and − are the cell's only reading and each needs a word.
 * They are required copy (`comparisonTable.included` / `.excluded`) rather
 * than a glyph this package words itself.
 *
 * ## The row set is built from the union, not from the first tier
 *
 * The host's builder emits the same sections in the same order for every tier
 * — that shape is what makes the comparison legible in the first place — but
 * this reads the union anyway and renders a missing cell as excluded. A host
 * whose tiers disagree gets a table with a hole in it, which is honest; the
 * alternative silently drops whatever the first tier happens not to have.
 *
 * ## Two densities
 *
 * `full` is the plan page's: a sticky label column and roomy tier columns
 * that scroll sideways under five tiers on a phone. `compact` is a dialog's
 * table: a 160 px label floor and 88 px tier columns, used only where the
 * dialog MEASURED room for them (`matrixLayoutFor`); narrower than that, the
 * dialog stacks instead (`StackedMatrix`). Tier names wrap at word breaks and
 * a long label word breaks anywhere rather than widening its column.
 *
 * Above the tier names, two optional words: the tenant's own tier
 * (`currentLabel`) and the tier the caller is offering (`offeredLabel`) —
 * text, never colour alone.
 */
import type { JSX } from 'react';

import { Box } from '@12-apps/ui/mui/Box';
import { Text } from '@12-apps/ui/typography/Text';

import type { ComparisonLine, ComparisonTier } from '../plan-wire';
import type { MatrixSection } from './comparison-rows';
import type { ComparisonTableCopy } from './copy';
import { IncludedMark } from './marks';

type MatrixDensity = 'full' | 'compact';

interface MatrixStyle {
  cellPx: number;
  labelMinWidth: number | undefined;
  tierMinWidth: number;
  stickyLabel: boolean;
  detailSize: 'xs' | 'sm';
  headAlign: 'bottom' | undefined;
}

/** The compact table's floors — what `matrixLayoutFor` budgets against. */
export const COMPACT_LABEL_MIN_PX = 160;
export const COMPACT_TIER_MIN_PX = 88;

const STYLES: Record<MatrixDensity, MatrixStyle> = {
  // Sticky so the row label survives the horizontal scroll a five-column
  // table needs on anything narrower than a laptop.
  full: {
    cellPx: 1.5,
    labelMinWidth: 220,
    tierMinWidth: 110,
    stickyLabel: true,
    detailSize: 'sm',
    headAlign: undefined,
  },
  compact: {
    cellPx: 1,
    labelMinWidth: COMPACT_LABEL_MIN_PX,
    tierMinWidth: COMPACT_TIER_MIN_PX,
    stickyLabel: false,
    detailSize: 'xs',
    headAlign: 'bottom',
  },
};

function labelColumnSx(style: MatrixStyle): Record<string, unknown> {
  return style.stickyLabel
    ? { position: 'sticky', left: 0, bgcolor: 'background.paper' }
    : // `anywhere`, not `break-word`: only `anywhere` lowers a cell's
      // min-content width, so one long word cannot widen the label column.
      { overflowWrap: 'anywhere' };
}

/** What a cell says: its mark, or the ceiling it prints. Shared with the stacked layout. */
export function CellValue({
  line,
  copy,
  size,
}: {
  line: ComparisonLine | undefined;
  copy: ComparisonTableCopy;
  size: 'xs' | 'sm';
}): JSX.Element {
  const included = line?.included ?? false;
  const detail = included ? line?.detail ?? null : null;
  if (detail !== null) {
    return (
      <Text as="span" size={size}>
        {detail}
      </Text>
    );
  }
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center' }}>
      <IncludedMark included={included} label={included ? copy.included : copy.excluded} />
    </Box>
  );
}

/** The words over the tier names: whose tier it is, and which one is offered. */
export interface TierBadges {
  currentLabel: string | null;
  offeredKey: string | null;
  offeredLabel: string | null;
}

const NO_BADGES: TierBadges = { currentLabel: null, offeredKey: null, offeredLabel: null };

/** The badge a tier wears, if any — its own tier wins over being offered. */
function badgeFor(tier: ComparisonTier, badges: TierBadges): string | null {
  if (tier.current) return badges.currentLabel;
  return tier.key === badges.offeredKey ? badges.offeredLabel : null;
}

/**
 * One cell.
 *
 * A ceiling PRINTS rather than ticking: "até 100" against "até 20" is the
 * whole reason a row exists, and two identical ✓ marks would hide it. The
 * mark is kept beside it so the column still scans vertically.
 */
function MatrixCell({
  line,
  copy,
  style,
  current,
}: {
  line: ComparisonLine | undefined;
  copy: ComparisonTableCopy;
  style: MatrixStyle;
  current: boolean;
}): JSX.Element {
  return (
    <Box
      component="td"
      sx={{
        py: 1,
        px: style.cellPx,
        borderBottom: '1px solid',
        borderColor: 'divider',
        textAlign: 'center',
        verticalAlign: 'middle',
        bgcolor: current ? 'action.hover' : undefined,
      }}
    >
      <CellValue line={line} copy={copy} size={style.detailSize} />
    </Box>
  );
}

function TierHead({
  tier,
  style,
  badges,
}: {
  tier: ComparisonTier;
  style: MatrixStyle;
  badges: TierBadges;
}): JSX.Element {
  const badge = badgeFor(tier, badges);
  const shaded = tier.current && badges.currentLabel !== null;
  return (
    <Box
      component="th"
      scope="col"
      data-current={tier.current ? 'true' : undefined}
      data-testid={`plan-matrix-tier-${tier.key}`}
      sx={{
        py: 1,
        px: style.cellPx,
        textAlign: 'center',
        verticalAlign: style.headAlign,
        borderBottom: '2px solid',
        borderColor: tier.current ? 'primary.main' : 'divider',
        minWidth: style.tierMinWidth,
        bgcolor: shaded ? 'action.hover' : undefined,
      }}
    >
      {badge === null ? null : <TierBadge tier={tier} text={badge} />}
      <Text as="span" size="sm" weight="bold">
        {tier.name}
      </Text>
    </Box>
  );
}

/**
 * The badge's text. Default (body) ink, not the brand colour: the brand
 * primary on the shaded column measured 4.49:1, under AA, and a brand colour
 * is the host's to pick, so it cannot be what the reading depends on.
 */
function TierBadge({ tier, text }: { tier: ComparisonTier; text: string }): JSX.Element {
  return (
    <Text
      as="div"
      size="xs"
      weight="bold"
      data-testid={tier.current ? 'plan-matrix-current' : 'plan-matrix-offered'}
    >
      {text}
    </Text>
  );
}

function MatrixHead({
  tiers,
  copy,
  style,
  badges,
}: {
  tiers: ComparisonTier[];
  copy: ComparisonTableCopy;
  style: MatrixStyle;
  badges: TierBadges;
}): JSX.Element {
  return (
    <Box component="thead">
      <Box component="tr">
        <Box
          component="th"
          scope="col"
          sx={{
            py: 1,
            px: style.cellPx,
            textAlign: 'left',
            verticalAlign: style.headAlign,
            borderBottom: '2px solid',
            borderColor: 'divider',
            minWidth: style.labelMinWidth,
            ...labelColumnSx(style),
          }}
        >
          <Text as="span" size="xs" weight="bold" color="secondary">
            {copy.featureColumn}
          </Text>
        </Box>
        {tiers.map((tier) => (
          <TierHead key={tier.key} tier={tier} style={style} badges={badges} />
        ))}
      </Box>
    </Box>
  );
}

function SectionHeading({
  title,
  span,
  style,
}: {
  title: string;
  span: number;
  style: MatrixStyle;
}): JSX.Element {
  return (
    <Box component="tr">
      <Box
        component="th"
        scope="colgroup"
        colSpan={span}
        sx={{
          py: 1,
          px: style.cellPx,
          textAlign: 'left',
          bgcolor: 'action.hover',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Text as="span" size="xs" weight="bold" color="secondary">
          {title.toUpperCase()}
        </Text>
      </Box>
    </Box>
  );
}

function MatrixBody({
  sections,
  tiers,
  copy,
  style,
  sectionTitles,
  shadeCurrent,
}: {
  sections: MatrixSection[];
  tiers: ComparisonTier[];
  copy: ComparisonTableCopy;
  style: MatrixStyle;
  sectionTitles: boolean;
  shadeCurrent: boolean;
}): JSX.Element {
  return (
    <>
      {sections.map((section) => (
        <Box component="tbody" key={section.title}>
          {sectionTitles ? (
            <SectionHeading title={section.title} span={tiers.length + 1} style={style} />
          ) : null}
          {section.rows.map((row) => (
            <Box component="tr" key={row.id} data-testid="plan-matrix-row">
              <Box
                component="th"
                scope="row"
                sx={{
                  py: 1,
                  px: style.cellPx,
                  textAlign: 'left',
                  fontWeight: 'normal',
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  ...labelColumnSx(style),
                }}
              >
                <Text as="span" size="sm">
                  {row.label}
                </Text>
              </Box>
              {tiers.map((tier) => (
                <MatrixCell
                  key={tier.key}
                  line={row.cells.get(tier.key)}
                  copy={copy}
                  style={style}
                  current={shadeCurrent && tier.current}
                />
              ))}
            </Box>
          ))}
        </Box>
      ))}
    </>
  );
}

interface ComparisonMatrixProps {
  tiers: ComparisonTier[];
  /** Built by the caller (`buildMatrix`) so it can decide on emptiness first. */
  sections: MatrixSection[];
  copy: ComparisonTableCopy;
  density?: MatrixDensity;
  /**
   * The words over the tenant's own tier and the offered tier. With a
   * `currentLabel`, the tenant's column is also shaded down its length.
   */
  badges?: TierBadges;
  /** Section heading rows. A dialog showing one section drops them. */
  sectionTitles?: boolean;
  dataTestId?: string;
}

/** The `<table>` itself; the frame around it (border, scroll) is the caller's. */
export function ComparisonMatrix({
  tiers,
  sections,
  copy,
  density = 'full',
  badges = NO_BADGES,
  sectionTitles = true,
  dataTestId,
}: ComparisonMatrixProps): JSX.Element {
  const style = STYLES[density];
  return (
    <Box
      component="table"
      data-testid={dataTestId}
      sx={{ width: '100%', borderCollapse: 'collapse' }}
    >
      <MatrixHead tiers={tiers} copy={copy} style={style} badges={badges} />
      <MatrixBody
        sections={sections}
        tiers={tiers}
        copy={copy}
        style={style}
        sectionTitles={sectionTitles}
        shadeCurrent={badges.currentLabel !== null}
      />
    </Box>
  );
}
