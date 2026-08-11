import { Box, CircularProgress, Paper, Typography, useTheme, type Theme } from '@mui/material';
import React from 'react';

import type { ChartProps } from './Chart.types';
import { ChartContainer } from './ChartComposables';
import { getSizeStyles, getVariantStyles } from './chart-internals';
import { renderChartByType } from './chart-renderers';
import { muiColor } from '../../../tokens/scales';

/**
 * Prop-driven Recharts wrapper (line/bar/area/pie/radar/scatter/composed)
 * with MUI-themed chrome. The serializable-spec API (`SpecChart`) layers on
 * top of this component; type-specific rendering lives in
 * `chart-renderers.tsx` and styling in `chart-internals.ts`.
 */

function variantSx(theme: Theme, props: ChartProps): Record<string, unknown> {
  return getVariantStyles(theme, {
    variant: props.variant ?? 'default',
    color: props.color ?? 'primary',
    glow: props.glow ?? false,
    pulse: props.pulse ?? false,
    glass: props.glass ?? false,
    gradient: props.gradient ?? false,
    disabled: props.disabled ?? false,
  });
}

interface HeaderProps {
  title?: string;
  subtitle?: string;
  neon: boolean;
  dataTestId: string;
}

function ChartHeader({ title, subtitle, neon, dataTestId }: HeaderProps): React.ReactElement | null {
  if (!title && !subtitle) return null;
  return (
    <Box sx={{ mb: 2 }} data-testid={`${dataTestId}-header`}>
      {title && (
        <Typography
          variant="h6"
          data-testid={`${dataTestId}-title`}
          sx={{ color: neon ? '#00ffff' : 'text.primary', fontWeight: 600 }}
        >
          {title}
        </Typography>
      )}
      {subtitle && (
        <Typography
          variant="body2"
          data-testid={`${dataTestId}-subtitle`}
          sx={{ color: neon ? 'rgba(0, 255, 255, 0.7)' : 'text.secondary' }}
        >
          {subtitle}
        </Typography>
      )}
    </Box>
  );
}

export const Chart: React.FC<ChartProps> = (props) => {
  const theme = useTheme();
  const sizeStyles = getSizeStyles(props.size, props.height);
  const styles = variantSx(theme, props);
  const dataTestId = props['data-testid'] ?? 'chart';

  if (props.loading) {
    return (
      <Paper
        data-testid={`${dataTestId}-loading`}
        sx={{ ...styles, ...sizeStyles, display: 'flex', justifyContent: 'center', alignItems: 'center' }}
      >
        <CircularProgress color={muiColor(props.color ?? 'primary', 'inherit')} data-testid={`${dataTestId}-loading-spinner`} />
      </Paper>
    );
  }

  return (
    <Paper
      data-testid={dataTestId}
      className={props.className}
      sx={{ p: 2, ...styles, ...props.style }}
      onFocus={props.onFocus}
      onBlur={props.onBlur}
    >
      <ChartHeader
        title={props.title}
        subtitle={props.subtitle}
        neon={props.variant === 'neon'}
        dataTestId={dataTestId}
      />
      <ChartContainer
        responsive={props.responsive ?? true}
        width={props.width ?? '100%'}
        height={props.fillHeight === true ? '100%' : sizeStyles.height}
        data-testid={`${dataTestId}-container`}
      >
        {renderChartByType(props, theme)}
      </ChartContainer>
    </Paper>
  );
};
