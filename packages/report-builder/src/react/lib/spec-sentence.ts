/**
 * The block's own sentence, computed in the BROWSER (FUT-755, GAP 7).
 *
 * The config panel has to say what the block it is editing asks for, and say it
 * again on every keystroke — that live feedback is the whole reason the panel
 * is docked beside the canvas rather than floating over it. The saved report,
 * the dashboard viewer and the PDF caption already carry that sentence, and it
 * is produced by ONE function: {@link specSentence} in `../../describe`.
 *
 * So this module does not write a second one. It closes the only gap between
 * that function and the client: `specSentence` reads a {@link FieldCatalog} —
 * the host's semantic model, keyed by entity and field — while the browser only
 * ever holds `ReportEntityFields[]`, the wire projection of that catalog served
 * by `GET /reports/fields`. {@link catalogFromEntities} turns the projection
 * back into the shape, and everything else here is a thin call through it.
 *
 * The alternative — a client-side sentence builder — drifts the moment either
 * side is edited, and the drift is invisible: the panel says one thing while
 * the card under it says another, and neither looks wrong on its own.
 *
 * ## What the wire keeps
 *
 * `ReportField` carries every member of {@link FieldDef} (label, type, role,
 * aggregations, format, description, values, ops and both identity floors) —
 * `listCatalogFields` in `../../catalog.ts` projects them one for one. Nothing
 * the catalog needs is missing; the only difference is that JSON has no unions,
 * so `type`, `aggregations`, `format` and `ops` arrive widened to `string`.
 * They are narrowed back below, which is a restatement of where the value came
 * from rather than an assumption about it: the server derived each one FROM the
 * union it is being narrowed to.
 */
import type { SpecSentenceCopy } from "../../copy";
import { autoTitle, specSentence } from "../../describe";
import type { ReportSpec } from "../../spec";
import type {
  Aggregation,
  EntityDef,
  FieldCatalog,
  FieldDef,
  FieldType,
  FilterOperator,
  ReportValueFormat,
} from "../../types";
import type { ReportEntityFields, ReportField, ReportSpecWire } from "../custom-reports-api";

/** One catalog field, rebuilt from the wire listing that projected it. */
function fieldDefOf(field: ReportField): FieldDef {
  return {
    label: field.label,
    type: field.type as FieldType,
    role: field.role,
    aggregations: field.aggregations as readonly Aggregation[] | undefined,
    format: field.format as ReportValueFormat | undefined,
    description: field.description,
    values: field.values,
    ops: field.ops as readonly FilterOperator[] | undefined,
    minGroupSample: field.minGroupSample,
    identityMinSample: field.identityMinSample,
  };
}

/**
 * The wire field listing, back in the shape the engine's own functions take.
 *
 * The catalog is keyed by entity id and field id because that is how a spec
 * names things; the wire sends arrays because JSON objects with dynamic keys
 * are painful to type. Re-keying is the entire conversion.
 */
export function catalogFromEntities(entities: ReportEntityFields[]): FieldCatalog {
  return {
    entities: Object.fromEntries(
      entities.map((entity): [string, EntityDef] => [
        entity.entity,
        {
          label: entity.label,
          description: entity.description,
          fields: Object.fromEntries(
            entity.fields.map((field): [string, FieldDef] => [field.field, fieldDefOf(field)]),
          ),
        },
      ]),
    ),
  };
}

/**
 * The wire spec as a {@link ReportSpec}, for DESCRIPTION only.
 *
 * Private, and it stays private. `specSentence` reads the entity, the measures,
 * the dimensions, the filters and the limit — all of which are carried here
 * faithfully — and reads neither `presentation` nor `version`, so those are
 * placeholders rather than a conversion of the wire's own (whose `numberFormat`
 * is widened to `string` and would need narrowing for nothing). A value with a
 * placeholder in it must not escape the module that knows which fields are
 * real, which is why nothing exports this.
 *
 * It deliberately does not parse: `reportSpecSchema` throws on a spec that is
 * mid-edit — a half-typed filter, a measure row with no field yet — and those
 * are exactly the moments the author is watching the sentence to see what they
 * have built so far. `specSentence` is a display function that never throws
 * (see its own doc comment), and this preserves that.
 */
function describableSpec(spec: ReportSpecWire): ReportSpec {
  return {
    version: 1,
    entity: spec.entity,
    timeZone: spec.timeZone,
    dimensions: spec.dimensions,
    measures: spec.measures.map((measure) => ({
      field: measure.field,
      aggregation: measure.aggregation as Aggregation | undefined,
      alias: measure.alias,
      denominator: measure.denominator,
      minSample: measure.minSample,
      format: measure.format as ReportValueFormat | undefined,
    })),
    filters: spec.filters.map((filter) => ({
      ...filter,
      operator: filter.operator as FilterOperator,
    })),
    sort: spec.sort,
    limit: spec.limit,
    presentation: { kind: "table" },
  };
}

/** What this block asks for, in Portuguese. No trailing period — see `describe.ts`. */
export function blockSentence(
  spec: ReportSpecWire,
  catalog: FieldCatalog,
  copy: SpecSentenceCopy,
): string {
  return specSentence(describableSpec(spec), catalog, copy);
}

/** What an untitled block is called: the same sentence, capitalised. */
export function blockAutoTitle(
  spec: ReportSpecWire,
  catalog: FieldCatalog,
  copy: SpecSentenceCopy,
): string {
  return autoTitle(describableSpec(spec), catalog, copy);
}

/** One run of the sentence: `strong` marks the terms the author chose. */
export interface SentencePart {
  text: string;
  /** False for the words `specSentence` joins clauses with, true for the rest. */
  strong: boolean;
}

/**
 * The words `specSentence` uses to JOIN clauses, longest first.
 *
 * Longest first is load-bearing: a regex alternation takes the first branch
 * that matches at a position, so `", "` listed before `", onde "` would cut
 * every clause boundary short and leave `onde ` emphasised as if it were a
 * field label.
 */
const CONNECTIVES: readonly string[] = [
  ", separado por ",
  ", dividido por ",
  ", onde ",
  ", top ",
  " por ",
  " em ",
  " e ",
  ", ",
];

const CONNECTIVE_SET: ReadonlySet<string> = new Set(CONNECTIVES);

const SPLITTER = new RegExp(
  `(${CONNECTIVES.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
);

/**
 * The sentence split into emphasised and un-emphasised runs, so the panel can
 * render `**soma de receita** em **itens vendidos** por **produto**, top **6**`
 * the way `prototype.html` does.
 *
 * A PRESENTATION pass over {@link specSentence}'s output, never a second
 * sentence: the parts concatenate back to exactly the string that went in (a
 * test pins that), so this can lose or invent no word. If `describe.ts` ever
 * joins with a phrase not listed above, the clause simply stops being bold —
 * the text stays right, which is the failure mode worth having. Bolding is also
 * approximate INSIDE a clause: a field whose label contains "e" or a comma has
 * its emphasis broken there, which costs a weight change and nothing else.
 */
export function sentenceParts(sentence: string): SentencePart[] {
  return sentence
    .split(SPLITTER)
    .filter((part) => part !== "")
    .map((part) => ({ text: part, strong: !CONNECTIVE_SET.has(part) }));
}
