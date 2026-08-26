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
import CloseIcon from '@mui/icons-material/Close';
import ChevronDownIcon from '@mui/icons-material/KeyboardArrowDown';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Popover from '@mui/material/Popover';
import Typography from '@mui/material/Typography';
import React, { useState } from 'react';

import { useDataViewsCopy } from "./data-views-copy-context";
import { TableFilter } from '../../layout/TableFilter';
import { DayBoundInput } from './data-views-day-input';
import { NumberBoundInput } from './data-views-number-input';
import { RangePresets } from './data-views-preset-chips';
import { presetsFor } from './data-views-range-presets';
import {
  isRangeInverted,
  isRangeSet,
  numericRange,
  rangeChipLabel,
} from './data-views-range-values';
import type { RangeFieldConfig, RangeValue } from './data-views-types';



/**
 * One end of the range. A day keeps its `AAAA-MM-DD` string verbatim (the form
 * both the field and the backend speak) and is typed through the masked
 * `dd/mm/aaaa` field rather than a native date input — see
 * {@link DayBoundInput} for why. A number parses, and an unparseable/blank
 * entry CLEARS the bound rather than writing `NaN`.
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
  const copy = useDataViewsCopy();
  if (field.kind === 'day') {
    return (
      <DayBoundInput
        mask={copy.filters.dayMask}
        label={label}
        value={value == null ? undefined : String(value)}
        onChange={onChange}
        testId={testId}
      />
    );
  }
  return (
    <NumberBoundInput
      label={label}
      value={value}
      unit={field.unit}
      onChange={onChange}
      testId={testId}
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
  const copy = useDataViewsCopy();
  const inverted = isRangeInverted(value);
  return (
    <Box data-testid={`${testId}-panel`}>
      {/* Above the inputs, not below: the presets are the answer for most
          merchants, and the two date pickers are the escape hatch. */}
      <Box sx={{ '&:not(:empty)': { mb: 1.5 } }}>
        <RangePresets presets={presetsFor(field, copy)} value={value} onChange={onChange} testId={testId} />
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <BoundField
          field={field}
          label={copy.filters.rangeStart}
          value={value.min}
          onChange={(min) => onChange({ ...value, min })}
          testId={`${testId}-min`}
        />
        <BoundField
          field={field}
          label={copy.filters.rangeEnd}
          value={value.max}
          onChange={(max) => onChange({ ...value, max })}
          testId={`${testId}-max`}
        />
      </Box>
      {inverted && (
        <Typography
          component="p"
          data-testid={`${testId}-inverted`}
          sx={{ mt: 0.75, fontSize: '0.75rem', color: 'error.main' }}
        >
          {copy.filters.rangeInvalid}
        </Typography>
      )}
      {/* BOTH days are in the result. Saying so is FUT-668's other half: the
          bounds compare as ISO strings precisely so `até` keeps its whole day,
          and nothing on screen would otherwise tell the merchant that. */}
      {field.kind === 'day' && !inverted && (
        <Typography
          component="p"
          data-testid={`${testId}-inclusive`}
          sx={{ mt: 0.75, fontSize: '0.75rem', color: 'text.disabled' }}
        >
          {copy.filters.rangeInclusiveNote}
        </Typography>
      )}
    </Box>
  );
}

/**
 * The pill + its popover. Bounds commit on change (the list is server-driven, so
 * each edit is a query) and the popover stays open, which is what lets a
 * merchant set "de" and then "até" without re-opening it.
 */
/** An applied range clears from the pill itself — re-opening to empty two fields is three gestures for one intent. */
function ClearAffordance({
  label,
  onClear,
  testId,
}: {
  label: string;
  onClear: () => void;
  testId: string;
}): React.JSX.Element {
  const copy = useDataViewsCopy();
  const clear = (event: React.SyntheticEvent): void => {
    event.stopPropagation();
    onClear();
  };
  return (
    <Box
      component="span"
      role="button"
      tabIndex={0}
      aria-label={copy.filters.clearRange(label)}
      data-testid={testId}
      onClick={clear}
      onKeyDown={(event: React.KeyboardEvent) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        clear(event);
      }}
      sx={{ display: 'inline-flex', borderRadius: 999, p: 0.125, '&:hover': { bgcolor: 'action.selected' } }}
    >
      <CloseIcon sx={{ fontSize: 14 }} />
    </Box>
  );
}

/** The pill button: its label carries the applied window, and its tone the state. */
function RangeTrigger<T extends Record<string, unknown>>({
  field,
  value,
  onChange,
  onOpen,
  open,
  testId,
}: {
  field: RangeFieldConfig<T>;
  value: RangeValue;
  onChange: (range: RangeValue) => void;
  onOpen: (anchor: HTMLElement) => void;
  open: boolean;
  testId: string;
}): React.JSX.Element {
  const active = isRangeSet(value);
  const inverted = isRangeInverted(value);
  // An INVERTED window gets its own tone rather than the ordinary "applied"
  // one: it is applied, and it matches nothing, and those are different states.
  const tone = inverted ? 'error.main' : active ? 'primary.main' : 'divider';
  return (
    <Button
      variant="outlined"
      color="inherit"
      size="small"
      data-testid={testId}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={(event) => onOpen(event.currentTarget)}
      // ✕ FIRST, chevron LAST — the same shape as every other pill. It used to
      // replace the chevron at the end, so a range pill and a multi-select pill
      // put the clear in different places, and an applied range lost the
      // affordance that says it opens.
      startIcon={
        active ? (
          <ClearAffordance label={field.label} onClear={() => onChange({})} testId={`${testId}-clear-inline`} />
        ) : undefined
      }
      endIcon={<ChevronDownIcon sx={{ fontSize: 16 }} />}
      sx={{
        borderRadius: 999,
        height: 34,
        px: 1.5,
        maxWidth: 280,
        color: inverted ? 'error.main' : 'text.primary',
        fontWeight: 600,
        fontSize: '0.8125rem',
        textTransform: 'none',
        whiteSpace: 'nowrap',
        borderColor: tone,
        bgcolor: active ? 'action.selected' : 'background.paper',
        '&:hover': {
          borderColor: active ? tone : 'text.primary',
          bgcolor: active ? 'action.selected' : 'action.hover',
        },
      }}
    >
      {/* The applied bounds, in the label — a pill reading only "Valor" hides
          the very thing that is narrowing the list. */}
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {active ? rangeChipLabel(field, value) : field.label}
      </Box>
    </Button>
  );
}

export function RangePill<T extends Record<string, unknown>>({
  field,
  value,
  onChange,
  onOpenChange,
  testIdPrefix,
}: {
  field: RangeFieldConfig<T>;
  value: RangeValue;
  onChange: (range: RangeValue) => void;
  /** So a measured toolbar can hold still while this is open. */
  onOpenChange?: (open: boolean) => void;
  testIdPrefix: string;
}): React.JSX.Element {
  const copy = useDataViewsCopy();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const active = isRangeSet(value);
  const testId = `${testIdPrefix}-range-${field.id}`;
  return (
    <>
      <RangeTrigger
        field={field}
        value={value}
        onChange={onChange}
        onOpen={(element) => {
          setAnchor(element);
          onOpenChange?.(true);
        }}
        open={Boolean(anchor)}
        testId={testId}
      />
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => {
          setAnchor(null);
          onOpenChange?.(false);
        }}
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
              {copy.filters.clear}
            </Button>
          </Box>
        )}
      </Popover>
    </>
  );
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
  const copy = useDataViewsCopy();
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
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <TableFilter.RangeField
        label={field.label}
        unit={field.unit}
        value={numericRange(value)}
        onChange={(range) => onChange(range)}
        testId={testId}
      />
      {/* Below the numeric control here, unlike the pill's popover: this one
          renders its own label, and chips above it would separate the label
          from the field it names. */}
      <RangePresets presets={presetsFor(field, copy)} value={value} onChange={onChange} testId={testId} />
    </Box>
  );
}
