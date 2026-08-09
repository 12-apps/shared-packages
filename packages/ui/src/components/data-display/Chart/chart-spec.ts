import type { ChartDataPoint, ChartProps } from './Chart.types';
import type { ChartSemanticColor, ChartSpec, ChartSpecSeries } from './ChartSpec.types';
import { chartValueFormatter } from './chart-format';
import {
  getChartSpecRenderer,
  getRegisteredChartSpecTypes,
  type ChartSpecRenderContext,
} from './chart-spec-registry';

export const CHART_SEMANTIC_COLORS: readonly ChartSemanticColor[] = [
  'primary',
  'secondary',
  'success',
  'warning',
  'error',
  'info',
];

const NUMBER_FORMATS = ['brl', 'percent', 'compact', 'integer', 'decimal'];

/** Error thrown when an unknown/invalid spec is parsed. Message is written to
 * be actionable for programmatic authors (builders, LLMs). */
export class ChartSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChartSpecError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertColor(value: unknown, where: string): void {
  if (value === undefined) return;
  if (!CHART_SEMANTIC_COLORS.includes(value as ChartSemanticColor)) {
    throw new ChartSpecError(
      `${where} must be a semantic color token (${CHART_SEMANTIC_COLORS.join(', ')}), got ${JSON.stringify(value)}. Raw color values are not allowed.`,
    );
  }
}

function parseAxis(value: unknown): { key: string; label?: string } {
  if (!isRecord(value) || typeof value.key !== 'string' || value.key.length === 0) {
    throw new ChartSpecError('"xAxis" must be an object with a non-empty string "key" naming the row property for the category axis.');
  }
  if (value.label !== undefined && typeof value.label !== 'string') {
    throw new ChartSpecError('"xAxis.label" must be a string when provided.');
  }
  return { key: value.key, label: value.label };
}

function parseSeries(value: unknown): ChartSpecSeries[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ChartSpecError('"series" must be a non-empty array of { key, label?, color? } objects.');
  }
  return value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.key !== 'string' || entry.key.length === 0) {
      throw new ChartSpecError(`"series[${index}]" must be an object with a non-empty string "key" naming the row property holding its values.`);
    }
    assertColor(entry.color, `"series[${index}].color"`);
    if (entry.label !== undefined && typeof entry.label !== 'string') {
      throw new ChartSpecError(`"series[${index}].label" must be a string when provided.`);
    }
    return { key: entry.key, label: entry.label, color: entry.color as ChartSemanticColor | undefined };
  });
}

function assertFieldType(
  spec: Record<string, unknown>,
  field: string,
  expected: 'string' | 'boolean' | 'number',
): void {
  const value = spec[field];
  if (value !== undefined && typeof value !== expected) {
    throw new ChartSpecError(`"${field}" must be a ${expected} when provided.`);
  }
}

function parseColorScheme(value: unknown): ChartSemanticColor[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new ChartSpecError('"colorScheme" must be a non-empty array of semantic color tokens when provided.');
  }
  value.forEach((token, index) => assertColor(token, `"colorScheme[${index}]"`));
  return value as ChartSemanticColor[];
}

function parseOptionalFields(spec: Record<string, unknown>): Partial<ChartSpec> {
  for (const field of ['title', 'subtitle'] as const) assertFieldType(spec, field, 'string');
  for (const field of ['stacked', 'legend', 'tooltip', 'curved'] as const) {
    assertFieldType(spec, field, 'boolean');
  }
  assertFieldType(spec, 'height', 'number');
  if (spec.numberFormat !== undefined && !NUMBER_FORMATS.includes(spec.numberFormat as string)) {
    throw new ChartSpecError(
      `"numberFormat" must be one of ${NUMBER_FORMATS.join(', ')}, got ${JSON.stringify(spec.numberFormat)}.`,
    );
  }
  return {
    title: spec.title as string | undefined,
    subtitle: spec.subtitle as string | undefined,
    stacked: spec.stacked as boolean | undefined,
    legend: spec.legend as boolean | undefined,
    tooltip: spec.tooltip as boolean | undefined,
    curved: spec.curved as boolean | undefined,
    height: spec.height as number | undefined,
    numberFormat: spec.numberFormat as ChartSpec['numberFormat'],
    colorScheme: parseColorScheme(spec.colorScheme),
  };
}

/**
 * Validate an untrusted value (e.g. JSON from storage or an LLM) into a
 * `ChartSpec`. Throws {@link ChartSpecError} with an actionable message on
 * the first problem found.
 */
export function parseChartSpec(input: unknown): ChartSpec {
  if (!isRecord(input)) {
    throw new ChartSpecError('A chart spec must be a JSON object.');
  }
  const type = input.type;
  if (typeof type !== 'string' || !getChartSpecRenderer(type)) {
    throw new ChartSpecError(
      `"type" must be one of the registered chart types (${getRegisteredChartSpecTypes().join(', ')}), got ${JSON.stringify(type)}.`,
    );
  }
  const yAxis = input.yAxis;
  if (yAxis !== undefined && (!isRecord(yAxis) || (yAxis.label !== undefined && typeof yAxis.label !== 'string'))) {
    throw new ChartSpecError('"yAxis" must be an object with an optional string "label" when provided.');
  }
  const centerLabel = input.centerLabel;
  return {
    ...parseOptionalFields(input),
    type: type as ChartSpec['type'],
    xAxis: parseAxis(input.xAxis),
    yAxis: yAxis as ChartSpec['yAxis'],
    series: parseSeries(input.series),
    centerLabel: centerLabel as ChartSpec['centerLabel'],
  };
}

/**
 * Derive the prop-driven `Chart` props for a validated spec. The spec API is
 * layered on top of the existing component — one rendering implementation.
 */
export function specToChartProps(
  spec: ChartSpec,
  data: ChartDataPoint[],
  ctx: ChartSpecRenderContext,
): ChartProps {
  const renderer = getChartSpecRenderer(spec.type);
  if (!renderer) {
    throw new ChartSpecError(
      `Unknown chart type "${spec.type}". Registered types: ${getRegisteredChartSpecTypes().join(', ')}.`,
    );
  }
  return {
    data,
    title: spec.title,
    subtitle: spec.subtitle,
    xAxisKey: spec.xAxis.key,
    xAxisLabel: spec.xAxis.label,
    yAxisLabel: spec.yAxis?.label,
    showLegend: spec.legend ?? true,
    showTooltip: spec.tooltip ?? true,
    height: spec.height,
    valueFormatter: chartValueFormatter(spec.numberFormat),
    // An integer metric is a COUNT: half a row does not exist, so the axis must
    // not offer half-steps it would then round into duplicates (FUT-755).
    allowDecimalTicks: spec.numberFormat !== 'integer',
    ...renderer(spec, ctx),
  };
}
