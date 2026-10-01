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
import { remPx } from '../../../tokens/relative';

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

/**
 * The chart types whose value axis sizes itself to its widest tick
 * (`width="auto"`, `cartesianAxes`). Their left margin is only room for a
 * rotated axis TITLE; without one it was 20px of nothing beside the ticks,
 * taken out of the plot on a phone. Pie, radar and scatter keep it: a pie is
 * centred between both margins, and scatter's axis is still fixed-width.
 */
const AUTO_WIDTH_VALUE_AXIS: ReadonlySet<NonNullable<ChartProps['type']>> = new Set([
  'line',
  'bar',
  'area',
  'composed',
]);

/** The default left margin in design px — see {@link AUTO_WIDTH_VALUE_AXIS}. */
function leftMarginDesignPx(props: ChartProps): number {
  const autoWidthAxis = AUTO_WIDTH_VALUE_AXIS.has(props.type ?? 'line');
  return autoWidthAxis && !props.yAxisLabel ? 0 : 20;
}

export function buildChartContext(props: ChartProps, theme: Theme): ChartRenderContext {
  const sizeStyles = getSizeStyles(theme, props.size, props.height);
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
    barGeometry: resolveBarGeometry(props, theme),
    animationDuration: (props.animate ?? true) ? (props.animationDuration ?? 1500) : 0,
    commonProps: {
      data: props.data,
      margin: {
        top: remPx(theme, 20),
        right: remPx(theme, 30),
        left: remPx(theme, leftMarginDesignPx(props)),
        bottom: remPx(theme, 20),
        ...marginPx(theme, props.margin),
      },
      onClick: handleChartClick,
    },
  };
}

/** A caller's margin is in design px (the prop's contract); Recharts takes px numbers. */
function marginPx(theme: Theme, margin: ChartProps['margin']): ChartProps['margin'] {
  if (!margin) return undefined;
  return Object.fromEntries(
    Object.entries(margin).map(([side, px]) => [side, typeof px === 'number' ? remPx(theme, px) : px]),
  );
}
