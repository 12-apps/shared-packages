/**
 * How a heat map is laid out at its measured width (FUT-4063): the step and
 * orientation, from what the figures MEASURE in the table's own font, and how
 * many column labels to draw.
 */
import { useTheme, type Theme } from '@mui/material/styles/index.js';
import useMediaQuery from '@mui/material/useMediaQuery/index.js';
import React from 'react';

import { remPx } from '../../../tokens/relative';
import { createTextMeasure, widestText, type TextMeasure } from './heat-map-measure';
import { denseLabelEvery, heatMapFit, type HeatMapFit } from './heat-map-model';
import { HEAT_MAP_METRICS as M } from './HeatMap.metrics';
import type { HeatMapCell, HeatMapLabels, HeatMapProps } from './HeatMap.types';

export const EM_DASH = '—';

/**
 * How the grid is drawn: which way round and at which type step. `'auto'`
 * prefers the transposed grid below the theme's `md`; at any width the fit
 * moves to the compact step, then the dense one, and only then to the other
 * way round, before it would clip a figure.
 */
function useFit(
  transpose: HeatMapProps['transpose'],
  width: number,
  size: { rows: number; columns: number },
  figures: FigureWidths,
): HeatMapFit {
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down('md'), { noSsr: true });
  const fixed = transpose === true || transpose === false;
  const prefer = fixed ? transpose : narrow;
  return heatMapFit(
    width,
    size.rows,
    size.columns,
    {
      labelPx: remPx(theme, M.labelColumn),
      labelTransposedPx: remPx(theme, M.labelColumnTransposed),
      spacingPx: remPx(theme, M.gap),
      minCellPx: Math.max(remPx(theme, M.minCell), figures.regular),
      compactMinCellPx: Math.max(remPx(theme, M.compactMinCell), figures.compact),
      denseLabelPx: remPx(theme, M.denseLabelColumn),
      denseSpacingPx: remPx(theme, M.denseGap),
      denseMinCellPx: figures.dense,
    },
    prefer,
    fixed,
  );
}

/** The widths, in px, the figures need at each type step; `dense` is absent without a shorter figure. */
interface FigureWidths {
  regular: number;
  compact: number;
  dense: number | undefined;
}

const UNMEASURED: FigureWidths = { regular: 0, compact: 0, dense: undefined };

/** The widest of `format(value)` over the drawn cells and the empty dash, bold, plus the margin. */
function widestFigure(
  cells: readonly HeatMapCell[],
  dash: string,
  format: (value: number) => string,
  measure: TextMeasure,
  theme: Theme,
  fontSize: number,
): number {
  const texts = new Set<string>([dash]);
  for (const cell of cells) if (cell.value !== null) texts.add(format(cell.value));
  const bold = theme.typography.fontWeightBold as number;
  return widestText([...texts], measure, remPx(theme, fontSize), bold) + remPx(theme, M.figureMargin);
}

/**
 * What the figures MEASURE at each step, in the table's own font, bold (an
 * attention cell): a step is only taken where its widest figure fits the cell,
 * so no figure is ever clipped. The dense step exists only when the host gave
 * a shorter figure; without one the grid falls back as it always did.
 */
function figureWidths(
  cells: readonly HeatMapCell[],
  labels: HeatMapLabels,
  formatValue: (value: number) => string,
  formatValueDense: ((value: number) => string) | undefined,
  measure: TextMeasure,
  theme: Theme,
): FigureWidths {
  const dash = labels.emptyValue ?? EM_DASH;
  return {
    regular: widestFigure(cells, dash, formatValue, measure, theme, M.fontSize),
    compact: widestFigure(cells, dash, formatValue, measure, theme, M.compactFontSize),
    dense: formatValueDense ? widestFigure(cells, dash, formatValueDense, measure, theme, M.denseFontSize) : undefined,
  };
}

export interface LayoutInput {
  ref: React.RefObject<HTMLDivElement | null>;
  containerPx: number;
  transpose: HeatMapProps['transpose'];
  formatValue: (value: number) => string;
  formatValueDense: ((value: number) => string) | undefined;
}

/**
 * How the grid is drawn at the measured width: the step and orientation (from
 * what the figures MEASURE in the table's own font) and how many column labels
 * to draw (all, while they fit a column's pitch). Nothing is measured until
 * the container has a width: the fit keeps its preference then.
 */
export function useHeatMapLayout(
  { ref, containerPx: width, transpose, formatValue, formatValueDense }: LayoutInput,
  data: Pick<HeatMapProps, 'rows' | 'columns' | 'cells' | 'labels'>,
): { fit: HeatMapFit; labelEvery: number } {
  const theme = useTheme();
  const element = ref.current;
  const measure = React.useMemo(() => createTextMeasure(element), [element, width]);
  const figures =
    width > 0 ? figureWidths(data.cells, data.labels, formatValue, formatValueDense, measure, theme) : UNMEASURED;
  const fit = useFit(transpose, width, { rows: data.rows.length, columns: data.columns.length }, figures);
  const labelEvery = fit.dense
    ? denseLabelEvery(width, data.columns.length, {
        labelPx: remPx(theme, M.denseLabelColumn),
        spacingPx: remPx(theme, M.denseGap),
        labelTextPx: widestText(
          data.columns.map((column) => column.label),
          measure,
          remPx(theme, M.denseFontSize),
          theme.typography.fontWeightMedium as number,
        ),
        gapPx: remPx(theme, M.denseLabelGap),
      })
    : 1;
  return { fit, labelEvery };
}

