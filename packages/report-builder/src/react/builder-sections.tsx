/**
 * Builder v1 form sections (FUT-138): dimension/measure/filter rows and the
 * presentation picker. Dumb controlled components — the page owns the draft.
 */
import type { JSX } from "react";

import { Button } from "@12-apps/ui/form/Button";
import { Input } from "@12-apps/ui/form/Input";
import { Select } from "@12-apps/ui/form/Select";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import type { ReportField } from "./custom-reports-api";
import { dimensionAt, withDimension } from "./builder-dimensions";
import { VizPicker } from "./viz-picker";
import { editFilterRow, operatorOptionsFor, valueOptionsFor } from "./builder-filters";
import { AGGREGATION_LABELS, aggregationOptions, editMeasureRow } from "./builder-measures";
import {
  chartOptions,
  GRAIN_LABELS,
  OPERATOR_LABELS,
  type BuilderDraft,
} from "./builder-model";
import type { ReportGrain } from "./reports-api";

type Patch = (patch: Partial<BuilderDraft>) => void;

interface SectionProps {
  draft: BuilderDraft;
  fields: ReportField[];
  update: Patch;
}

const NONE = { value: "", label: "(nenhuma)" };

function fieldOptions(fields: ReportField[], role?: ReportField["role"]): Array<{ value: string; label: string }> {
  return fields
    .filter((field) => (role ? field.role === role : true))
    .map((field) => ({ value: field.field, label: field.label }));
}

/** The X axis, plus its granularity when the field is a date. */
export function GroupBySection({ draft, fields, update }: SectionProps): JSX.Element {
  const byName = new Map(fields.map((field) => [field.field, field]));
  const dimension = dimensionAt(draft, 0);
  return (
    <Stack spacing={1}>
      <Text variant="heading" size="xs" as="h3">
        Agrupar por
      </Text>
      <Stack direction="row" spacing={1}>
        <Select
          size="small"
          label="Eixo X"
          options={[NONE, ...fieldOptions(fields, "dimension")]}
          value={dimension.field}
          onChange={(event) => update(withDimension(draft, 0, { field: event.target.value as string }))}
          data-testid="builder-dimension-0"
        />
        {byName.get(dimension.field)?.type === "date" ? (
          <Select
            size="small"
            label="Por"
            options={Object.entries(GRAIN_LABELS).map(([value, label]) => ({ value, label }))}
            value={dimension.timeGrain}
            onChange={(event) =>
              update(withDimension(draft, 0, { timeGrain: event.target.value as ReportGrain }))
            }
            data-testid="builder-grain-0"
          />
        ) : null}
      </Stack>
    </Stack>
  );
}

/**
 * The series split — its own section because it changes the SHAPE of the
 * result (one series per value), not just how rows are bucketed. Sitting it
 * beside the axis in one row said the two were the same kind of choice.
 */
export function SplitBySection({ draft, fields, update }: SectionProps): JSX.Element {
  const axis = dimensionAt(draft, 0);
  return (
    <Stack spacing={1}>
      <Text variant="heading" size="xs" as="h3">
        Separar em séries
      </Text>
      <Select
        size="small"
        label="Uma série por"
        // Splitting without grouping has nothing to split, so the control is
        // disabled with the reason rather than silently producing nothing.
        disabled={axis.field === ""}
        helperText={axis.field === "" ? "Escolha um agrupamento primeiro." : undefined}
        options={[NONE, ...fieldOptions(fields, "dimension")]}
        value={dimensionAt(draft, 1).field}
        onChange={(event) => update(withDimension(draft, 1, { field: event.target.value as string }))}
        data-testid="builder-dimension-1"
      />
    </Stack>
  );
}

export function MeasuresSection({ draft, fields, update }: SectionProps): JSX.Element {
  const byName = new Map(fields.map((field) => [field.field, field]));
  const setMeasure = (index: number, field: string, aggregation: string): void => {
    update(editMeasureRow(draft, index, field, aggregation, byName.get(field)));
  };
  return (
    <Stack spacing={1}>
      <Text variant="heading" size="xs" as="h3">
        Medidas
      </Text>
      {draft.measures.map((measure, index) => (
        <Stack key={index} direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Select
            size="small"
            aria-label={`Medida ${index + 1}`}
            options={fieldOptions(fields)}
            value={measure.field}
            onChange={(event) => setMeasure(index, event.target.value as string, measure.aggregation)}
            data-testid={`builder-measure-${index}`}
          />
          <Select
            size="small"
            aria-label="Agregação"
            options={aggregationOptions(byName.get(measure.field)).map((aggregation) => ({
              value: aggregation,
              label: AGGREGATION_LABELS[aggregation] ?? aggregation,
            }))}
            value={measure.aggregation}
            onChange={(event) => setMeasure(index, measure.field, event.target.value as string)}
            data-testid={`builder-aggregation-${index}`}
          />
          {draft.measures.length > 1 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => update({ measures: draft.measures.filter((_, i) => i !== index) })}
              aria-label={`Remover medida ${index + 1}`}
            >
              Remover
            </Button>
          ) : null}
        </Stack>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() => update({ measures: [...draft.measures, { field: "", aggregation: "sum" }] })}
        data-testid="builder-add-measure"
      >
        + Medida
      </Button>
    </Stack>
  );
}

/**
 * One filter row: field, condition, value, remove.
 *
 * The VALUE control is the point of FUT-391. A closed-set field is PICKED —
 * the author chooses "Pago" and the spec stores `PAID`. Typing the code was the
 * largest source of silently-empty blocks: a typo compiles and matches no rows,
 * so the block reads as "no data" rather than as the mistake it is.
 */
function FilterRow({
  filter,
  index,
  fields,
  field,
  onPatch,
  onRemove,
}: {
  filter: BuilderDraft["filters"][number];
  index: number;
  fields: ReportField[];
  field: ReportField | undefined;
  onPatch: (patch: Partial<BuilderDraft["filters"][number]>) => void;
  onRemove: () => void;
}): JSX.Element {
  const valueOptions = valueOptionsFor(field);
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
      <Select
        size="small"
        aria-label={`Filtro ${index + 1} — campo`}
        options={[NONE, ...fieldOptions(fields)]}
        value={filter.field}
        onChange={(event) => onPatch({ field: event.target.value as string })}
        data-testid={`builder-filter-field-${index}`}
      />
      <Select
        size="small"
        aria-label={`Filtro ${index + 1} — condição`}
        // Only the operators the FIELD accepts: "status a partir de Pago"
        // compiles and orders enum codes alphabetically, which is noise.
        options={operatorOptionsFor(field).map((value) => ({
          value,
          label: OPERATOR_LABELS[value] ?? value,
        }))}
        value={filter.operator}
        onChange={(event) => onPatch({ operator: event.target.value as string })}
        data-testid={`builder-filter-operator-${index}`}
      />
      {valueOptions ? (
        <Select
          size="small"
          aria-label={`Filtro ${index + 1} — valor`}
          options={valueOptions}
          value={filter.value}
          onChange={(event) => onPatch({ value: event.target.value as string })}
          data-testid={`builder-filter-value-${index}`}
        />
      ) : (
        <Input
          size="sm"
          aria-label={`Filtro ${index + 1} — valor`}
          value={filter.value}
          onChange={(event) => onPatch({ value: event.target.value })}
          data-testid={`builder-filter-value-${index}`}
        />
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={onRemove}
        aria-label={`Remover filtro ${index + 1}`}
      >
        Remover
      </Button>
    </Stack>
  );
}

export function FiltersSection({ draft, fields, update }: SectionProps): JSX.Element {
  const byName = new Map(fields.map((field) => [field.field, field]));
  return (
    <Stack spacing={1}>
      <Text variant="heading" size="xs" as="h3">
        Filtros
      </Text>
      {draft.filters.map((filter, index) => (
        <FilterRow
          key={index}
          filter={filter}
          index={index}
          fields={fields}
          field={byName.get(filter.field)}
          onPatch={(patch) => update({ filters: editFilterRow(draft, index, patch, byName) })}
          onRemove={() => update({ filters: draft.filters.filter((_, i) => i !== index) })}
        />
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          update({ filters: [...draft.filters, { field: "", operator: "eq", value: "" }] })
        }
        data-testid="builder-add-filter"
      >
        + Filtro
      </Button>
    </Stack>
  );
}

export function PresentationSection({ draft, fields, update }: SectionProps): JSX.Element {
  // The picker offers only what the compiler accepts for the current form
  // shape (FUT-308). Blocked options now state their REASON rather than going
  // grey (FUT-391): grey says "no" without saying why, leaving the author to
  // guess which of their choices caused it when the compiler already knows.
  const options = chartOptions(draft, new Map(fields.map((field) => [field.field, field])));
  return (
    <Stack spacing={1}>
      <Text variant="heading" size="xs" as="h3">
        Visualização
      </Text>
      <VizPicker
        options={options}
        value={draft.chartType}
        onChange={(chartType) => update({ chartType })}
      />
      {draft.chartType === "bar" || draft.chartType === "area" ? (
        <Button
          variant={draft.stacked ? "solid" : "outline"}
          size="sm"
          onClick={() => update({ stacked: !draft.stacked })}
          aria-pressed={draft.stacked}
          data-testid="builder-chart-stacked"
        >
          Empilhado
        </Button>
      ) : null}
    </Stack>
  );
}
