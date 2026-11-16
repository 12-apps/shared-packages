/**
 * A stacked share bar (FUT-145): one horizontal 100% bar of parts, each with
 * its percent where it fits, and under it the same parts as a list — swatch,
 * name, percent and, when asked, the figure.
 *
 * The LIST is what assistive tech reads (the bar is `aria-hidden`), and what a
 * reader with no colour vision reads too: it is in the bar's order, and every
 * part is named in words. Nothing is ever clipped: a percent that would not fit
 * its segment is not drawn there, and the list's rows wrap rather than cut.
 */
import Box from '@mui/material/Box/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import Typography from '@mui/material/Typography/index.js';
import React from 'react';

import { remPx, sxRem } from '../../../tokens/relative';
import { useMeasuredWidth } from '../../utility/Overflow/overflow';
import { readableInk } from '../HeatMap/heat-map-colors';
import { shareBarPalette } from './share-bar-colors';
import { fitsInline, shareBarParts, type ShareBarPart } from './share-bar-model';
import { SHARE_BAR_METRICS } from './ShareBar.metrics';
import type { ShareBarProps } from './ShareBar.types';

const M = SHARE_BAR_METRICS;

const wholePercent = (percent: number): string => `${percent}%`;

function Segment({
  part,
  color,
  text,
  showText,
  testId,
}: {
  part: ShareBarPart;
  color: string;
  text: string;
  showText: boolean;
  testId: string;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Box
      data-testid={testId}
      data-share={part.share.toFixed(4)}
      sx={{
        flex: `${part.share} 1 0`,
        minWidth: 0,
        bgcolor: color,
        color: readableInk(theme, color, []),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: sxRem(M.fontSize),
        fontWeight: theme.typography.fontWeightMedium,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
      }}
    >
      {showText ? <span data-share-inline="">{text}</span> : null}
    </Box>
  );
}

/** The parts as a named list: what assistive tech reads, in the bar's order. */
function ShareBarList({
  parts,
  label,
  colorOf,
  formatPercent,
  formatValue,
  dataTestId,
}: {
  parts: ShareBarPart[];
  label: string;
  colorOf: (index: number) => string;
  formatPercent: (percent: number) => string;
  formatValue?: (value: number) => string;
  dataTestId: string;
}): React.JSX.Element {
  return (
    <Box
      component="ul"
      aria-label={label}
      data-testid={`${dataTestId}-list`}
      sx={{ listStyle: 'none', m: 0, p: 0, mt: 1, display: 'flex', flexWrap: 'wrap', columnGap: 2, rowGap: 0.5 }}
    >
      {parts.map((part, index) => (
        <Box
          component="li"
          key={part.key}
          data-testid={`${dataTestId}-item-${part.key}`}
          sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, overflowWrap: 'anywhere' }}
        >
          <Box
            component="span"
            aria-hidden="true"
            sx={{ width: sxRem(M.swatch), height: sxRem(M.swatch), borderRadius: sxRem(M.swatchRadius), bgcolor: colorOf(index), flexShrink: 0 }}
          />
          <Typography variant="body2" component="span" sx={{ color: 'text.secondary' }}>
            {part.label}
          </Typography>
          <Typography variant="body2" component="span" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {formatPercent(part.percent)}
          </Typography>
          {formatValue ? (
            <Typography variant="body2" component="span" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
              {formatValue(part.value)}
            </Typography>
          ) : null}
        </Box>
      ))}
    </Box>
  );
}

export function ShareBar({
  segments,
  label,
  formatPercent = wholePercent,
  formatValue,
  height = M.height,
  inlinePercent = true,
  className,
  dataTestId = 'share-bar',
}: ShareBarProps): React.JSX.Element {
  const theme = useTheme();
  const { ref, width } = useMeasuredWidth<HTMLDivElement>();
  const palette = shareBarPalette(theme);
  const parts = shareBarParts(segments);
  const drawn = parts.filter((part) => part.share > 0);
  const gaps = Math.max(0, drawn.length - 1) * remPx(theme, M.gap);
  const colorOf = (index: number): string =>
    segments[index]?.color ?? palette[index % palette.length] ?? theme.palette.info.main;
  return (
    <Box className={className} data-testid={dataTestId}>
      <Box
        ref={ref}
        aria-hidden="true"
        data-testid={`${dataTestId}-bar`}
        sx={{
          display: 'flex',
          gap: sxRem(M.gap),
          height: sxRem(height),
          borderRadius: sxRem(M.radius),
          overflow: 'hidden',
          bgcolor: 'action.disabledBackground',
        }}
      >
        {parts.map((part, index) =>
          part.share > 0 ? (
            <Segment
              key={part.key}
              part={part}
              color={colorOf(index)}
              text={formatPercent(part.percent)}
              showText={
                inlinePercent &&
                width > 0 &&
                fitsInline(
                  (width - gaps) * part.share,
                  formatPercent(part.percent),
                  remPx(theme, M.fontSize),
                  remPx(theme, M.padding),
                )
              }
              testId={`${dataTestId}-segment-${part.key}`}
            />
          ) : null,
        )}
      </Box>
      <ShareBarList parts={parts} label={label} colorOf={colorOf} formatPercent={formatPercent} formatValue={formatValue} dataTestId={dataTestId} />
    </Box>
  );
}
