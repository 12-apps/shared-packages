/**
 * Builder v1 draft model (FUT-138): the form-based composer's editable state
 * and its mapping to/from the declarative ReportSpec. Pure functions — the
 * page owns state, the server owns validation.
 */
import type { PresentationCopy } from "../copy";
import {
  defaultPresentation,
  isOrderedDimension,
  presentationCompatibility,
  stackedCompatibility,
  type SpecShape,
} from "../compatibility";

import { filterFromWire, filterToWire } from "./builder-filters";
import { measureOptions, measureSortKey, type MeasureDraft } from "./builder-measures";
import type { ReportEntityFields, ReportField, ReportSpecWire } from "./custom-reports-api";
import type { PublishDraft } from "./lib/publish-section";
import type { ReportGrain } from "./reports-api";

export interface DimensionDraft {
  field: string;
  timeGrain: ReportGrain;
}

/**
 * One filter row. It carries all three of the spec's value shapes
 * (`spec.ts:32-46`) rather than a single `value`, because holding one value is
 * precisely what made `in` and `between` unofferable — a row that can express
 * one value can only serialize the four operators that take one.
 * `builder-filters` keeps exactly one shape populated per row and maps it to
 * the arity `reportFilterSchema` demands.
 */
export interface FilterDraft {
  field: string;
  operator: string;
  /** `eq` / `neq` / `gte` / `lte`: the single compared value. */
  value: string;
  /** `in`: the picked set, as the codes the spec stores. */
  values?: string[];
  /** `between`: the inclusive bounds. Both or neither — one alone is a 400. */
  from?: string;
  to?: string;
}

export type ChartKind = "table" | "kpi" | "line" | "bar" | "area" | "pie" | "donut";

export interface BuilderDraft {
  name: string;
  description: string;
  entity: string;
  /**
   * Pass-through tenant time zone (FUT-454): the form doesn't offer it, but
   * dropping it on re-save would silently re-bucket every date in the report.
   */
  timeZone?: string;
  dimensions: DimensionDraft[];
  measures: MeasureDraft[];
  filters: FilterDraft[];
  /**
   * Pass-through ordering/cap (FUT-308): the form doesn't edit these yet,
   * but a starter or MCP-authored spec opened here must not lose its
   * top-N semantics on save. Sort entries whose key no longer resolves to
   * a current measure are dropped at serialization.
   */
  sort: Array<{ by: string; direction: "asc" | "desc" }>;
  limit?: number;
  /** Pass-through KPI options (label/format aren't editable in the form yet). */
  kpiOptions?: { label?: string; numberFormat?: string };
  chartType: ChartKind;
  stacked: boolean;
}

export const OPERATOR_LABELS: Record<string, string> = {
  eq: "igual a",
  neq: "diferente de",
  in: "é um de",
  gte: "a partir de",
  lte: "até",
  between: "entre",
};

/**
 * `prototype.html`'s own words, verbatim. `kpi` was "KPI (número único)" here:
 * a parenthetical three times the length of every other label, which is what
 * forced the picker's tiles onto a ragged grid — one cell wide enough for the
 * sentence and the rest not. The prototype calls it `Número`.
 */
const CHART_LABELS: Record<ChartKind, string> = {
  table: "Tabela",
  kpi: "Número",
  line: "Linha",
  bar: "Barras",
  area: "Área",
  pie: "Pizza",
  donut: "Rosca",
};

export const GRAIN_LABELS: Record<ReportGrain, string> = {
  day: "Dia",
  week: "Semana",
  month: "Mês",
};

function emptyDraft(entity: string): BuilderDraft {
  return {
    name: "",
    description: "",
    entity,
    dimensions: [],
    measures: [{ field: "", aggregation: "sum" }],
    filters: [],
    sort: [],
    chartType: "table",
    stacked: false,
  };
}

/**
 * Pre-save guard for the publish controls (FUT-307): role-based sharing
 * with an EMPTY allowlist is almost always the roles catalog having failed
 * to load (or an oversight) — either way the document would be visible to
 * nobody beyond author+admins, which "Somente autor e admins" already says
 * honestly. Block the save with an actionable message instead.
 */
export function publishGuardError(publish: PublishDraft): string | null {
  if (publish.visibility === "roles" && publish.visibilityRoles.length === 0) {
    return "Escolha ao menos uma função para compartilhar — ou mude a visibilidade para 'Somente autor e admins'.";
  }
  return null;
}

/**
 * A NEW report's draft for an entity: its starter spec when the catalog
 * ships one (FUT-308 smart default — a runnable report on first render),
 * an empty form otherwise. Name/description stay the author's.
 */
export function starterDraft(entity: ReportEntityFields | undefined, fallback: string): BuilderDraft {
  if (!entity?.starter) return emptyDraft(entity?.entity ?? fallback);
  return draftFromSpec("", "", entity.starter);
}

/**
 * Switching entity resets the form to the new entity's starter (FUT-308) —
 * the old fields wouldn't compile anyway. Name/description stay the
 * author's.
 */
export function switchEntityDraft(
  draft: BuilderDraft,
  entities: ReportEntityFields[],
  nextEntity: string,
): BuilderDraft {
  return {
    ...starterDraft(
      entities.find((candidate) => candidate.entity === nextEntity),
      nextEntity,
    ),
    name: draft.name,
    description: draft.description,
  };
}

/** The chart-rule facts of the current form state (FUT-308). */
function draftShape(draft: BuilderDraft, fields: Map<string, ReportField>): SpecShape {
  const dimensions = draft.dimensions.filter((dimension) => dimension.field !== "");
  const measures = draft.measures.filter((measure) => measure.field !== "");
  return {
    dimensionCount: dimensions.length,
    // An all-blank measure list still submits as 1 (the spec minimum).
    measureCount: Math.max(measures.length, 1),
    // `/reports/fields` sends `ordered` for the string dimensions that carry an
    // ordinal (FUT-755); `isOrderedDimension` reads it STRUCTURALLY, so a
    // response predating the field — a cached one — falls back to the type rule
    // and offers bars, which is the pre-FUT-755 behaviour everywhere except an
    // hour or weekday axis.
    firstDimensionIsOrdered: isOrderedDimension(fields.get(dimensions[0]?.field ?? "")),
  };
}

/** The visualization picker's options — compiler-invalid ones disabled. */
export function chartOptions(
  draft: BuilderDraft,
  fields: Map<string, ReportField>,
  copy: PresentationCopy,
): Array<{ value: ChartKind; label: string; disabledReason: string | null }> {
  return presentationCompatibility(draftShape(draft, fields), copy).map((entry) => ({
    value: entry.option,
    label: CHART_LABELS[entry.option],
    disabledReason: entry.disabledReason,
  }));
}

/**
 * Whether the form should draw `Empilhado`, and why it is refused (FUT-755).
 *
 * `null` means the current visualization has no stacking to offer at all — a
 * pie draws no toggle, which is a different answer from a toggle that is on
 * screen and blocked. An object means the toggle is drawn, with its reason.
 */
export function stackedOption(
  draft: BuilderDraft,
  fields: Map<string, ReportField>,
  copy: PresentationCopy,
): { disabledReason: string | null } | null {
  if (draft.chartType === "table" || draft.chartType === "kpi") return null;
  const entry = stackedCompatibility(draft.chartType, draftShape(draft, fields), copy);
  return entry === null ? null : { disabledReason: entry.disabledReason };
}

/**
 * Keep the presentation compiler-valid as the form changes (FUT-308): when
 * an edit invalidates the picked chart (e.g. a second grouping while on
 * pie), fall back to the shape's smart default instead of letting the save
 * bounce with a 400.
 */
export function withValidChart(
  draft: BuilderDraft,
  fields: Map<string, ReportField>,
  copy: PresentationCopy,
): BuilderDraft {
  const shape = draftShape(draft, fields);
  const current = presentationCompatibility(shape, copy).find(
    (entry) => entry.option === draft.chartType,
  );
  if (!current || current.disabledReason === null) return draft;
  const picked = defaultPresentation(shape);
  return { ...draft, chartType: picked.kind === "chart" ? picked.chartType : picked.kind };
}

/**
 * The output names the compiler will derive for the current form state —
 * a pass-through sort entry survives only while its key still resolves
 * (mirrors the compiler's alias derivation).
 */
function resolvableSortKeys(
  dimensions: Array<{ field: string; timeGrain?: ReportGrain }>,
  measures: MeasureDraft[],
): Set<string> {
  const keys = new Set<string>();
  for (const dimension of dimensions) {
    keys.add(dimension.timeGrain ? `${dimension.field}_${dimension.timeGrain}` : dimension.field);
  }
  for (const measure of measures) {
    keys.add(measureSortKey(measure));
  }
  return keys;
}

/**
 * The suppression floor the server will demand of this draft (FUT-454): the
 * highest `minGroupSample` of any identity field the form GROUPS BY or FILTERS
 * ON, or 0 when it touches none.
 *
 * The builder cannot author `minSample` — it only carries one through — so
 * without this a user who picks "Cozinheiro" in the dimension list would get a
 * 400 from `compileReport` and no way to satisfy it from the form. Applying
 * the catalog's own floor makes the only spec the form can produce for an
 * identity dimension the suppressed one, which is the same answer the server
 * would give.
 */
function identityFloor(
  draft: BuilderDraft,
  fields: Map<string, ReportField>,
): number {
  const referenced = [
    ...draft.dimensions.map((dimension) => dimension.field),
    ...draft.filters.map((filter) => filter.field),
  ];
  return referenced.reduce(
    (floor, field) => Math.max(floor, fields.get(field)?.minGroupSample ?? 0),
    0,
  );
}

/** Assemble the spec the run/save endpoints validate. */
export function specFromDraft(
  draft: BuilderDraft,
  fields: Map<string, ReportField>,
): ReportSpecWire {
  const floor = identityFloor(draft, fields);
  const dimensions = draft.dimensions
    .filter((dimension) => dimension.field !== "")
    .map((dimension) => {
      const field = fields.get(dimension.field);
      return field?.type === "date"
        ? { field: dimension.field, timeGrain: dimension.timeGrain }
        : { field: dimension.field };
    });
  const measures = draft.measures
    .filter((measure) => measure.field !== "")
    .map((measure) => {
      const options = measureOptions(measure);
      return {
        field: measure.field,
        aggregation: measure.aggregation,
        ...(measure.alias ? { alias: measure.alias } : {}),
        ...options,
        // Never LOWERS a floor the spec already carries — a preset opened in
        // the builder keeps the stricter of the two.
        ...(floor > 0 ? { minSample: Math.max(options.minSample ?? 0, floor) } : {}),
      };
    });
  // A row still being filled in serializes to NOTHING rather than to a spec
  // the schema rejects — see `filterToWire` for the arity each operator needs.
  const filters = draft.filters.flatMap((filter) =>
    filterToWire(filter, fields.get(filter.field)),
  );
  const sortKeys = resolvableSortKeys(dimensions, draft.measures);
  return {
    entity: draft.entity,
    ...(draft.timeZone ? { timeZone: draft.timeZone } : {}),
    dimensions,
    measures,
    filters,
    sort: draft.sort.filter((entry) => sortKeys.has(entry.by)),
    ...(draft.limit !== undefined ? { limit: draft.limit } : {}),
    presentation:
      draft.chartType === "table"
        ? { kind: "table" }
        : draft.chartType === "kpi"
          ? { kind: "kpi", ...(draft.kpiOptions ?? {}) }
          : {
              kind: "chart",
              chartType: draft.chartType,
              ...(draft.chartType === "bar" || draft.chartType === "area"
                ? { stacked: draft.stacked }
                : {}),
            },
  };
}

/** The form's picker value for a stored presentation. */
function draftChartKind(presentation: ReportSpecWire["presentation"]): ChartKind {
  if (presentation.kind === "chart") return presentation.chartType;
  return presentation.kind === "kpi" ? "kpi" : "table";
}

/** KPI label/format pass-through (the form doesn't edit them yet). */
function draftKpiOptions(
  presentation: ReportSpecWire["presentation"],
): Pick<BuilderDraft, "kpiOptions"> {
  if (presentation.kind !== "kpi") return {};
  const options = {
    ...(presentation.label !== undefined ? { label: presentation.label } : {}),
    ...(presentation.numberFormat !== undefined
      ? { numberFormat: presentation.numberFormat }
      : {}),
  };
  return Object.keys(options).length > 0 ? { kpiOptions: options } : {};
}

/** Rebuild the editable draft from a stored spec (the edit flow). */
export function draftFromSpec(
  name: string,
  description: string | null,
  spec: ReportSpecWire,
): BuilderDraft {
  const presentation = spec.presentation;
  return {
    name,
    description: description ?? "",
    entity: spec.entity,
    ...(spec.timeZone ? { timeZone: spec.timeZone } : {}),
    dimensions: spec.dimensions.map((dimension) => ({
      field: dimension.field,
      timeGrain: dimension.timeGrain ?? "day",
    })),
    measures: spec.measures.map((measure) => ({
      field: measure.field,
      aggregation: measure.aggregation ?? "sum",
      ...(measure.alias ? { alias: measure.alias } : {}),
      ...measureOptions(measure),
    })),
    filters: spec.filters.flatMap(filterFromWire),
    sort: (spec.sort ?? []).map((entry) => ({ by: entry.by, direction: entry.direction })),
    ...(spec.limit !== undefined ? { limit: spec.limit } : {}),
    ...draftKpiOptions(presentation),
    chartType: draftChartKind(presentation),
    stacked: presentation.kind === "chart" ? (presentation.stacked ?? false) : false,
  };
}
