import { alpha, type Theme } from '@mui/material/styles';
import type { CSSProperties } from 'react';

import type { ChartProps, ChartSeries } from './Chart.types';
import { accentFor} from '../../../tokens/scales';

/**
 * Non-JSX internals of the prop-driven Chart: size/variant styling, palette
 * resolution and series auto-detection. Split from Chart.tsx to keep every
 * function inside the repo's complexity budget.
 */

export interface SizeStyles {
  height: number;
  fontSize: string;
  /**
   * Gap between an axis line and its tick labels, px.
   *
   * Recharts' default of 2 is not enough. The bottom VALUE tick is centred on
   * the x-axis line, so its text box reaches ~0.79em BELOW that line, while
   * the category labels begin 2px under the 6px tick mark — the two collide at
   * the axis corner, at every viewport. Each value below is ~0.8em of its own
   * font size, which clears the value label's descender with ~6px to spare.
   */
  tickMargin: number;
}

const SIZE_PRESETS: Record<NonNullable<ChartProps['size']>, SizeStyles> = {
  xs: { height: 200, fontSize: '0.75rem', tickMargin: 10 },
  sm: { height: 300, fontSize: '0.875rem', tickMargin: 12 },
  md: { height: 400, fontSize: '1rem', tickMargin: 14 },
  lg: { height: 500, fontSize: '1.125rem', tickMargin: 16 },
  xl: { height: 600, fontSize: '1.25rem', tickMargin: 18 },
};

export function getSizeStyles(size: ChartProps['size'], height?: number): SizeStyles {
  const preset = SIZE_PRESETS[size ?? 'md'] ?? SIZE_PRESETS.md;
  return { ...preset, height: height ?? preset.height };
}

const NEON_PALETTE = ['#00ffff', '#ff00ff', '#ffff00', '#00ff00', '#ff0080', '#8000ff'];

export function getDefaultColors(theme: Theme, variant: ChartProps['variant'], colors?: string[]): string[] {
  if (colors) return colors;
  if (variant === 'neon') return NEON_PALETTE;
  return [
    theme.palette.primary.main,
    theme.palette.secondary.main,
    theme.palette.success.main,
    theme.palette.warning.main,
    theme.palette.error.main,
    theme.palette.info.main,
  ];
}

type SxStyles = Record<string, unknown>;

interface VariantOptions {
  variant: NonNullable<ChartProps['variant']>;
  color: NonNullable<ChartProps['color']>;
  glow: boolean;
  pulse: boolean;
  glass: boolean;
  gradient: boolean;
  disabled: boolean;
}

function effectStyles(theme: Theme, options: VariantOptions): SxStyles {
  const accent = accentFor(theme, options.color).main;
  const glow = options.glow ? { boxShadow: `0 0 30px ${alpha(accent, 0.4)}` } : {};
  const pulse = options.pulse
    ? {
        animation: 'pulse 2s infinite',
        '@keyframes pulse': {
          '0%': { boxShadow: `0 0 0 0 ${alpha(accent, 0.4)}` },
          '70%': { boxShadow: `0 0 0 20px ${alpha(accent, 0)}` },
          '100%': { boxShadow: `0 0 0 0 ${alpha(accent, 0)}` },
        },
      }
    : {};
  return { ...glow, ...pulse };
}

function variantSurface(theme: Theme, options: VariantOptions): SxStyles {
  switch (options.variant) {
    case 'glass':
      return {
        backgroundColor: alpha(theme.palette.background.paper, options.glass ? 0.1 : 0.9),
        backdropFilter: 'blur(20px)',
        border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
      };
    case 'gradient':
      return {
        background: options.gradient
          ? `linear-gradient(135deg, ${alpha(accentFor(theme, options.color).light, 0.05)}, ${alpha(accentFor(theme, options.color).dark, 0.05)})`
          : theme.palette.background.paper,
      };
    case 'elevated':
      return { boxShadow: theme.shadows[4] };
    case 'minimal':
      return { border: 'none', backgroundColor: 'transparent' };
    case 'neon':
      return {
        backgroundColor: '#000',
        border: `1px solid ${alpha('#00ffff', 0.3)}`,
        '& .recharts-cartesian-grid-horizontal line, & .recharts-cartesian-grid-vertical line': {
          stroke: alpha('#00ffff', 0.1),
        },
      };
    default:
      return { backgroundColor: theme.palette.background.paper };
  }
}

export function getVariantStyles(theme: Theme, options: VariantOptions): SxStyles {
  return {
    borderRadius: theme.spacing(1),
    transition: theme.transitions.create(['all'], {
      duration: theme.transitions.duration.standard,
    }),
    opacity: options.disabled ? 0.5 : 1,
    pointerEvents: options.disabled ? ('none' as const) : ('auto' as const),
    ...effectStyles(theme, options),
    ...variantSurface(theme, options),
  };
}

/** Explicit series, or one series per non-axis key found in the first row. */
export function resolveSeries(
  data: ChartProps['data'],
  series: ChartSeries[] | undefined,
  xAxisKey: string,
  palette: string[],
): ChartSeries[] {
  if (series) return series;
  if (data.length === 0) return [];
  return Object.keys(data[0] ?? {})
    .filter((key) => key !== xAxisKey)
    .map((key, index) => ({
      dataKey: key,
      name: key,
      color: palette[index % palette.length],
    }));
}

interface AxisTextStyles {
  axisStyle: CSSProperties;
  gridStroke: string;
  /**
   * Multiplier applied to `gridStroke`'s own alpha. Gridlines must read one
   * step BELOW the card border — the border is `divider`, so half of it —
   * without being dashed at data weight. Expressing the step as an opacity
   * rather than a second colour keeps it derived from the theme's divider
   * whatever form that takes (rgba, hex, or a CSS variable, which the colour
   * helpers cannot decompose).
   */
  gridOpacity: number;
}

export function getAxisStyles(theme: Theme, variant: ChartProps['variant'], fontSize: string): AxisTextStyles {
  const neon = variant === 'neon';
  return {
    axisStyle: {
      fontSize,
      fill: neon ? '#00ffff' : theme.palette.text.secondary,
      // Ticks are columns of digits: they have to line up between rows.
      fontVariantNumeric: 'tabular-nums',
    },
    gridStroke: neon ? alpha('#00ffff', 0.1) : theme.palette.divider,
    // The neon grid is already a 10%-alpha cyan; halving it again would erase it.
    gridOpacity: neon ? 1 : 0.5,
  };
}
