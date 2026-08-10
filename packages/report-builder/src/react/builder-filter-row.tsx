/**
 * The filter row of the builder form (FUT-391 / FUT-755): its value controls
 * and its two/three-line layout. Split out of `builder-sections` so that file
 * stays about the SECTIONS while this one stays about a single row — the row
 * grew a control per value shape when `in` and `between` became expressible.
 *
 * Dumb controlled components: the page owns the draft, `builder-filters` owns
 * the rules.
 */
import type { JSX } from "react";

import { Button } from "@12-apps/ui/form/Button";
import { Input } from "@12-apps/ui/form/Input";
import { Select } from "@12-apps/ui/form/Select";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";

import {
  joinValueList,
  operatorOptionsFor,
  pickedLabels,
  splitValueList,
  toStringList,
  valueOptionsFor,
  valueShapeFor,
} from "./builder-filters";
import { OPERATOR_LABELS, type BuilderDraft } from "./builder-model";
import type { ReportField } from "./custom-reports-api";
import { CloseIcon } from "./lib/block-icons";

type FilterDraftRow = BuilderDraft["filters"][number];
type FilterPatch = (patch: Partial<FilterDraftRow>) => void;

type ValueOptions = Array<{ value: string; label: string }> | null;

interface ValueFieldProps {
  label: string;
  testId: string;
  options: ValueOptions;
}

/**
 * The VISIBLE half of a row's label: "Filtro 1 — condição" → "Condição".
 *
 * Every control in this panel is a floating-label field now, because one column
 * holding both notched and notch-less fields is the "two design languages"
 * failure `visual-pass.md` ranks third and its §Components rule forbids.
 *
 * These four could not simply SHOW their full label: the operator sits in a
 * fixed 104px box, and a legend reading `Filtro 1 — con…` is the truncation
 * this panel was built to end. So the accessible name keeps the index — it is
 * what tells a screen-reader user which row they are in, and what the panel's
 * own suite asserts — and the notch carries the part the position does not.
 */
function visibleLabel(label: string): string {
  const tail = label.split("—").pop()?.trim() ?? label;
  return tail.charAt(0).toUpperCase() + tail.slice(1);
}

/**
 * ONE value a filter compares against — the row's `valor`, or one bound of a
 * `between`.
 *
 * This control is the point of FUT-391. A closed-set field is PICKED — the
 * author chooses "Pago" and the spec stores `PAID`. Typing the code was the
 * largest source of silently-empty blocks: a typo compiles and matches no rows,
 * so the block reads as "no data" rather than as the mistake it is.
 */
function FilterValueField({
  label,
  testId,
  options,
  value,
  placeholder,
  onChange,
}: ValueFieldProps & {
  value: string;
  placeholder?: string;
  onChange: (next: string) => void;
}): JSX.Element {
  return options ? (
    <Select
      size="sm"
      label={visibleLabel(label)}
      aria-label={label}
      options={options}
      value={value}
      onChange={(event) => onChange(String(event.target.value))}
      data-testid={testId}
    />
  ) : (
    <Input
      size="sm"
      label={visibleLabel(label)}
      aria-label={label}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      data-testid={testId}
    />
  );
}

/**
 * `in` — the whole set at once. A closed-set field is MULTI-picked, which is
 * the same promise the single-value control makes: the author never types a
 * stored code. `renderValue` shows the LABELS, because MUI's default joins the
 * raw `PAID, FAILED`. A field with no closed set has nothing to pick from, so
 * it falls back to one comma-separated line.
 */
function FilterListField({
  label,
  testId,
  options,
  values,
  onChange,
}: ValueFieldProps & {
  values: string[];
  onChange: (next: string[]) => void;
}): JSX.Element {
  return options ? (
    <Select
      multiple
      size="sm"
      label={visibleLabel(label)}
      aria-label={label}
      options={options}
      value={values}
      renderValue={(selected) => pickedLabels(selected, options)}
      onChange={(event) => onChange(toStringList(event.target.value))}
      data-testid={testId}
    />
  ) : (
    <Input
      size="sm"
      label={visibleLabel(label)}
      aria-label={label}
      placeholder="Valores separados por vírgula"
      value={joinValueList(values)}
      onChange={(event) => onChange(splitValueList(event.target.value))}
      data-testid={testId}
    />
  );
}

/**
 * The value line that `in` and `between` get to THEMSELVES.
 *
 * The row is already two lines inside a 344px panel because three selects plus
 * a button do not fit on one (FUT-755) — each MUI select spends ~32px on its
 * own chrome. A set picker and a from/to pair need MORE room than the single
 * value they replace, not less, so they drop below the operator and take the
 * full ~312px rather than squeezing the row back into `S…` / `i…`.
 */
function FilterWideValue({
  filter,
  index,
  options,
  onPatch,
}: {
  filter: FilterDraftRow;
  index: number;
  options: ValueOptions;
  onPatch: FilterPatch;
}): JSX.Element {
  const testId = `builder-filter-value-${index}`;
  if (valueShapeFor(filter.operator) === "list") {
    return (
      <FilterListField
        label={`Filtro ${index + 1} — valores`}
        testId={testId}
        options={options}
        values={filter.values ?? []}
        onChange={(values) => onPatch({ values })}
      />
    );
  }
  return (
    <Stack direction="row" spacing={1}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <FilterValueField
          label={`Filtro ${index + 1} — de`}
          testId={`${testId}-from`}
          options={options}
          value={filter.from ?? ""}
          placeholder="De"
          onChange={(from) => onPatch({ from })}
        />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <FilterValueField
          label={`Filtro ${index + 1} — até`}
          testId={`${testId}-to`}
          options={options}
          value={filter.to ?? ""}
          placeholder="Até"
          onChange={(to) => onPatch({ to })}
        />
      </Box>
    </Stack>
  );
}

/**
 * One filter row: field, condition, value, remove — laid out over TWO lines.
 *
 * One row of three selects plus a text "Remover" button left each control
 * ~70px inside the 344px panel, which rendered the field as `S…` and the
 * operator as `i…` (FUT-755) — the exact truncation this panel replaced the
 * popover to fix, still shipping.
 *
 * Widths alone could not fix it: each MUI select spends ~32px on its own
 * chrome, so three of them plus a button need ~200px before a single character
 * of label is drawn, against ~312px of usable width. So the field — the one
 * open-ended label, and the row's subject — takes a line of its own, and the
 * operator, its value and the remove control share the next. The operator's
 * longest label is known and short, so it keeps `prototype.html`'s fixed 104px
 * and the value takes the rest.
 *
 * `in` and `between` need more than one control for their value, which the same
 * arithmetic says cannot share that second line — so they leave it empty and
 * take a THIRD (see {@link FilterWideValue}). The operator keeps its 104px and
 * the remove control keeps the right edge either way, so every row's `⨯` still
 * lines up.
 */
export function FilterRow({
  filter,
  index,
  fieldOptions,
  field,
  onPatch,
  onRemove,
}: {
  filter: FilterDraftRow;
  index: number;
  /** The field picker's options, assembled once by the section. */
  fieldOptions: Array<{ value: string; label: string }>;
  field: ReportField | undefined;
  onPatch: FilterPatch;
  onRemove: () => void;
}): JSX.Element {
  const options = valueOptionsFor(field);
  const inline = valueShapeFor(filter.operator) === "single";
  return (
    <Stack spacing={1}>
      <Select
        size="sm"
        label="Campo"
        aria-label={`Filtro ${index + 1} — campo`}
        options={fieldOptions}
        value={filter.field}
        onChange={(event) => onPatch({ field: event.target.value as string })}
        data-testid={`builder-filter-field-${index}`}
      />
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Box sx={{ width: 104, flexShrink: 0 }}>
          <Select
            size="sm"
            label="Condição"
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
        </Box>
        {/* `minWidth: 0` lets the value shrink to its share: a flex item
            defaults to `min-width: auto` and would otherwise refuse to. Empty
            for the wide shapes, where it is what holds `⨯` at the right edge. */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {inline ? (
            <FilterValueField
              label={`Filtro ${index + 1} — valor`}
              testId={`builder-filter-value-${index}`}
              options={options}
              value={filter.value}
              onChange={(value) => onPatch({ value })}
            />
          ) : null}
        </Box>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRemove}
          aria-label={`Remover filtro ${index + 1}`}
        >
          <CloseIcon />
        </Button>
      </Stack>
      {inline ? null : (
        <FilterWideValue filter={filter} index={index} options={options} onPatch={onPatch} />
      )}
    </Stack>
  );
}

