import type { Theme } from '@mui/material/styles/index.js';
import type { CSSProperties } from 'react';

import type { ChartDataPoint, ChartProps, ChartSeries } from './Chart.types';
import { resolveAxisConfig, resolveBarGeometry, type BarGeometry, type CartesianAxisConfig } from './chart-axis';
import {
  getAxisStyles,
  getDefaultColors,
  getSizeStyles,
  resolveSeries,
  type SizeStyles,
} from './chart-internals';

/**
 * Everything the per-type renderers in `chart-renderers.tsx` read, resolved
 * once from props + theme. Kept out of that file so each renderer is a small
 * JSX function over already-decided values — palette, series, axis geometry,
 * bar geometry — rather than a place where those decisions get made again
 * slightly differently.
 */
export interface ChartRenderContext {
  props: ChartProps;
  theme: Theme;
  sizeStyles: SizeStyles;
  chartColors: string[];
  chartSeries: ChartSeries[];
  strokeType: 'monotone' | 'linear';
  axisStyle: CSSProperties;
  gridStroke: string;
  /** Multiplier on `gridStroke`'s alpha — see `getAxisStyles`. */
  gridOpacity: number;
  axisConfig: CartesianAxisConfig;
  barGeometry: BarGeometry;
  animationDuration: number;
  commonProps: {
    data: ChartDataPoint[];
    margin: { top?: number; right?: number; bottom?: number; left?: number };
    onClick: (payload: unknown) => void;
  };
}

export function buildChartContext(props: ChartProps, theme: Theme): ChartRenderContext {
  const sizeStyles = getSizeStyles(props.size, props.height);
  const chartColors = getDefaultColors(theme, props.variant ?? 'default', props.colors);
  const { axisStyle, gridStroke, gridOpacity } = getAxisStyles(
    theme,
    props.variant ?? 'default',
    sizeStyles.fontSize,
  );
  const handleChartClick = (payload: unknown): void => {
    const chartData = payload as { activePayload?: Array<{ payload: ChartDataPoint }> };
    if (props.onClick && chartData?.activePayload?.[0]) {
      props.onClick(chartData.activePayload[0].payload);
    }
  };
  return {
    props,
    theme,
    sizeStyles,
    chartColors,
    chartSeries: resolveSeries(props.data, props.series, props.xAxisKey ?? 'name', chartColors),
    strokeType: (props.curved ?? true) ? 'monotone' : 'linear',
    axisStyle: { ...axisStyle, fontSize: sizeStyles.fontSize },
    gridStroke,
    gridOpacity,
    axisConfig: resolveAxisConfig(props, sizeStyles.tickMargin),
    barGeometry: resolveBarGeometry(props),
    animationDuration: (props.animate ?? true) ? (props.animationDuration ?? 1500) : 0,
    commonProps: {
      data: props.data,
      margin: { top: 20, right: 30, left: 20, bottom: 20, ...props.margin },
      onClick: handleChartClick,
    },
  };
}
