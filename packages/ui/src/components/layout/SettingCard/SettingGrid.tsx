import Box from '@mui/material/Box/index.js';
import { useTheme, type CSSObject, type Theme } from '@mui/material/styles/index.js';
import { forwardRef } from 'react';

import { rem } from '../../../tokens/relative';

import { SETTING_CARD, SETTING_GRID_GAP_UNITS } from './SettingCard.metrics';
import { partTestId } from './SettingCard.parts';
import { SETTING_CARD_OPEN_ATTR, withCallerSx } from './SettingCard.styles';
import type { SettingGridColumns, SettingGridProps } from './SettingCard.types';

/** The container the grid's own queries are asked of. Named, so a nested grid answers to its own. */
export const SETTING_GRID_CONTAINER = 'setting-grid';

/** The track list for `n` equal columns. `minmax(0, …)` so a long word cannot widen its column. */
const tracks = (n: SettingGridColumns): string => `repeat(${n}, minmax(0, 1fr))`;

/**
 * The narrowest the container can be and still fit `n` columns of
 * `minColumnWidth` with the gaps between them. A `calc()` because the gap is a
 * spacing unit and the width a type-scale length: two scales, one sum.
 */
const threshold = (theme: Theme, n: number, minColumnPx: number, gapUnits: number): string =>
  `calc(${n} * ${rem(theme, minColumnPx)} + ${n - 1} * ${theme.spacing(gapUnits)})`;

/**
 * The grid itself.
 *
 * - Columns come from CONTAINER queries, not viewport ones: a settings grid
 *   lives beside a rail, inside a drawer, in half a split view, and the
 *   viewport says nothing about how wide any of those are.
 * - `grid-auto-rows: auto` with `align-items: stretch` is the equal-height
 *   rule: each row is as tall as its tallest card and every card in it
 *   stretches to match. Not `1fr` rows — those would make EVERY row as tall as
 *   the tallest, so one open card would inflate the whole page.
 * - An open card spans the row. The card sets `grid-column` on itself; the
 *   `:has()` rule covers a card the host wrapped in an element of its own.
 */
export interface SettingGridLayout {
  /** The narrowest column, in DESIGN px (drawn through `rem`). */
  minColumnPx: number;
  maxColumns: SettingGridColumns;
  /** The gap, in theme SPACING units. */
  gapUnits: number;
}

export function settingGridStyles(theme: Theme, { minColumnPx, maxColumns, gapUnits }: SettingGridLayout): CSSObject {
  const styles: CSSObject = {
    display: 'grid',
    gap: theme.spacing(gapUnits),
    gridTemplateColumns: tracks(1),
    gridAutoRows: 'auto',
    alignItems: 'stretch',
    [`& > [${SETTING_CARD_OPEN_ATTR}], & > :has([${SETTING_CARD_OPEN_ATTR}])`]: { gridColumn: '1 / -1' },
  };
  for (const n of [2, 3] as const) {
    if (n > maxColumns) break;
    styles[`@container ${SETTING_GRID_CONTAINER} (min-width: ${threshold(theme, n, minColumnPx, gapUnits)})`] = {
      gridTemplateColumns: tracks(n),
    };
  }
  return styles;
}

/**
 * Lays setting cards out in one, two or three columns by the width it is
 * GIVEN — see {@link settingGridStyles}. Two elements, because a container
 * query is answered by an ANCESTOR: the outer one is the container, the inner
 * one the grid.
 */
export const SettingGrid = forwardRef<HTMLDivElement, SettingGridProps>(function SettingGrid(props, ref) {
  const {
    children,
    minColumnWidth = SETTING_CARD.gridMinColumnWidth,
    maxColumns = 3,
    gap = SETTING_GRID_GAP_UNITS,
    'aria-label': ariaLabel,
    dataTestId,
    className,
    sx,
  } = props;
  const theme = useTheme();
  const gridStyles = settingGridStyles(theme, { minColumnPx: minColumnWidth, maxColumns, gapUnits: gap });

  return (
    <Box
      ref={ref}
      role={ariaLabel ? 'region' : undefined}
      aria-label={ariaLabel}
      data-testid={dataTestId}
      className={className}
      sx={withCallerSx({ containerType: 'inline-size', containerName: SETTING_GRID_CONTAINER, minWidth: 0 }, sx)}
    >
      <Box
        sx={gridStyles}
        data-max-columns={maxColumns}
        data-testid={partTestId(dataTestId, 'grid')}
      >
        {children}
      </Box>
    </Box>
  );
});

SettingGrid.displayName = 'SettingGrid';
