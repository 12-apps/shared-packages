import { useTheme } from '@mui/material/styles/index.js';
import React from 'react';

import { Chart } from './Chart';
import type { ChartDataPoint } from './Chart.types';
import type { ChartSemanticColor, ChartSpec } from './ChartSpec.types';
import { CHART_SEMANTIC_COLORS, specToChartProps } from './chart-spec';
import { accentFor } from '../../../tokens/scales';

export interface SpecChartProps {
  /** Validated spec — parse untrusted JSON with `parseChartSpec` first. */
  spec: ChartSpec;
  data: ChartDataPoint[];
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /** Take the height of the box this chart is placed in — see `ChartProps`. */
  fillHeight?: boolean;
  loading?: boolean;
  className?: string;
  onClick?: (point: ChartDataPoint) => void;
  'data-testid'?: string;
}

/**
 * Renders a chart from a JSON-serializable {@link ChartSpec} plus plain data
 * rows. Layered over the prop-driven `Chart` (one implementation); semantic
 * color tokens resolve against the active MUI theme at render time.
 */
export const SpecChart: React.FC<SpecChartProps> = ({
  spec,
  data,
  size,
  fillHeight,
  loading,
  className,
  onClick,
  'data-testid': dataTestId = 'spec-chart',
}) => {
  const theme = useTheme();
  const chartProps = React.useMemo(() => {
    const scheme: readonly ChartSemanticColor[] =
      spec.colorScheme && spec.colorScheme.length > 0 ? spec.colorScheme : CHART_SEMANTIC_COLORS;
    const resolveColor = (token: ChartSemanticColor | undefined, index: number): string =>
      accentFor(theme, token ?? scheme[index % scheme.length] ?? 'primary').main;
    return specToChartProps(spec, data, { resolveColor });
  }, [spec, data, theme]);

  return (
    <Chart
      {...chartProps}
      size={size}
      fillHeight={fillHeight}
      loading={loading}
      className={className}
      onClick={onClick}
      data-testid={dataTestId}
    />
  );
};
