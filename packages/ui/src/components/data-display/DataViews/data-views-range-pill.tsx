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
import Box from '@mui/material/Box/index.js';
import Button from '@mui/material/Button/index.js';
import Popover from '@mui/material/Popover/index.js';
import Typography from '@mui/material/Typography/index.js';
import useMediaQuery from '@mui/material/useMediaQuery/index.js';
import { useTheme, type Theme } from '@mui/material/styles/index.js';
import React, { useContext } from 'react';

import { useDataViewsCopy } from "./data-views-copy-context";
import { TableFilter } from '../../layout/TableFilter';
import { TableFilterContext } from '../../layout/TableFilter/TableFilterContext';
import { RangePresets } from './data-views-preset-chips';
import { RangeBounds } from './data-views-range-bounds';
import { RangeSummary } from './data-views-range-summary';
import { useStillAnchor } from './data-views-still-anchor';
import { presetsFor } from './data-views-range-presets';
import {
  isRangeInverted,
  isRangeSet,
  numericRange,
  rangeChipLabel,
} from './data-views-range-values';
import type { RangeFieldConfig, RangeValue } from './data-views-types';
import { fieldRadiusPx } from '../../../tokens/field-radius';
import { fieldHeight } from '../../../tokens/field-height';
import { fieldEdge } from '../../../tokens/field-edge';
import { rem, remPx, sxRem } from '../../../tokens/relative';

// Re-exported: the pair moved to its own file, and its importers keep their path.
export { RangeBounds };

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
      <CloseIcon sx={{ fontSize: sxRem(14) }} />
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
  // At rest the pill draws the one field border (`fieldEdge`).
  const tone = inverted ? 'error.main' : active ? 'primary.main' : null;
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
      endIcon={<ChevronDownIcon sx={{ fontSize: sxRem(16) }} />}
      sx={{
        borderRadius: fieldRadiusPx,
        height: fieldHeight,
        px: 1.5,
        maxWidth: sxRem(280),
        color: inverted ? 'error.main' : 'text.primary',
        fontWeight: 600,
        fontSize: sxRem(13),
        textTransform: 'none',
        whiteSpace: 'nowrap',
        borderColor: (theme) => tone ?? fieldEdge(theme),
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

/**
 * How many months the pill's calendar shows: two from the theme's `md` up,
 * where the popover has the ~670px they take; one below it.
 *
 * A media query, not an `sx` breakpoint, because it decides what to RENDER —
 * CSS cannot un-render a second month. `up('md')` so that where nothing can be
 * measured (a test, the server) the answer is the one month that always fits.
 */
function useCalendarMonths(): 1 | 2 {
  const theme = useTheme();
  return useMediaQuery(theme.breakpoints.up('md')) ? 2 : 1;
}

/**
 * The day popover's width. Below `sm` it takes the screen's (less the
 * popover's own 16px margins, which its `maxWidth` already keeps), so the boxes
 * and the month share it instead of leaving a strip of grid beside a narrow
 * card. From `sm` to `md` it holds one month, and sized to its content the
 * preset row alone stretched it to ~515px with the month hugging the left and
 * a band of nothing beside it; 400 keeps the month and the boxes one width.
 * From `md` its content — two months — sets it.
 */
const DAY_PAPER_SX = (theme: Theme) => ({
  width: { xs: '100%', sm: rem(theme, 400), md: 'auto' },
  // Below `sm` 8px from each edge and 8px of padding, so the month gets the
  // 280px seven 40px day columns need: at 320 it had 256 and every day was a
  // 33px target (FUT-4144 UI review).
  maxWidth: { xs: `calc(100% - ${rem(theme, 16)})`, sm: `calc(100% - ${rem(theme, 32)})` },
  // And as tall as those same margins allow: MUI's default keeps 16px off the
  // top and bottom, so a refused day's message at 320×568 made the popover
  // 1px taller than its cap and it scrolled (FUT-4144 code review).
  maxHeight: { xs: `calc(100% - ${rem(theme, 16)})`, sm: `calc(100% - ${rem(theme, 32)})` },
  p: { xs: 1, sm: 2 },
});


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
  const still = useStillAnchor();
  const testId = `${testIdPrefix}-range-${field.id}`;
  const calendarMonths = useCalendarMonths();
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  return (
    <>
      <RangeTrigger
        field={field}
        value={value}
        onChange={onChange}
        onOpen={(element) => {
          still.open(element);
          onOpenChange?.(true);
        }}
        open={Boolean(still.anchor)}
        testId={testId}
      />
      <Popover
        {...still.popoverProps}
        onClose={() => {
          still.close();
          onOpenChange?.(false);
        }}
        // Below `sm` a day popover keeps 8px from the screen's edges instead of 16.
        marginThreshold={field.kind === 'day' && phone ? remPx(theme, 8) : undefined}
        slotProps={{ paper: { ref: still.paperRef, sx: [{ p: 2, mt: 0.5 }, field.kind === 'day' && DAY_PAPER_SX] } }}
      >
        <RangeBounds
          field={field}
          value={value}
          onChange={onChange}
          testId={testId}
          calendarMonths={calendarMonths}
          summaryOnHint
        />
        <RangeSummary field={field} value={value} onClear={() => onChange({})} testId={testId} />
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
  // The slide-in panel stays mounted while closed; its calendar does not.
  // Outside a `TableFilter` (the "Mais" sheet, a test) the pair is on screen.
  const panel = useContext(TableFilterContext);
  if (field.kind === "day") {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <Typography component="span" sx={{ fontSize: sxRem(12), fontWeight: 500, color: "text.secondary" }}>
          {field.label}
        </Typography>
        <RangeBounds
          field={field}
          value={value}
          onChange={onChange}
          testId={testId}
          showCalendar={panel ? panel.open : true}
        />
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
