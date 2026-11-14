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

import { sxRem } from '../../../tokens/relative';
import { heatMapGrid, heatMapTone, isAboveTone } from './heat-map-model';
import {
  headerCellSx,
  rowHeaderSx,
  SR_ONLY_SX,
  swatchSx,
  tableSx,
  toneSx,
  valueCellSx,
} from './HeatMap.styles';
import type { HeatMapCell, HeatMapLabels, HeatMapProps, HeatMapScale } from './HeatMap.types';

const EM_DASH = '—';

/** Whether the grid is drawn transposed: a fixed answer, or the theme's `md` for `'auto'`. */
function useTransposed(transpose: HeatMapProps['transpose']): boolean {
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down('md'), { noSsr: true });
  if (transpose === undefined || transpose === 'auto') return narrow;
  return transpose;
}

interface ValueCellProps {
  cell: HeatMapCell | undefined;
  scale: HeatMapScale;
  labels: HeatMapLabels;
  formatValue: (value: number) => string;
  testId: string;
}

/** One figure cell: blank, "—", or the figure on its side's tint. */
function ValueCell({ cell, scale, labels, formatValue, testId }: ValueCellProps): React.JSX.Element {
  const theme = useTheme();
  if (!cell) {
    return <Box component="td" sx={valueCellSx} data-testid={testId} data-tone="blank" />;
  }
  const tone = heatMapTone(cell.value, scale);
  const above = isAboveTone(tone);
  const text = cell.value === null ? (labels.emptyValue ?? EM_DASH) : formatValue(cell.value);
  return (
    <Box
      component="td"
      sx={[valueCellSx, toneSx(tone, theme), above ? { fontWeight: 'fontWeightBold' } : {}]}
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
    { key: 'below', swatch: toneSx('below', theme), text: labels.below, bold: false },
    { key: 'above', swatch: toneSx('above', theme), text: labels.above, bold: true },
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
  const transposed = useTransposed(transpose);
  const grid = heatMapGrid(rows, columns, cells, transposed);
  return (
    <Box className={className} data-testid={dataTestId} data-transposed={transposed ? 'true' : 'false'}>
      <Box component="table" sx={tableSx} data-testid={`${dataTestId}-table`}>
        {caption ? (
          <Box component="caption" sx={SR_ONLY_SX}>
            {caption}
          </Box>
        ) : null}
        <colgroup>
          <Box component="col" sx={{ width: sxRem(transposed ? 36 : 44) }} />
        </colgroup>
        <thead>
          <tr>
            <Box component="td" sx={headerCellSx} />
            {grid.columns.map((column) => (
              <Box component="th" scope="col" key={column.key} sx={headerCellSx}>
                {column.label}
              </Box>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row) => (
            <tr key={row.key}>
              <Box component="th" scope="row" sx={rowHeaderSx}>
                {row.label}
              </Box>
              {grid.columns.map((column) => (
                <ValueCell
                  key={column.key}
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
