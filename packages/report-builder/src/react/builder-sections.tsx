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
import { editFilterRow, operatorOptionsFor, valueOptionsFor } from "./builder-filters";
import { AGGREGATION_LABELS, aggregationOptions, editMeasureRow } from "./builder-measures";
import {
  chartOptions,
  GRAIN_LABELS,
  OPERATOR_LABELS,
  type BuilderDraft,
  type ChartKind,
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

export function DimensionsSection({ draft, fields, update }: SectionProps): JSX.Element {
  const byName = new Map(fields.map((field) => [field.field, field]));
  const setDimension = (index: number, field: string, timeGrain: ReportGrain): void => {
    const next = [...draft.dimensions];
    next[index] = { field, timeGrain };
    update({ dimensions: next.filter((dimension) => dimension.field !== "") });
  };
  const rows: Array<{ field: string; timeGrain: ReportGrain }> =
    draft.dimensions.length < 2
      ? [...draft.dimensions, { field: "", timeGrain: "day" as ReportGrain }]
      : draft.dimensions;
  return (
    <Stack spacing={1}>
      <Text variant="heading" size="xs" as="h3">
        Agrupar por
      </Text>
      {rows.map((dimension, index) => (
        <Stack key={index} direction="row" spacing={1}>
          <Select
            size="small"
            aria-label={`Dimensão ${index + 1}`}
            options={[NONE, ...fieldOptions(fields, "dimension")]}
            value={dimension.field}
            onChange={(event) =>
              setDimension(index, event.target.value as string, dimension.timeGrain)
            }
            data-testid={`builder-dimension-${index}`}
          />
          {byName.get(dimension.field)?.type === "date" ? (
            <Select
              size="small"
              aria-label="Granularidade"
              options={Object.entries(GRAIN_LABELS).map(([value, label]) => ({ value, label }))}
              value={dimension.timeGrain}
              onChange={(event) =>
                setDimension(index, dimension.field, event.target.value as ReportGrain)
              }
              data-testid={`builder-grain-${index}`}
            />
          ) : null}
        </Stack>
      ))}
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

export function FiltersSection({ draft, fields, update }: SectionProps): JSX.Element {
  const byName = new Map(fields.map((field) => [field.field, field]));
  const setFilter = (index: number, patch: Partial<BuilderDraft["filters"][number]>): void => {
    update({ filters: editFilterRow(draft, index, patch, byName) });
  };
  return (
    <Stack spacing={1}>
      <Text variant="heading" size="xs" as="h3">
        Filtros
      </Text>
      {draft.filters.map((filter, index) => {
        const field = byName.get(filter.field);
        // A closed-set field is PICKED, never typed: the author chooses "Pago"
        // and the spec stores `PAID`. Typing the code was the largest source of
        // silently-empty blocks — a typo compiles and matches no rows, so the
        // block reads as "no data" rather than as the mistake it is.
        const valueOptions = valueOptionsFor(field);
        return (
          <Stack key={index} direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Select
              size="small"
              aria-label={`Filtro ${index + 1} — campo`}
              options={[NONE, ...fieldOptions(fields)]}
              value={filter.field}
              onChange={(event) => setFilter(index, { field: event.target.value as string })}
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
              onChange={(event) => setFilter(index, { operator: event.target.value as string })}
              data-testid={`builder-filter-operator-${index}`}
            />
            {valueOptions ? (
              <Select
                size="small"
                aria-label={`Filtro ${index + 1} — valor`}
                options={valueOptions}
                value={filter.value}
                onChange={(event) => setFilter(index, { value: event.target.value as string })}
                data-testid={`builder-filter-value-${index}`}
              />
            ) : (
              <Input
                size="sm"
                aria-label={`Filtro ${index + 1} — valor`}
                value={filter.value}
                onChange={(event) => setFilter(index, { value: event.target.value })}
                data-testid={`builder-filter-value-${index}`}
              />
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => update({ filters: draft.filters.filter((_, i) => i !== index) })}
              aria-label={`Remover filtro ${index + 1}`}
            >
              Remover
            </Button>
          </Stack>
        );
      })}
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
  // shape (FUT-308); unavailable charts stay visible but disabled. The hint
  // explains the SELECTED option's blocking rule only — a valid selection
  // shows no hint (reasons for other options would just mislead).
  const options = chartOptions(draft, new Map(fields.map((field) => [field.field, field])));
  const blockedHint =
    options.find((option) => option.value === draft.chartType)?.disabledReason ?? null;
  return (
    <Stack spacing={1}>
      <Text variant="heading" size="xs" as="h3">
        Visualização
      </Text>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Select
          size="small"
          aria-label="Tipo de visualização"
          options={options.map((option) => ({
            value: option.value,
            label: option.label,
            disabled: option.disabledReason !== null,
          }))}
          value={draft.chartType}
          onChange={(event) => update({ chartType: event.target.value as ChartKind })}
          data-testid="builder-chart-type"
        />
        {draft.chartType === "bar" || draft.chartType === "area" ? (
          <Button
            variant={draft.stacked ? "solid" : "outline"}
            size="sm"
            onClick={() => update({ stacked: !draft.stacked })}
            aria-pressed={draft.stacked}
          >
            Empilhado
          </Button>
        ) : null}
      </Stack>
      {blockedHint ? (
        <Text variant="body" size="xs" color="secondary">
          {blockedHint}
        </Text>
      ) : null}
    </Stack>
  );
}
