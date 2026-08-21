import type { Aggregation, FilterOperator, TimeGrain } from './types';

/**
 * Every sentence and label this engine renders, as REQUIRED host config
 * (FUT-760).
 *
 * The package used to compile in its own pt-BR: the spec sentence, the column
 * headings, the eight reasons a presentation is unavailable and the two words a
 * boolean cell reads as. That made the origin host's Portuguese the silent
 * default for every adopter — a report surface mounted by a host with another
 * audience rendered "soma de receita em pedidos" and nothing failed to say so.
 *
 * There are no defaults here on purpose. A host names its pack at the mount
 * (`copy: PT_BR_REPORT_ENGINE_COPY`), and the pt-BR that used to be implicit is
 * now a choice visible in a diff.
 */

/**
 * The parts of a spec sentence, handed to the host's `sentence` template.
 *
 * A template rather than concatenation because WORD ORDER is the part that does
 * not survive translation. The old code built the sentence by appending
 * ` por …`, `, separado por …`, `, onde …` — Portuguese grammar spelled into
 * control flow, where a host had nothing to override. Handing over the assembled
 * clauses lets a pack put them wherever its language puts them.
 */
export interface SpecSentenceParts {
  /** The measures, already joined by {@link SpecSentenceCopy.list}. */
  measures: string;
  /** The entity being measured, lower-cased by the host's locale. */
  entity: string;
  /** The first dimension — the grouping — when the spec has one. */
  groupBy?: string;
  /**
   * The second dimension. It is the SPLIT (one series per value), not another
   * level of grouping, so a pack should word it as such.
   */
  splitBy?: string;
  /** The filters, already joined by {@link SpecSentenceCopy.list}. */
  filters?: string;
  /** Present when the spec caps its rows — a top N. */
  limit?: number;
}

/**
 * The words a spec is described in, and the grammar that joins them.
 *
 * `specSentence` is a DISPLAY function: it never throws and never validates, so
 * a pack's members are called with whatever the spec carries, including ids the
 * catalog no longer knows.
 */
export interface SpecSentenceCopy {
  /**
   * The BCP-47 tag used for case folding (`toLocaleLowerCase`). Turkish dotted
   * i is the standing reminder that case is locale-dependent, so this travels
   * with the words rather than being assumed from the runtime.
   */
  locale: string;
  /** What each aggregation is called: `sum` → `soma`. */
  aggregations: Readonly<Record<Aggregation, string>>;
  /** What each time bucket is called: `month` → `mês`. */
  grains: Readonly<Record<TimeGrain, string>>;
  /** How each comparison reads mid-sentence: `eq` → `é`. */
  operators: Readonly<Record<FilterOperator, string>>;
  /** One measure: (`soma`, `receita`) → `soma de receita`. */
  measure(aggregation: string, field: string): string;
  /** A ratio against its divisor: (`soma de receita`, `pedido`) → `… por pedido`. */
  ratio(measure: string, denominator: string): string;
  /** A dimension carrying a time grain: (`data`, `dia`) → `data (dia)`. */
  dimension(field: string, grain: string): string;
  /** One filter clause: (`status`, `é`, `Pago`) → `status é Pago`. */
  filter(field: string, operator: string, operand: string): string;
  /** A `between` operand: (`10`, `20`) → `10 e 20`. */
  between(from: string, to: string): string;
  /** A serial list, so the tail reads as prose: `a, b e c`. */
  list(parts: readonly string[]): string;
  /** The whole sentence, assembled from its clauses. No trailing period. */
  sentence(parts: SpecSentenceParts): string;
}

/**
 * The short headings a rendered column, axis, series or KPI caption carries.
 *
 * Distinct from {@link SpecSentenceCopy} because they answer different
 * questions: that one writes prose for a reader, this one writes a heading that
 * has to fit in a column.
 */
export interface RenderLabelCopy {
  /** A time grain as it appears in a heading: `week` → `semana`. */
  grains: Readonly<Record<string, string>>;
  /**
   * The qualifiers that keep a heading honest — a count of orders is not
   * "Pedidos", it is how many of them. `sum`, `min` and `max` take none: the
   * field's own name already reads as the quantity they produce.
   */
  qualifiers: {
    /** `count` and `count_distinct` alike. */
    count: string;
    avg: string;
    ratio: string;
  };
  /** A qualified heading: (`Receita`, `contagem`) → `Receita (contagem)`. */
  qualified(base: string, qualifier: string): string;
}

/**
 * Why a presentation cannot draw the spec's current shape.
 *
 * Every one names the CONTROL the author has to change and quotes it, rather
 * than restating the rule that blocked them — the author is holding a form, and
 * the useful sentence is which field to touch next. A pack that translates these
 * should keep that register, and should quote its OWN control labels.
 */
export interface PresentationCopy {
  /** A chart was chosen with nothing to plot against. */
  needsGrouping: string;
  /** A single figure cannot also be grouped. */
  kpiTakesNoGrouping: string;
  /** Without a grouping a table is one row — a worse single figure. */
  tableTakesAGrouping: string;
  /** Stacking needs more than one series to stack. */
  stackTakesTwoSeries: string;
  /** Round charts show the composition of one series. */
  roundTakesNoSplit: string;
  /** Round charts show one measure. */
  roundTakesOneMeasure: string;
  /** A split already spends the series axis, so one measure is the budget. */
  splitTakesOneMeasure: string;
  /** Line and area draw the space between points, so the axis must be ordered. */
  lineNeedsOrderedAxis: string;
}

/** The words a non-numeric cell reads as. */
export interface ValueFormatCopy {
  booleanTrue: string;
  booleanFalse: string;
}

/**
 * The engine half's copy, in one object a host passes once.
 *
 * The React half takes its own (`ReportBuilderCopy`, `./react/copy`) because the
 * two are mounted separately — a host may run reports server-side and never
 * mount a screen.
 */
export interface ReportEngineCopy {
  spec: SpecSentenceCopy;
  labels: RenderLabelCopy;
  presentation: PresentationCopy;
  values: ValueFormatCopy;
}
