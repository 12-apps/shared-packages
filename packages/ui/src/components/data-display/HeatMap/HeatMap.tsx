/**
 * A diverging heat map around a target, drawn as a real `<table>`.
 *
 * Table-structured on purpose: every cell is named by its row and column
 * headers, so a screen reader hears "Ter, 15h, 54% acima da meta" rather than a
 * run of percentages, and a script finds a cell by role and name. The sides are
 * never colour alone: an attention cell is also BOLD and carries its side's word
 * (visually hidden in the cell, visible in the legend).
 */
import Box from '@mui/material/Box/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import Typography from '@mui/material/Typography/index.js';
import useMediaQuery from '@mui/material/useMediaQuery/index.js';
import React from 'react';

import { remPx, sxRem } from '../../../tokens/relative';
import { useMeasuredWidth } from '../../utility/Overflow/overflow';
import { heatMapToneColors } from './heat-map-colors';
import { heatMapFit, heatMapGrid, heatMapTone, isAboveTone, type HeatMapFit } from './heat-map-model';
import { HEAT_MAP_METRICS as M } from './HeatMap.metrics';
import { headerCellSx, rowHeaderSx, SR_ONLY_SX, swatchSx, tableSx, valueCellSx } from './HeatMap.styles';
import type { HeatMapCell, HeatMapLabels, HeatMapProps, HeatMapScale } from './HeatMap.types';

const EM_DASH = '—';

/**
 * How the grid is drawn: which way round and at which type step. `'auto'`
 * prefers the transposed grid below the theme's `md`; at any width the fit
 * moves to the compact step, then to the other way round, before it would clip
 * a figure.
 */
function useFit(transpose: HeatMapProps['transpose'], width: number, rows: number, columns: number): HeatMapFit {
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down('md'), { noSsr: true });
  const fixed = transpose === true || transpose === false;
  const prefer = fixed ? transpose : narrow;
  return heatMapFit(
    width,
    rows,
    columns,
    {
      labelPx: remPx(theme, M.labelColumn),
      labelTransposedPx: remPx(theme, M.labelColumnTransposed),
      spacingPx: remPx(theme, M.gap),
      minCellPx: remPx(theme, M.minCell),
      compactMinCellPx: remPx(theme, M.compactMinCell),
    },
    prefer,
    fixed,
  );
}

interface ValueCellProps {
  fit: HeatMapFit;
  cell: HeatMapCell | undefined;
  scale: HeatMapScale;
  labels: HeatMapLabels;
  formatValue: (value: number) => string;
  testId: string;
}

/** One figure cell: blank, "—", or the figure on its side's tint. */
function ValueCell({ fit, cell, scale, labels, formatValue, testId }: ValueCellProps): React.JSX.Element {
  const theme = useTheme();
  const cellSx = valueCellSx(fit.compact, fit.transposed);
  if (!cell) {
    return <Box component="td" sx={cellSx} data-testid={testId} data-tone="blank" />;
  }
  const tone = heatMapTone(cell.value, scale);
  const above = isAboveTone(tone);
  const text = cell.value === null ? (labels.emptyValue ?? EM_DASH) : formatValue(cell.value);
  return (
    <Box
      component="td"
      sx={{ ...cellSx, ...heatMapToneColors(tone, theme), ...(above ? { fontWeight: 'fontWeightBold' } : {}) }}
      data-testid={testId}
      data-tone={tone}
    >
      {text}
      {above ? (
        <Box component="span" sx={SR_ONLY_SX}>
          {` ${labels.above}`}
        </Box>
      ) : null}
      {tone === 'empty' ? (
        <Box component="span" sx={SR_ONLY_SX}>
          {` ${labels.empty}`}
        </Box>
      ) : null}
    </Box>
  );
}

/** The legend: both sides and the "—", each with its own words (never colour alone). */
function Legend({ labels, testId }: { labels: HeatMapLabels; testId: string }): React.JSX.Element {
  const theme = useTheme();
  const items = [
    { key: 'below', swatch: heatMapToneColors('below', theme), text: labels.below, bold: false },
    { key: 'above', swatch: heatMapToneColors('above', theme), text: labels.above, bold: true },
  ];
  return (
    <Box
      aria-hidden="true"
      data-testid={`${testId}-legend`}
      sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2, rowGap: 0.5, mt: 1 }}
    >
      {items.map((item) => (
        <Box key={item.key} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
          <Box component="span" sx={[swatchSx, { backgroundColor: item.swatch.backgroundColor }]} />
          <Typography
            variant="caption"
            sx={{ color: 'text.secondary', fontWeight: item.bold ? 'fontWeightBold' : undefined }}
          >
            {item.text}
          </Typography>
        </Box>
      ))}
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {`${labels.emptyValue ?? EM_DASH} ${labels.empty}`}
      </Typography>
    </Box>
  );
}

export function HeatMap({
  rows,
  columns,
  cells,
  scale,
  formatValue,
  labels,
  caption,
  transpose = 'auto',
  legend = true,
  className,
  dataTestId = 'heat-map',
}: HeatMapProps): React.JSX.Element {
  const { ref, width } = useMeasuredWidth<HTMLDivElement>();
  // The first measurement is read in a LAYOUT effect, before the browser
  // paints, so the grid never flashes its unmeasured (wide) arrangement for a
  // frame; the observer above keeps it current after that.
  const [firstWidth, setFirstWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    if (ref.current) setFirstWidth(ref.current.getBoundingClientRect().width);
  }, [ref]);
  const fit = useFit(transpose, width || firstWidth, rows.length, columns.length);
  const { transposed, compact } = fit;
  const grid = heatMapGrid(rows, columns, cells, transposed);
  return (
    <Box
      ref={ref}
      className={className}
      data-testid={dataTestId}
      data-transposed={transposed ? 'true' : 'false'}
      data-compact={compact ? 'true' : 'false'}
    >
      <Box component="table" sx={tableSx} data-testid={`${dataTestId}-table`}>
        {caption ? (
          <Box component="caption" sx={SR_ONLY_SX}>
            {caption}
          </Box>
        ) : null}
        <colgroup>
          <Box component="col" sx={{ width: sxRem(transposed ? M.labelColumnTransposed : M.labelColumn) }} />
        </colgroup>
        <thead>
          <tr>
            <Box component="td" sx={headerCellSx(compact)} />
            {grid.columns.map((column) => (
              <Box component="th" scope="col" key={column.key} sx={headerCellSx(compact)}>
                {column.label}
              </Box>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row) => (
            <tr key={row.key}>
              <Box component="th" scope="row" sx={rowHeaderSx(compact)}>
                {row.label}
              </Box>
              {grid.columns.map((column) => (
                <ValueCell
                  key={column.key}
                  fit={fit}
                  cell={grid.cellAt(row.key, column.key)}
                  scale={scale}
                  labels={labels}
                  formatValue={formatValue}
                  // Named in the DATA's orientation, so a script finds the same
                  // cell whichever way the grid is drawn.
                  testId={`${dataTestId}-cell-${transposed ? column.key : row.key}-${transposed ? row.key : column.key}`}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </Box>
      {legend ? <Legend labels={labels} testId={dataTestId} /> : null}
    </Box>
  );
}
