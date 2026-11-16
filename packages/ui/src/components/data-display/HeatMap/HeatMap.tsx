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
import {
  denseLabelSx,
  headerCellSx,
  rowHeaderSx,
  SR_ONLY_SX,
  swatchSx,
  tableSx,
  unmeasuredRingSx,
  valueCellSx,
} from './HeatMap.styles';
import type { HeatMapAxisItem, HeatMapCell, HeatMapLabels, HeatMapProps, HeatMapScale } from './HeatMap.types';

const EM_DASH = '—';

/**
 * How the grid is drawn: which way round and at which type step. `'auto'`
 * prefers the transposed grid below the theme's `md`; at any width the fit
 * moves to the compact step, then the dense one, and only then to the other
 * way round, before it would clip a figure.
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
      denseLabelPx: remPx(theme, M.denseLabelColumn),
      denseSpacingPx: remPx(theme, M.denseGap),
      denseMinCellPx: remPx(theme, M.denseMinCell),
    },
    prefer,
    fixed,
  );
}

/** The row-label column's width at a step. */
function columnWidth({ transposed, dense }: HeatMapFit): number {
  if (dense) return M.denseLabelColumn;
  return transposed ? M.labelColumnTransposed : M.labelColumn;
}

/**
 * A column's label. At the dense step only every Nth is drawn; the others are
 * still READ (visually hidden), so each column keeps its name for a screen
 * reader and a script.
 */
function ColumnLabel({ label, drawn, dense }: { label: string; drawn: boolean; dense: boolean }): React.JSX.Element {
  if (!drawn) return <Box component="span" sx={SR_ONLY_SX}>{label}</Box>;
  return dense ? <Box component="span" sx={denseLabelSx}>{label}</Box> : <>{label}</>;
}

/** The column headers: every label drawn, or at the dense step every Nth. */
function HeaderRow({ fit, columns }: { fit: HeatMapFit; columns: readonly HeatMapAxisItem[] }): React.JSX.Element {
  return (
    <tr>
      <Box component="td" sx={headerCellSx(fit)} />
      {columns.map((column, index) => (
        <Box component="th" scope="col" key={column.key} sx={headerCellSx(fit)}>
          <ColumnLabel label={column.label} drawn={!fit.dense || index % M.denseLabelEvery === 0} dense={fit.dense} />
        </Box>
      ))}
    </tr>
  );
}

interface ValueCellProps {
  fit: HeatMapFit;
  cell: HeatMapCell | undefined;
  scale: HeatMapScale;
  labels: HeatMapLabels;
  formatValue: (value: number) => string;
  formatValueDense: ((value: number) => string) | undefined;
  testId: string;
}

/**
 * The words a no-figure cell reads: `empty`'s, or — for a cell whose measure
 * was never taken — `unmeasured`'s, and nothing at all rather than `empty`'s
 * when the host gave none (they would say "no sale" of an hour that sold).
 */
function emptyReason(cell: HeatMapCell, labels: HeatMapLabels): string | undefined {
  return cell.reason === 'unmeasured' ? labels.unmeasured : labels.empty;
}

/** Whether a cell is drawn as unmeasured: no figure, for that reason. */
function isUnmeasured(cell: HeatMapCell): boolean {
  return cell.value === null && cell.reason === 'unmeasured';
}

/**
 * The words a cell reads after its figure, visually hidden: the attention
 * side's, or a no-figure cell's reason.
 */
function hiddenWords(tone: ReturnType<typeof heatMapTone>, cell: HeatMapCell, labels: HeatMapLabels): string | undefined {
  if (isAboveTone(tone)) return labels.above;
  return tone === 'empty' ? emptyReason(cell, labels) : undefined;
}

/** The figure drawn at the dense step: the host's shorter one, else the full text. */
function denseText(
  fit: HeatMapFit,
  cell: HeatMapCell,
  text: string,
  formatValueDense: ((value: number) => string) | undefined,
): string {
  return fit.dense && cell.value !== null && formatValueDense ? formatValueDense(cell.value) : text;
}

/** A shorter figure is drawn but never read: the full text is visually hidden beside it. */
function Figure({ text, shortText }: { text: string; shortText: string }): React.JSX.Element {
  if (shortText === text) return <>{text}</>;
  return (
    <>
      <span aria-hidden="true">{shortText}</span>
      <Box component="span" sx={SR_ONLY_SX}>
        {text}
      </Box>
    </>
  );
}

/** One figure cell: blank, "—", or the figure on its side's tint. */
function ValueCell({ fit, cell, scale, labels, formatValue, formatValueDense, testId }: ValueCellProps): React.JSX.Element {
  const theme = useTheme();
  const cellSx = valueCellSx(fit, fit.transposed);
  if (!cell) {
    return <Box component="td" sx={cellSx} data-testid={testId} data-tone="blank" />;
  }
  const tone = heatMapTone(cell.value, scale);
  const above = isAboveTone(tone);
  const text = cell.value === null ? (labels.emptyValue ?? EM_DASH) : formatValue(cell.value);
  const shortText = denseText(fit, cell, text, formatValueDense);
  const words = hiddenWords(tone, cell, labels);
  const unmeasured = isUnmeasured(cell);
  return (
    <Box
      component="td"
      sx={{
        ...cellSx,
        ...heatMapToneColors(tone, theme),
        ...(above ? { fontWeight: 'fontWeightBold' } : {}),
        ...(unmeasured ? unmeasuredRingSx : {}),
      }}
      data-testid={testId}
      data-tone={tone}
      {...(unmeasured ? { 'data-reason': 'unmeasured' } : {})}
    >
      <Figure text={text} shortText={shortText} />
      {words ? (
        <Box component="span" sx={SR_ONLY_SX}>
          {` ${words}`}
        </Box>
      ) : null}
    </Box>
  );
}

/** The legend: both sides and the "—", each with its own words (never colour alone). */
function Legend({
  labels,
  unmeasured,
  testId,
}: {
  labels: HeatMapLabels;
  /** Whether any drawn cell is unmeasured: its words join the legend only then. */
  unmeasured: boolean;
  testId: string;
}): React.JSX.Element {
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
      {unmeasured && labels.unmeasured ? (
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
          <Box
            component="span"
            sx={[
              swatchSx,
              unmeasuredRingSx,
              { outlineOffset: 0, backgroundColor: heatMapToneColors('empty', theme).backgroundColor },
            ]}
          />
          <Typography variant="caption" sx={{ color: 'text.secondary' }} data-testid={`${testId}-legend-unmeasured`}>
            {`${labels.emptyValue ?? EM_DASH} ${labels.unmeasured}`}
          </Typography>
        </Box>
      ) : null}
    </Box>
  );
}

export function HeatMap({
  rows,
  columns,
  cells,
  scale,
  formatValue,
  formatValueDense,
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
  const { transposed, compact, dense } = fit;
  const grid = heatMapGrid(rows, columns, cells, transposed);
  return (
    <Box
      ref={ref}
      className={className}
      data-testid={dataTestId}
      data-transposed={transposed ? 'true' : 'false'}
      data-compact={compact ? 'true' : 'false'}
      data-dense={dense ? 'true' : 'false'}
    >
      <Box component="table" sx={tableSx(dense)} data-testid={`${dataTestId}-table`}>
        {caption ? (
          <Box component="caption" sx={SR_ONLY_SX}>
            {caption}
          </Box>
        ) : null}
        <colgroup>
          <Box component="col" sx={{ width: sxRem(columnWidth(fit)) }} />
        </colgroup>
        <thead>
          <HeaderRow fit={fit} columns={grid.columns} />
        </thead>
        <tbody>
          {grid.rows.map((row) => (
            <tr key={row.key}>
              <Box component="th" scope="row" sx={rowHeaderSx(fit)}>
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
                  formatValueDense={formatValueDense}
                  // Named in the DATA's orientation, so a script finds the same
                  // cell whichever way the grid is drawn.
                  testId={`${dataTestId}-cell-${transposed ? column.key : row.key}-${transposed ? row.key : column.key}`}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </Box>
      {legend ? <Legend labels={labels} unmeasured={cells.some(isUnmeasured)} testId={dataTestId} /> : null}
    </Box>
  );
}
