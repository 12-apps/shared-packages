'use client';

/**
 * A range filter as a PILL in the inline filter bar — the same affordance the
 * multi-select facets use, so "Data" and "Valor" sit in the filter row beside
 * "Pagamento"/"Situação"/"Método" instead of floating above the grid.
 *
 * Before this the inline bar rendered pills only, and `rangeFields` had a
 * surface on the slide-in panel alone — which `inlineFilters` REPLACES on a wide
 * screen. So a range filter was invisible on exactly the screens that use it,
 * and a page wanting one had to hang its own inputs outside the grid, outside
 * `DataViewState`, and outside the grid's "Limpar filtros" (FUT-668).
 */
import ChevronDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { Box, Button, Popover, TextField, Typography } from '@mui/material';
import React, { useState } from 'react';

import { TableFilter } from '../../layout/TableFilter';
import type { RangeFieldConfig, RangeValue } from './data-views-types';

/** Is either bound set? Drives the pill's active styling and the chip. */
export function isRangeSet(range: RangeValue | undefined): boolean {
  return Boolean(range && (range.min != null || range.max != null));
}

/** `AAAA-MM-DD` → `DD/MM` — the compact form a chip shows. */
function shortDay(day: string): string {
  const [, month, date] = day.split('-');
  return month && date ? `${date}/${month}` : day;
}

/** One bound, rendered for the chip: money in reais, a day as `DD/MM`. */
function boundLabel<T extends Record<string, unknown>>(
  field: RangeFieldConfig<T>,
  bound: number | string,
): string {
  if (field.kind === 'day') return shortDay(String(bound));
  return field.unit ? `${field.unit} ${bound}` : String(bound);
}

/**
 * The chip text for an applied range: "Data: 01/07–31/07" when both ends are
 * set, and a one-sided window as the inequality it actually is ("Valor: ≥ R$ 20")
 * rather than an en-dash with a blank side.
 */
export function rangeChipLabel<T extends Record<string, unknown>>(
  field: RangeFieldConfig<T>,
  range: RangeValue,
): string {
  const { min, max } = range;
  if (min != null && max != null) {
    return `${field.label}: ${boundLabel(field, min)}–${boundLabel(field, max)}`;
  }
  if (min != null) return `${field.label}: ≥ ${boundLabel(field, min)}`;
  return `${field.label}: ≤ ${boundLabel(field, max as number | string)}`;
}

/** A bound as the input's string value ('' when unset). */
function inputValue(bound: number | string | undefined): string {
  return bound == null ? '' : String(bound);
}

/**
 * One end of the range. A day keeps its `AAAA-MM-DD` string verbatim (the form
 * both the native picker and the backend speak); a number parses, and an
 * unparseable/blank entry CLEARS the bound rather than writing `NaN`.
 */
function BoundField<T extends Record<string, unknown>>({
  field,
  label,
  value,
  onChange,
  testId,
}: {
  field: RangeFieldConfig<T>;
  label: string;
  value: number | string | undefined;
  onChange: (bound: number | string | undefined) => void;
  testId: string;
}): React.JSX.Element {
  const isDay = field.kind === 'day';
  return (
    <TextField
      size="small"
      type={isDay ? 'date' : 'number'}
      label={label}
      value={inputValue(value)}
      onChange={(event) => {
        const raw = event.target.value;
        if (raw === '') return onChange(undefined);
        if (isDay) return onChange(raw);
        const amount = Number(raw);
        return onChange(Number.isNaN(amount) ? undefined : amount);
      }}
      // A native date input ALWAYS paints its `dd/mm/aaaa` placeholder, and a
      // start adornment occupies the same space — so a label left to MUI's
      // default (shrink only once filled) renders ON TOP of it.
      InputLabelProps={{ shrink: true }}
      inputProps={{
        'data-testid': testId,
        ...(isDay ? {} : { step: field.step ?? 1, min: 0 }),
      }}
      InputProps={!isDay && field.unit ? { startAdornment: <Box component="span" sx={{ mr: 0.5, color: 'text.secondary' }}>{field.unit}</Box> } : undefined}
      sx={{ width: isDay ? 165 : 140 }}
    />
  );
}

/**
 * The `De`/`Até` pair for a range — shared by the pill's popover and the
 * slide-in panel's day fields, so the two surfaces cannot drift on what a bound
 * accepts or how it clears.
 */
export function RangeBounds<T extends Record<string, unknown>>({
  field,
  value,
  onChange,
  testId,
}: {
  field: RangeFieldConfig<T>;
  value: RangeValue;
  onChange: (range: RangeValue) => void;
  testId: string;
}): React.JSX.Element {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }} data-testid={`${testId}-panel`}>
      <BoundField
        field={field}
        label="De"
        value={value.min}
        onChange={(min) => onChange({ ...value, min })}
        testId={`${testId}-min`}
      />
      <BoundField
        field={field}
        label="Até"
        value={value.max}
        onChange={(max) => onChange({ ...value, max })}
        testId={`${testId}-max`}
      />
    </Box>
  );
}

/**
 * The pill + its popover. Bounds commit on change (the list is server-driven, so
 * each edit is a query) and the popover stays open, which is what lets a
 * merchant set "de" and then "até" without re-opening it.
 */
export function RangePill<T extends Record<string, unknown>>({
  field,
  value,
  onChange,
  testIdPrefix,
}: {
  field: RangeFieldConfig<T>;
  value: RangeValue;
  onChange: (range: RangeValue) => void;
  testIdPrefix: string;
}): React.JSX.Element {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const active = isRangeSet(value);
  const testId = `${testIdPrefix}-range-${field.id}`;
  return (
    <>
      <Button
        variant="outlined"
        color="inherit"
        size="small"
        data-testid={testId}
        aria-haspopup="dialog"
        aria-expanded={Boolean(anchor)}
        onClick={(event) => setAnchor(event.currentTarget)}
        endIcon={<ChevronDownIcon sx={{ fontSize: 16 }} />}
        sx={{
          borderRadius: 999,
          height: 34,
          px: 1.5,
          color: 'text.primary',
          fontWeight: 600,
          fontSize: '0.8125rem',
          textTransform: 'none',
          borderColor: active ? 'primary.main' : 'divider',
          bgcolor: active ? 'action.selected' : 'background.paper',
          '&:hover': {
            borderColor: active ? 'primary.main' : 'text.primary',
            bgcolor: active ? 'action.selected' : 'action.hover',
          },
        }}
      >
        {field.label}
      </Button>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { p: 2, mt: 0.5 } } }}
      >
        <RangeBounds field={field} value={value} onChange={onChange} testId={testId} />
        {/* An inverted window is not an error the merchant must fix before the
            list responds — it simply matches nothing, and saying so beats an
            empty grid with no explanation (FUT-668). */}
        {active && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mt: 1.5 }}>
            <Typography component="span" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
              {rangeChipLabel(field, value)}
            </Typography>
            <Button
              variant="text"
              size="small"
              onClick={() => onChange({})}
              data-testid={`${testId}-clear`}
              sx={{ textTransform: 'none' }}
            >
              Limpar
            </Button>
          </Box>
        )}
      </Popover>
    </>
  );
}

/**
 * A stored range narrowed to NUMBERS, for the slide-in panel's numeric control.
 * A bound that doesn't parse is dropped rather than passed on as `NaN`, which
 * the control would render as an empty box that still filtered.
 */
export function numericRange(range: RangeValue): { min?: number; max?: number } {
  const parse = (bound: number | string | undefined): number | undefined => {
    if (bound == null || bound === "") return undefined;
    const value = Number(bound);
    return Number.isNaN(value) ? undefined : value;
  };
  const min = parse(range.min);
  const max = parse(range.max);
  return { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
}

/**
 * One range on the SLIDE-IN panel (and the narrow-screen modal): the numeric
 * control the panel already had, or — for a day range, which that control cannot
 * express — the same `De`/`Até` pair the pill's popover uses.
 */
export function PanelRangeField<T extends Record<string, unknown>>({
  field,
  value,
  onChange,
  testId,
}: {
  field: RangeFieldConfig<T>;
  value: RangeValue;
  onChange: (range: RangeValue) => void;
  testId: string;
}): React.JSX.Element {
  if (field.kind === "day") {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <Typography component="span" sx={{ fontSize: "0.75rem", fontWeight: 500, color: "text.secondary" }}>
          {field.label}
        </Typography>
        <RangeBounds field={field} value={value} onChange={onChange} testId={testId} />
      </Box>
    );
  }
  return (
    <TableFilter.RangeField
      label={field.label}
      unit={field.unit}
      step={field.step}
      value={numericRange(value)}
      onChange={(range) => onChange(range)}
      testId={testId}
    />
  );
}
