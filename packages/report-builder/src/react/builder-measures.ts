/**
 * The measure row of the builder form (FUT-138/FUT-454): its draft shape, the
 * aggregations the picker may offer, and the one edit operation on it. Split
 * out of `builder-model` so the draft model stays about the DOCUMENT while
 * this file stays about a single row's rules.
 */
import type { BuilderDraft } from "./builder-model";
import type { ReportField } from "./custom-reports-api";

export interface MeasureDraft {
  field: string;
  aggregation: string;
  /** Pass-through output name (the form doesn't edit aliases; sorts may reference them). */
  alias?: string;
  /**
   * Pass-through measure options the form cannot author yet (FUT-454): a
   * ratio's divisor, a suppression floor, a render format. Carried so opening
   * an MCP- or preset-authored report in the builder and saving it back does
   * not silently strip them — dropping `minSample` would PUBLISH a figure the
   * spec deliberately withheld.
   */
  denominator?: string;
  minSample?: number;
  format?: string;
}

type MeasureOptions = Pick<MeasureDraft, "denominator" | "minSample" | "format">;

export const AGGREGATION_LABELS: Record<string, string> = {
  sum: "Soma",
  avg: "Média",
  count: "Contagem",
  count_distinct: "Contagem distinta",
  min: "Mínimo",
  max: "Máximo",
  p50: "Mediana (p50)",
  p90: "Percentil 90 (p90)",
  p95: "Percentil 95 (p95)",
  ratio: "Proporção (soma ÷ soma)",
};

/** The pass-through options of a measure, omitting the ones it doesn't carry. */
export function measureOptions(measure: MeasureOptions): MeasureOptions {
  return {
    ...(measure.denominator ? { denominator: measure.denominator } : {}),
    ...(measure.minSample !== undefined ? { minSample: measure.minSample } : {}),
    ...(measure.format ? { format: measure.format } : {}),
  };
}

/**
 * The aggregations a measure Select offers for a field (mirrors the compiler,
 * minus `ratio`: it needs a `denominator` this form cannot author yet, so
 * offering it would only ever produce a spec the server rejects).
 */
export function aggregationOptions(field: ReportField | undefined): string[] {
  if (!field) return ["sum"];
  if (field.aggregations && field.aggregations.length > 0) {
    return field.aggregations.filter((aggregation) => aggregation !== "ratio");
  }
  if (field.role === "dimension") return ["count", "count_distinct"];
  if (field.type === "money" || field.type === "number") {
    return ["sum", "avg", "count", "min", "max", "count_distinct", "p50", "p90", "p95"];
  }
  if (field.type === "date") return ["min", "max", "count"];
  return ["count", "count_distinct"];
}

/** A measure row's output name (mirrors the compiler's alias derivation). */
export function measureSortKey(measure: MeasureDraft): string {
  return measure.alias ?? `${measure.aggregation}_${measure.field}`;
}

/**
 * The pass-through options an edited row keeps: only while the FIELD stays
 * put, and only a divisor the new aggregation can still use — keeping one on
 * a non-ratio measure would save a spec the server rejects.
 */
function keptMeasureOptions(
  current: MeasureDraft | undefined,
  field: string,
  aggregation: string,
): MeasureOptions {
  if (!current || current.field !== field) return {};
  const options = measureOptions(current);
  if (aggregation !== "ratio") delete options.denominator;
  return options;
}

/**
 * One measure-row edit (FUT-308 review follow-ups): the alias survives while
 * the FIELD stays put (an aggregation tweak must not rename the column a
 * sort references), and any sort entry keyed on the row's OLD output name is
 * retargeted to the new one — swapping the ranked measure of a top-N report
 * keeps it a top-N report, ranked by the new measure, instead of silently
 * saving a limited-but-unordered one.
 */
export function editMeasureRow(
  draft: BuilderDraft,
  index: number,
  field: string,
  aggregation: string,
  fieldDef: ReportField | undefined,
): BuilderDraft {
  const current = draft.measures[index];
  const allowed = aggregationOptions(fieldDef);
  const resolved = allowed.includes(aggregation) ? aggregation : (allowed[0] ?? "sum");
  const edited: MeasureDraft = {
    field,
    aggregation: resolved,
    ...(current?.field === field && current.alias ? { alias: current.alias } : {}),
    ...keptMeasureOptions(current, field, resolved),
  };
  const measures = [...draft.measures];
  measures[index] = edited;
  const oldKey = current ? measureSortKey(current) : undefined;
  const newKey = measureSortKey(edited);
  const sort = draft.sort.map((entry) =>
    oldKey !== undefined && entry.by === oldKey ? { ...entry, by: newKey } : entry,
  );
  return { ...draft, measures, sort };
}
