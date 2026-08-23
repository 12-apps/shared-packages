/**
 * Builder v1 form sections (FUT-138): dimension/measure/filter rows and the
 * presentation picker. Dumb controlled components — the page owns the draft.
 */
import { useState, type JSX } from "react";

import { Alert } from "@12-apps/ui/data-display/Alert";
import { Button } from "@12-apps/ui/form/Button";
import { Select } from "@12-apps/ui/form/Select";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import type { ReportField } from "./custom-reports-api";
import { dimensionAt, withDimension } from "./builder-dimensions";
import { VizPicker } from "./viz-picker";
import { editFilterRow } from "./builder-filters";
import { FilterRow } from "./builder-filter-row";
import { aggregationLabel, aggregationOptions, editMeasureRow } from "./builder-measures";
import { chartOptions, grainLabel, stackedOption, type BuilderDraft } from "./builder-model";
import { REPORT_GRAINS, type ReportGrain as GrainId } from "./reports-api";
import { SECTION_LABEL_STYLE } from "./lib/report-surface";
import type { ReportGrain } from "./reports-api";
import { useReportCopy, useReportEngineCopy } from "./transport-context";

type Patch = (patch: Partial<BuilderDraft>) => void;

interface SectionProps {
  draft: BuilderDraft;
  fields: ReportField[];
  update: Patch;
}

const NONE = { value: "", label: "(nenhuma)" };

/** A section's heading, at the one level every section in this form uses. */
function SectionHeading({ children }: { children: string }): JSX.Element {
  return (
    <Text variant="heading" size="xs" color="secondary" as="h3" style={SECTION_LABEL_STYLE}>
      {children}
    </Text>
  );
}

function fieldOptions(fields: ReportField[], role?: ReportField["role"]): Array<{ value: string; label: string }> {
  return fields
    .filter((field) => (role ? field.role === role : true))
    .map((field) => ({ value: field.field, label: field.label }));
}

/** The X axis, plus its granularity when the field is a date. */
export function GroupBySection({ draft, fields, update }: SectionProps): JSX.Element {
  const ranges = useReportCopy().screens.ranges;
  const copy = useReportCopy().screens.builder;
  const byName = new Map(fields.map((field) => [field.field, field]));
  const dimension = dimensionAt(draft, 0);
  return (
    <Stack spacing={1}>
      <SectionHeading>{copy.groupBy}</SectionHeading>
      <Stack direction="row" spacing={1}>
        <Select
          size="sm"
          label={copy.axisLabel}
          options={[NONE, ...fieldOptions(fields, "dimension")]}
          value={dimension.field}
          onChange={(event) => update(withDimension(draft, 0, { field: event.target.value as string }))}
          data-testid="builder-dimension-0"
        />
        {byName.get(dimension.field)?.type === "date" ? (
          <Select
            size="sm"
            label={copy.grainLabel}
            options={REPORT_GRAINS.map((value: GrainId) => ({ value, label: grainLabel(value, ranges) }))}
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
  const copy = useReportCopy().screens.builder;
  const axis = dimensionAt(draft, 0);
  return (
    <Stack spacing={1}>
      <SectionHeading>{copy.splitSeries}</SectionHeading>
      <Select
        size="sm"
        label={copy.seriesBy}
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
  const copy = useReportCopy().screens.builder;
  const byName = new Map(fields.map((field) => [field.field, field]));
  const setMeasure = (index: number, field: string, aggregation: string): void => {
    update(editMeasureRow(draft, index, field, aggregation, byName.get(field)));
  };
  return (
    <Stack spacing={1}>
      <SectionHeading>{copy.measuresHeading}</SectionHeading>
      {draft.measures.map((measure, index) => (
        <Stack key={index} direction="row" spacing={1} sx={{ alignItems: "center" }}>
          {/* Both a visible `label` and an `aria-label` (FUT-755). The visible
              one is what makes this field the same SHAPE as every other field
              in the column — `visual-pass.md` §Components asks for one field
              style, and a notch-less select beside a floating-label one is two.
              The `aria-label` stays because it says WHICH measure this is;
              MUI's own name would otherwise be the current value. */}
          <Select
            size="sm"
            label={`Medida ${index + 1}`}
            aria-label={`Medida ${index + 1}`}
            options={fieldOptions(fields)}
            value={measure.field}
            onChange={(event) => setMeasure(index, event.target.value as string, measure.aggregation)}
            data-testid={`builder-measure-${index}`}
          />
          <Select
            size="sm"
            label={copy.aggregation}
            aria-label={copy.aggregation}
            options={aggregationOptions(byName.get(measure.field)).map((aggregation) => ({
              value: aggregation,
              label: aggregationLabel(aggregation, copy),
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
              aria-label={copy.removeMeasure(index + 1)}
            >
              {copy.remove}
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
  const copy = useReportCopy().screens.builder;
  const byName = new Map(fields.map((field) => [field.field, field]));
  const options = [NONE, ...fieldOptions(fields)];
  return (
    <Stack spacing={1}>
      <SectionHeading>{copy.filtersHeading}</SectionHeading>
      {draft.filters.map((filter, index) => (
        <FilterRow
          key={index}
          filter={filter}
          index={index}
          fieldOptions={options}
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

/** The `Empilhado` button and its callout — one id each, unchanged from before. */
const STACKED_TEST_ID = "builder-chart-stacked";

/** A blocked control reads as unavailable without leaving the tab order. */
const STACKED_BLOCKED_SX = { opacity: 0.45, cursor: "not-allowed" } as const;

/**
 * `Empilhado`, and the reason it is refused (FUT-755).
 *
 * Stacking one series redraws an identical chart — the same class of defect as
 * a line over a categorical axis: a control that claims to do something it
 * cannot. So it is refused when there is nothing to stack, and it is refused the
 * way every blocked control in this area is — `aria-disabled`, never `disabled`.
 * A genuinely disabled button leaves the tab order and swallows pointer events,
 * which would put the explanation behind an interaction the very people who
 * need it cannot perform. The click is a no-op that explains itself instead.
 *
 * The reason is reachable the same four ways `VizPicker`'s are: hover, keyboard
 * focus, activation, and — with no event at all — as the control's accessible
 * description through `title`.
 */
function StackedToggle({
  stacked,
  disabledReason,
  onToggle,
}: {
  stacked: boolean;
  disabledReason: string | null;
  onToggle: () => void;
}): JSX.Element {
  const copy = useReportCopy().screens.builder;
  const [asking, setAsking] = useState(false);
  const blocked = disabledReason !== null;
  const showing = blocked && asking;
  return (
    <Stack spacing={1}>
      <Button
        variant={stacked ? "solid" : "outline"}
        size="sm"
        aria-disabled={blocked || undefined}
        aria-pressed={stacked}
        title={disabledReason ?? undefined}
        aria-describedby={showing ? `${STACKED_TEST_ID}-reason` : undefined}
        sx={blocked ? STACKED_BLOCKED_SX : undefined}
        onClick={() => (blocked ? setAsking(true) : onToggle())}
        onMouseEnter={() => setAsking(true)}
        onMouseLeave={() => setAsking(false)}
        onFocus={() => setAsking(true)}
        onBlur={() => setAsking(false)}
        data-testid={STACKED_TEST_ID}
      >
        {copy.stacked}
      </Button>
      {/* One callout, only when asked for — `role="note"` and no live region,
          because the button already carries this same sentence as its
          description and a polite region would say it twice. */}
      {showing ? (
        <Alert
          variant="warning"
          showIcon={false}
          animate={false}
          role="note"
          aria-live="off"
          tabIndex={-1}
          id={`${STACKED_TEST_ID}-reason`}
          data-testid={`${STACKED_TEST_ID}-reason`}
          sx={{ fontSize: "0.75rem", py: 0.5 }}
        >
          {disabledReason}
        </Alert>
      ) : null}
    </Stack>
  );
}

export function PresentationSection({ draft, fields, update }: SectionProps): JSX.Element {
  // The picker offers only what the compiler accepts for the current form
  // shape (FUT-308). Blocked options now state their REASON rather than going
  // grey (FUT-391): grey says "no" without saying why, leaving the author to
  // guess which of their choices caused it when the compiler already knows.
  const byName = new Map(fields.map((field) => [field.field, field]));
  const copy = useReportEngineCopy();
  const words = useReportCopy().screens.builder;
  const stacking = stackedOption(draft, byName, copy.presentation);
  return (
    <Stack spacing={1}>
      <SectionHeading>{words.visualization}</SectionHeading>
      <VizPicker
        options={chartOptions(draft, byName, copy.presentation, words)}
        value={draft.chartType}
        onChange={(chartType) => update({ chartType })}
      />
      {stacking !== null ? (
        <StackedToggle
          stacked={draft.stacked}
          disabledReason={stacking.disabledReason}
          onToggle={() => update({ stacked: !draft.stacked })}
        />
      ) : null}
    </Stack>
  );
}
