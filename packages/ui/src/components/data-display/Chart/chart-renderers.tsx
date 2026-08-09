import type { Theme } from '@mui/material';
import React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { ChartDataPoint, ChartProps, ChartSeries } from './Chart.types';
import { ChartLegendContent, ChartTooltipContent } from './ChartComposables';
import {
  getAxisStyles,
  getDefaultColors,
  getSizeStyles,
  resolveSeries,
  type SizeStyles,
} from './chart-internals';

/**
 * Per-type Recharts renderers for the prop-driven Chart, dispatched from a
 * registry keyed by `ChartProps['type']`. Each renderer reads a prepared
 * {@link ChartRenderContext} so every function stays small.
 */

interface ChartRenderContext {
  props: ChartProps;
  theme: Theme;
  sizeStyles: SizeStyles;
  chartColors: string[];
  chartSeries: ChartSeries[];
  strokeType: 'monotone' | 'linear';
  axisStyle: React.CSSProperties;
  gridStroke: string;
  animationDuration: number;
  commonProps: {
    data: ChartDataPoint[];
    margin: { top?: number; right?: number; bottom?: number; left?: number };
    onClick: (payload: unknown) => void;
  };
}

function chartExtras(ctx: ChartRenderContext): React.ReactNode[] {
  const { props } = ctx;
  const nodes: React.ReactNode[] = [];
  if (props.showTooltip !== false) {
    nodes.push(
      <Tooltip key="tooltip" content={<ChartTooltipContent valueFormatter={props.valueFormatter} />} />,
    );
  }
  if (props.showLegend !== false) {
    nodes.push(<Legend key="legend" content={<ChartLegendContent />} />);
  }
  return nodes;
}

function cartesianAxes(ctx: ChartRenderContext): React.ReactNode[] {
  const { props } = ctx;
  const nodes: React.ReactNode[] = [];
  if (props.showCartesianGrid !== false) {
    nodes.push(<CartesianGrid key="grid" strokeDasharray="3 3" stroke={ctx.gridStroke} />);
  }
  nodes.push(
    <XAxis key="x" dataKey={props.xAxisKey ?? 'name'} style={ctx.axisStyle} label={props.xAxisLabel} />,
    <YAxis
      key="y"
      style={ctx.axisStyle}
      label={props.yAxisLabel}
      tickFormatter={props.valueFormatter}
      allowDecimals={props.allowDecimalTicks !== false}
    />,
  );
  return nodes;
}

function renderLine(ctx: ChartRenderContext): React.ReactElement {
  return (
    <LineChart {...ctx.commonProps}>
      {cartesianAxes(ctx)}
      {chartExtras(ctx)}
      {ctx.chartSeries.map((s, index) => (
        <Line
          key={s.dataKey}
          type={ctx.strokeType}
          dataKey={s.dataKey}
          name={s.name}
          stroke={s.color ?? ctx.chartColors[index % ctx.chartColors.length]}
          strokeWidth={s.strokeWidth ?? 2}
          dot={s.dot !== false}
          activeDot={s.activeDot !== false ? { r: 8 } : false}
          animationDuration={ctx.animationDuration}
        />
      ))}
    </LineChart>
  );
}

function renderBar(ctx: ChartRenderContext): React.ReactElement {
  return (
    <BarChart {...ctx.commonProps}>
      {cartesianAxes(ctx)}
      {chartExtras(ctx)}
      {ctx.chartSeries.map((s, index) => (
        <Bar
          key={s.dataKey}
          dataKey={s.dataKey}
          name={s.name}
          fill={s.fill ?? s.color ?? ctx.chartColors[index % ctx.chartColors.length]}
          stackId={ctx.props.stacked ? 'stack' : undefined}
          animationDuration={ctx.animationDuration}
        />
      ))}
    </BarChart>
  );
}

function renderArea(ctx: ChartRenderContext): React.ReactElement {
  return (
    <AreaChart {...ctx.commonProps}>
      {cartesianAxes(ctx)}
      {chartExtras(ctx)}
      {ctx.chartSeries.map((s, index) => (
        <Area
          key={s.dataKey}
          type={ctx.strokeType}
          dataKey={s.dataKey}
          name={s.name}
          stroke={s.color ?? ctx.chartColors[index % ctx.chartColors.length]}
          fill={s.fill ?? s.color ?? ctx.chartColors[index % ctx.chartColors.length]}
          fillOpacity={s.fillOpacity ?? 0.6}
          stackId={ctx.props.stacked ? 'stack' : undefined}
          animationDuration={ctx.animationDuration}
        />
      ))}
    </AreaChart>
  );
}

function pieCenterLabel(ctx: ChartRenderContext): React.ReactNode {
  const { centerLabel } = ctx.props;
  const innerRadius = ctx.props.innerRadius ?? 0;
  if (!centerLabel || innerRadius <= 0) return null;
  const fill = ctx.props.variant === 'neon' ? '#00ffff' : ctx.theme.palette.text.primary;
  return (
    <text
      x="50%"
      y="50%"
      textAnchor="middle"
      dominantBaseline="middle"
      style={{ fontSize: ctx.sizeStyles.fontSize, fill, fontWeight: 600 }}
    >
      {typeof centerLabel === 'string' ? (
        centerLabel
      ) : (
        <>
          <tspan
            x="50%"
            dy="-0.6em"
            style={{ fontSize: '0.875em', fontWeight: 500, fill: ctx.theme.palette.text.secondary }}
          >
            {centerLabel.label}
          </tspan>
          <tspan x="50%" dy="1.4em" style={{ fontSize: '1.5em', fontWeight: 700 }}>
            {centerLabel.value}
          </tspan>
        </>
      )}
    </text>
  );
}

function renderPie(ctx: ChartRenderContext): React.ReactElement {
  const { props } = ctx;
  return (
    <PieChart>
      {chartExtras(ctx)}
      <Pie
        data={props.data}
        dataKey={ctx.chartSeries[0]?.dataKey ?? 'value'}
        nameKey={props.xAxisKey ?? 'name'}
        cx="50%"
        cy="50%"
        outerRadius={ctx.sizeStyles.height / 3}
        innerRadius={props.innerRadius ?? 0}
        fill={ctx.chartColors[0]}
        label={props.showValues ?? false}
        animationDuration={ctx.animationDuration}
      >
        {props.data.map((entry, index) => (
          <Cell key={`cell-${index}`} fill={ctx.chartColors[index % ctx.chartColors.length]} />
        ))}
      </Pie>
      {pieCenterLabel(ctx)}
    </PieChart>
  );
}

function renderRadar(ctx: ChartRenderContext): React.ReactElement {
  return (
    <RadarChart {...ctx.commonProps}>
      <PolarGrid stroke={ctx.gridStroke} />
      <PolarAngleAxis dataKey={ctx.props.xAxisKey ?? 'name'} style={ctx.axisStyle} />
      <PolarRadiusAxis style={ctx.axisStyle} />
      {chartExtras(ctx)}
      {ctx.chartSeries.map((s, index) => (
        <Radar
          key={s.dataKey}
          dataKey={s.dataKey}
          name={s.name}
          stroke={s.color ?? ctx.chartColors[index % ctx.chartColors.length]}
          fill={s.fill ?? s.color ?? ctx.chartColors[index % ctx.chartColors.length]}
          fillOpacity={s.fillOpacity ?? 0.6}
          animationDuration={ctx.animationDuration}
        />
      ))}
    </RadarChart>
  );
}

function renderScatter(ctx: ChartRenderContext): React.ReactElement {
  const { props } = ctx;
  return (
    <ScatterChart {...ctx.commonProps}>
      {props.showCartesianGrid !== false && (
        <CartesianGrid strokeDasharray="3 3" stroke={ctx.gridStroke} />
      )}
      <XAxis dataKey={props.xAxisKey ?? 'name'} style={ctx.axisStyle} label={props.xAxisLabel} />
      <YAxis dataKey={ctx.chartSeries[0]?.dataKey} style={ctx.axisStyle} label={props.yAxisLabel} />
      {chartExtras(ctx)}
      <Scatter
        name={ctx.chartSeries[0]?.name ?? 'Data'}
        data={props.data}
        fill={ctx.chartColors[0]}
        animationDuration={ctx.animationDuration}
      />
    </ScatterChart>
  );
}

function composedSeries(ctx: ChartRenderContext, s: ChartSeries, index: number): React.ReactElement {
  const color = s.color ?? ctx.chartColors[index % ctx.chartColors.length];
  if (s.type === 'bar') {
    return (
      <Bar key={s.dataKey} dataKey={s.dataKey} name={s.name} fill={color} animationDuration={ctx.animationDuration} />
    );
  }
  if (s.type === 'area') {
    return (
      <Area
        key={s.dataKey}
        type={ctx.strokeType}
        dataKey={s.dataKey}
        name={s.name}
        stroke={color}
        fill={color}
        fillOpacity={0.6}
        animationDuration={ctx.animationDuration}
      />
    );
  }
  return (
    <Line
      key={s.dataKey}
      type={ctx.strokeType}
      dataKey={s.dataKey}
      name={s.name}
      stroke={color}
      animationDuration={ctx.animationDuration}
    />
  );
}

function renderComposed(ctx: ChartRenderContext): React.ReactElement {
  return (
    <ComposedChart {...ctx.commonProps}>
      {cartesianAxes(ctx)}
      {chartExtras(ctx)}
      {ctx.chartSeries.map((s, index) => composedSeries(ctx, s, index))}
    </ComposedChart>
  );
}

const RENDERERS: Record<string, (ctx: ChartRenderContext) => React.ReactElement> = {
  line: renderLine,
  bar: renderBar,
  area: renderArea,
  pie: renderPie,
  radar: renderRadar,
  scatter: renderScatter,
  composed: renderComposed,
};

function buildContext(props: ChartProps, theme: Theme): ChartRenderContext {
  const sizeStyles = getSizeStyles(props.size, props.height);
  const chartColors = getDefaultColors(theme, props.variant ?? 'default', props.colors);
  const { axisStyle, gridStroke } = getAxisStyles(theme, props.variant ?? 'default', sizeStyles.fontSize);
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
    animationDuration: (props.animate ?? true) ? (props.animationDuration ?? 1500) : 0,
    commonProps: {
      data: props.data,
      margin: { top: 20, right: 30, left: 20, bottom: 20, ...props.margin },
      onClick: handleChartClick,
    },
  };
}

/** Render the Recharts element for the requested chart type. */
export function renderChartByType(props: ChartProps, theme: Theme): React.ReactElement {
  const renderer = RENDERERS[props.type ?? 'line'];
  const ctx = buildContext(props, theme);
  return renderer ? renderer(ctx) : <></>;
}
