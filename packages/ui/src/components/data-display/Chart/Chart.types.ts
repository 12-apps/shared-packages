import type { ColorValue, SizeValue } from '../../../tokens/scales';
import type { CSSProperties } from 'react';

export type ChartType = 'line' | 'bar' | 'area' | 'pie' | 'radar' | 'scatter' | 'composed';

export interface ChartDataPoint {
  [key: string]: string | number | null;
}

export interface ChartSeries {
  dataKey: string;
  name?: string;
  color?: string;
  type?: 'line' | 'bar' | 'area';
  strokeWidth?: number;
  fill?: string;
  fillOpacity?: number;
  strokeDasharray?: string;
  dot?: boolean;
  activeDot?: boolean;
  label?: boolean;
  stackId?: string;
}

export interface ChartProps {
  data: ChartDataPoint[];
  series?: ChartSeries[];
  type?: ChartType;
  variant?: 'default' | 'glass' | 'gradient' | 'elevated' | 'minimal' | 'neon';
  size?: SizeValue;
  color?: ColorValue;
  height?: number;
  width?: number | string;
  glow?: boolean;
  pulse?: boolean;
  glass?: boolean;
  gradient?: boolean;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
  subtitle?: string;
  xAxisKey?: string;
  yAxisLabel?: string;
  xAxisLabel?: string;
  showGrid?: boolean;
  showLegend?: boolean;
  showTooltip?: boolean;
  showCartesianGrid?: boolean;
  animate?: boolean;
  animationDuration?: number;
  onClick?: (data: ChartDataPoint) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  margin?: { top?: number; right?: number; bottom?: number; left?: number };
  colors?: string[];
  curved?: boolean;
  stacked?: boolean;
  percentage?: boolean;
  showValues?: boolean;
  responsive?: boolean;
  innerRadius?: number;
  centerLabel?: string | { label: string; value: string | number };
  /** Formats numeric tooltip values and y-axis ticks (e.g. centavos → BRL). */
  valueFormatter?: (value: number) => string;
  /**
   * Whether the value axis may place ticks between whole numbers. Default true.
   *
   * Set it false for a metric that only takes whole values — a COUNT. Recharts
   * spaces ticks evenly across the domain, so a count topping out at 2 gets
   * 0/0.5/1/1.5/2; an integer `valueFormatter` then renders that as
   * `0, 1, 1, 2, 2`, and the axis reads as though it repeats itself (FUT-755).
   * Formatting alone cannot fix it — the duplicate ticks are already chosen by
   * the time the formatter runs.
   */
  allowDecimalTicks?: boolean;
  /**
   * Cap on how many category-axis labels are drawn. Default 8; above it every
   * nth label is kept, the LAST one always among them. Recharts' own
   * width-aware thinning still runs on top, so a narrow viewport drops more.
   */
  maxCategoryTicks?: number;
  /** Category tick labels longer than this are truncated with an ellipsis. Default 12. */
  tickLabelMaxChars?: number;
  /** Bar corner radius in px (top corners only; stacked segments stay square). Default 3. */
  barRadius?: number;
  /**
   * Cap on a single bar's thickness in px. Default 38 — it is also what keeps
   * the first and last bar clear of the chart frame in a wide card.
   */
  maxBarWidth?: number;
  'data-testid'?: string;
}