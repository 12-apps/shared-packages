import { Box, Paper, Typography, useTheme } from '@mui/material';
import React from 'react';
import { Legend, ResponsiveContainer, Tooltip } from 'recharts';

/**
 * Raw chart composables (Squire's ChartConfig pattern, MUI-themed): a
 * responsive container plus themed tooltip/legend content renderers. The
 * prop-driven `Chart` uses these internally; consumers building bespoke
 * Recharts compositions can reuse them directly.
 */

/** Recharts' Tooltip/Legend re-exported so bespoke compositions can pair them
 * with the themed content renderers below. */
export const ChartTooltip = Tooltip;
export const ChartLegend = Legend;

export interface ChartContainerProps {
  /**
   * A number of pixels, or a PERCENTAGE of the box this container is given.
   *
   * The difference is not cosmetic: Recharts sizes the chart from the number
   * when it is one and only MEASURES its own box when it is a percentage
   * (`calculateChartDimensions`). So a container stretched by its parent's
   * layout goes on drawing a 300px chart inside a 600px box — visibly, as
   * blank space under the plot — until the height is handed over as a percent.
   */
  height: number | `${number}%`;
  width?: number | string;
  responsive?: boolean;
  children: React.ReactElement;
  'data-testid'?: string;
}

/** Responsive wrapper for a Recharts chart element. */
export const ChartContainer: React.FC<ChartContainerProps> = ({
  height,
  width = '100%',
  responsive = true,
  children,
  'data-testid': dataTestId,
}) => {
  if (!responsive) {
    return (
      <Box sx={{ width, height }} data-testid={dataTestId}>
        {children}
      </Box>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height} data-testid={dataTestId}>
      {children}
    </ResponsiveContainer>
  );
};

interface TooltipEntry {
  name?: string | number;
  value?: string | number;
  color?: string;
}

export interface ChartTooltipContentProps {
  active?: boolean;
  label?: string | number;
  payload?: TooltipEntry[];
  /** Formats numeric values (e.g. centavos → BRL). */
  valueFormatter?: (value: number) => string;
}

/** Theme-aware tooltip content (light/dark correct, semantic colors only). */
export const ChartTooltipContent: React.FC<ChartTooltipContentProps> = ({
  active,
  label,
  payload,
  valueFormatter,
}) => {
  const theme = useTheme();
  if (!active || !payload || payload.length === 0) return null;
  const formatValue = (value: TooltipEntry['value']): string | number => {
    if (typeof value === 'number' && valueFormatter) return valueFormatter(value);
    return value ?? '';
  };
  return (
    <Paper elevation={4} sx={{ px: 1.5, py: 1, border: `1px solid ${theme.palette.divider}` }}>
      {label !== undefined && label !== '' && (
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
          {label}
        </Typography>
      )}
      {payload.map((entry, index) => (
        <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box
            component="span"
            sx={{ width: 10, height: 10, borderRadius: '2px', backgroundColor: entry.color, flexShrink: 0 }}
          />
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {entry.name}
          </Typography>
          <Typography variant="body2" sx={{ ml: 'auto', fontWeight: 600 }}>
            {formatValue(entry.value)}
          </Typography>
        </Box>
      ))}
    </Paper>
  );
};

export interface ChartLegendContentProps {
  payload?: Array<{ value?: string | number; color?: string }>;
}

/** Theme-aware legend content matching the tooltip's swatch styling. */
export const ChartLegendContent: React.FC<ChartLegendContentProps> = ({ payload }) => {
  if (!payload || payload.length === 0) return null;
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 2, pt: 1 }}>
      {payload.map((entry, index) => (
        <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Box
            component="span"
            sx={{ width: 10, height: 10, borderRadius: '2px', backgroundColor: entry.color, flexShrink: 0 }}
          />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {entry.value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
};
