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
 * that scroll sideways under five tiers on a phone. `compact` is a dialog's:
 * a handful of rows across three or four tiers that must FIT at 320 px with
 * no sideways scroll — narrow fixed tier columns, the label column taking
 * what is left and wrapping.
 */
import type { JSX } from 'react';

import { Box } from '@12-apps/ui/mui/Box';
import { Text } from '@12-apps/ui/typography/Text';

import type { ComparisonLine, ComparisonTier } from '../plan-wire';
import type { MatrixSection } from './comparison-rows';
import type { ComparisonTableCopy } from './copy';
import { IncludedMark } from './marks';

export type MatrixDensity = 'full' | 'compact';

interface MatrixStyle {
  cellPx: number;
  labelMinWidth: number | undefined;
  /** `'1%'` shrinks a tier column to its own content; the label takes the rest. */
  tierWidth: string | undefined;
  tierMinWidth: number | undefined;
  stickyLabel: boolean;
  detailSize: 'xs' | 'sm';
}

const STYLES: Record<MatrixDensity, MatrixStyle> = {
  // Sticky so the row label survives the horizontal scroll a five-column
  // table needs on anything narrower than a laptop.
  full: {
    cellPx: 1.5,
    labelMinWidth: 220,
    tierWidth: undefined,
    tierMinWidth: 110,
    stickyLabel: true,
    detailSize: 'sm',
  },
  // Each tier column shrinks to its own name (never broken mid-word), at least
  // a mark's width plus air, and the label column takes what is left and
  // wraps: three tiers leave ~110 px of label at a 320 px viewport inside a
  // dense dialog, with no sideways scroll. That is the budget this density is
  // built against.
  compact: {
    cellPx: 1,
    labelMinWidth: undefined,
    tierWidth: '1%',
    tierMinWidth: 48,
    stickyLabel: false,
    detailSize: 'xs',
  },
};

function labelColumnSx(style: MatrixStyle): Record<string, unknown> {
  return style.stickyLabel
    ? { position: 'sticky', left: 0, bgcolor: 'background.paper' }
    : { overflowWrap: 'break-word' };
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
  const included = line?.included ?? false;
  const detail = included ? line?.detail ?? null : null;
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
      {detail === null ? (
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <IncludedMark included={included} label={included ? copy.included : copy.excluded} />
        </Box>
      ) : (
        <Text as="span" size={style.detailSize}>
          {detail}
        </Text>
      )}
    </Box>
  );
}

function TierHead({
  tier,
  style,
  currentLabel,
}: {
  tier: ComparisonTier;
  style: MatrixStyle;
  currentLabel: string | null;
}): JSX.Element {
  const marked = tier.current && currentLabel !== null;
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
        verticalAlign: 'bottom',
        borderBottom: '2px solid',
        borderColor: tier.current ? 'primary.main' : 'divider',
        width: style.tierWidth,
        minWidth: style.tierMinWidth,
        whiteSpace: style.tierWidth === undefined ? undefined : 'nowrap',
        bgcolor: marked ? 'action.hover' : undefined,
      }}
    >
      {marked ? (
        <Text as="div" size="xs" weight="bold" color="primary" data-testid="plan-matrix-current">
          {currentLabel}
        </Text>
      ) : null}
      <Text as="span" size="sm" weight="bold">
        {tier.name}
      </Text>
    </Box>
  );
}

function MatrixHead({
  tiers,
  copy,
  style,
  currentLabel,
}: {
  tiers: ComparisonTier[];
  copy: ComparisonTableCopy;
  style: MatrixStyle;
  currentLabel: string | null;
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
            verticalAlign: 'bottom',
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
          <TierHead key={tier.key} tier={tier} style={style} currentLabel={currentLabel} />
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

export interface ComparisonMatrixProps {
  tiers: ComparisonTier[];
  /** Built by the caller (`buildMatrix`) so it can decide on emptiness first. */
  sections: MatrixSection[];
  copy: ComparisonTableCopy;
  density?: MatrixDensity;
  /**
   * The words over the tenant's own tier column, or null for the border
   * alone. When given, the column is also shaded down its length.
   */
  currentLabel?: string | null;
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
  currentLabel = null,
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
      <MatrixHead tiers={tiers} copy={copy} style={style} currentLabel={currentLabel} />
      <MatrixBody
        sections={sections}
        tiers={tiers}
        copy={copy}
        style={style}
        sectionTitles={sectionTitles}
        shadeCurrent={currentLabel !== null}
      />
    </Box>
  );
}
