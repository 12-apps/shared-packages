'use client';

import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';
import Box from '@mui/material/Box/index.js';
import Checkbox from '@mui/material/Checkbox/index.js';
import Divider from '@mui/material/Divider/index.js';
import FormControlLabel from '@mui/material/FormControlLabel/index.js';
import IconButton from '@mui/material/IconButton/index.js';
import InputAdornment from '@mui/material/InputAdornment/index.js';
import Link from '@mui/material/Link/index.js';
import TextField from '@mui/material/TextField/index.js';
import Typography from '@mui/material/Typography/index.js';
import React, { useRef, useState } from 'react';

import { TableFilterContext, useTableFilterContext } from './TableFilterContext';
import type {
  TableFilterCheckboxFieldProps,
  TableFilterKeywordProps,
  TableFilterLayoutProps,
  TableFilterMainProps,
  TableFilterPanelProps,
  TableFilterProps,
  TableFilterRangeFieldProps,
  TableFilterSectionProps,
} from './TableFilter.types';

const PANEL_WIDTH = 280;

/**
 * Compound filter-panel system, MUI port of the reference `TableFilter`. Provides
 * open/close state; `Panel` slides in from the right beside `Main` (no overlap).
 *
 * @example
 * ```tsx
 * <TableFilter open={open} onOpenChange={setOpen} hasActiveFilters={n > 0}>
 *   <TableFilter.Layout>
 *     <TableFilter.Main>{table}</TableFilter.Main>
 *     <TableFilter.Panel onClearAll={clearAll}>
 *       <TableFilter.Keyword value={q} onChange={setQ} />
 *       <TableFilter.Section title="Attributes">
 *         <TableFilter.CheckboxField label="Category" options={cats} selected={sel} onToggle={toggle} />
 *         <TableFilter.RangeField label="Price" unit="R$" value={price} onChange={setPrice} />
 *       </TableFilter.Section>
 *     </TableFilter.Panel>
 *   </TableFilter.Layout>
 * </TableFilter>
 * ```
 */
export function TableFilter({
  children,
  open,
  onOpenChange,
  hasActiveFilters = false,
  copy,
}: TableFilterProps): React.JSX.Element {
  return (
    <TableFilterContext.Provider value={{ open, onOpenChange, hasActiveFilters, copy }}>
      {children}
    </TableFilterContext.Provider>
  );
}
TableFilter.displayName = 'TableFilter';

const TableFilterLayout = ({ children, className }: TableFilterLayoutProps): React.JSX.Element => {
  const { open } = useTableFilterContext();
  return (
    <Box
      className={className}
      sx={{
        display: 'flex',
        minHeight: 0,
        minWidth: 0,
        flex: 1,
        alignItems: 'stretch',
        overflow: 'hidden',
        gap: open ? 2 : 0,
      }}
    >
      {children}
    </Box>
  );
};
TableFilterLayout.displayName = 'TableFilter.Layout';

const TableFilterMain = ({ children, className }: TableFilterMainProps): React.JSX.Element => (
  <Box className={className} sx={{ minWidth: 0, flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
    {children}
  </Box>
);
TableFilterMain.displayName = 'TableFilter.Main';

const TableFilterPanel = ({
  children,
  onClearAll,
  ariaLabel = 'Filters',
  clearTestId,
}: TableFilterPanelProps): React.JSX.Element => {
  const { open, copy } = useTableFilterContext();
  return (
    <Box
      component="aside"
      aria-label={ariaLabel}
      aria-hidden={!open}
      sx={{
        display: 'flex',
        minHeight: 0,
        flexShrink: 0,
        flexDirection: 'column',
        alignSelf: 'stretch',
        overflow: 'hidden',
        bgcolor: 'background.paper',
        width: open ? PANEL_WIDTH : 0,
        borderLeft: open ? 1 : 0,
        borderColor: 'divider',
        transition: 'width 300ms ease-in-out',
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          minHeight: 0,
          flex: 1,
          flexDirection: 'column',
          overflowY: 'auto',
          overflowX: 'hidden',
          visibility: open ? 'visible' : 'hidden',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 200ms ease-out',
        }}
      >
        <Box sx={{ boxSizing: 'border-box', display: 'flex', width: '100%', minWidth: 0, flexDirection: 'column', gap: 2.5, p: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Link
              component="button"
              type="button"
              underline="hover"
              data-testid={clearTestId}
              onClick={onClearAll}
              sx={{ fontSize: '0.75rem', color: 'text.secondary' }}
            >
              {copy.clearAllFilters}
            </Link>
          </Box>
          {children}
        </Box>
      </Box>
    </Box>
  );
};
TableFilterPanel.displayName = 'TableFilter.Panel';

const TableFilterKeyword = ({
  value,
  onChange,
  placeholder = 'Press Enter to filter',
  label = 'Filter by keyword',
  testId,
}: TableFilterKeywordProps): React.JSX.Element => {
  const { copy } = useTableFilterContext();
  const [draft, setDraft] = useState(value);
  const prevValue = useRef(value);
  if (prevValue.current !== value) {
    prevValue.current = value;
    if (draft !== value) setDraft(value);
  }

  const commit = (): void => {
    if (draft !== value) onChange(draft);
  };
  const clearKeyword = (): void => {
    setDraft('');
    if (value !== '') onChange('');
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography component="label" sx={{ fontSize: '0.75rem', fontWeight: 500, color: 'text.secondary' }}>
        {label}
      </Typography>
      <TextField
        size="small"
        name="keyword"
        placeholder={placeholder}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          commit();
        }}
        inputProps={{ 'aria-label': label, 'data-testid': testId }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
            </InputAdornment>
          ),
          endAdornment:
            draft !== '' ? (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  aria-label={copy.clearKeyword}
                  data-testid={testId ? `${testId}-clear` : undefined}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={clearKeyword}
                >
                  <CloseIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </InputAdornment>
            ) : null,
        }}
      />
    </Box>
  );
};
TableFilterKeyword.displayName = 'TableFilter.Keyword';

const TableFilterSection = ({ title, children }: TableFilterSectionProps): React.JSX.Element => (
  <Box>
    <Divider sx={{ mb: 2.5 }} />
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Typography component="h2" sx={{ fontSize: '0.875rem', fontWeight: 600, color: 'text.primary' }}>
        {title}
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</Box>
    </Box>
  </Box>
);
TableFilterSection.displayName = 'TableFilter.Section';

function TableFilterCheckboxField<TValue extends string = string>({
  label,
  options,
  selected,
  onToggle,
  testId,
}: TableFilterCheckboxFieldProps<TValue>): React.JSX.Element {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }} data-testid={testId}>
      <Typography sx={{ fontSize: '0.75rem', fontWeight: 500, color: 'text.secondary' }}>{label}</Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column' }}>
        {options.map((option) => {
          const checked = selected.has(option.value);
          return (
            <FormControlLabel
              key={option.value}
              control={
                <Checkbox
                  size="small"
                  checked={checked}
                  onChange={(event) => onToggle(option.value, event.target.checked)}
                  data-testid={testId ? `${testId}-${option.value}` : undefined}
                  sx={{ py: 0.25 }}
                />
              }
              label={
                <Box component="span" sx={{ fontSize: '0.875rem' }}>
                  {option.label}
                  {option.count != null && (
                    <Box component="span" sx={{ color: 'text.secondary' }}>
                      {' '}
                      ({option.count})
                    </Box>
                  )}
                </Box>
              }
              sx={{ ml: -0.5, mr: 0 }}
            />
          );
        })}
      </Box>
    </Box>
  );
}
TableFilterCheckboxField.displayName = 'TableFilter.CheckboxField';

function parseBound(text: string): number | undefined {
  if (text.trim() === '') return undefined;
  const parsed = Number(text);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** One numeric bound input (min or max) for {@link TableFilterRangeField}. */
function RangeBound({
  bound,
  error,
  placeholder,
  step,
  ariaLabel,
  testId,
  onChange,
}: {
  bound: number | undefined;
  error: boolean;
  placeholder: string;
  step?: number;
  ariaLabel: string;
  testId?: string;
  onChange: (next: number | undefined) => void;
}): React.JSX.Element {
  return (
    <TextField
      size="small"
      type="number"
      error={error}
      placeholder={placeholder}
      value={bound != null ? String(bound) : ''}
      onChange={(event) => onChange(parseBound(event.target.value))}
      inputProps={{ step, 'aria-label': ariaLabel, 'data-testid': testId }}
    />
  );
}

/** Inverted range: both ends set and max < min (surfaced to the user as an error). */
const isRangeInverted = (value: { min?: number; max?: number }): boolean =>
  value.min != null && value.max != null && value.max < value.min;

const TableFilterRangeField = ({
  label,
  value,
  onChange,
  unit,
  step,
  minPlaceholder,
  maxPlaceholder,
  invalidLabel,
  testId,
}: TableFilterRangeFieldProps): React.JSX.Element => {
  const { copy } = useTableFilterContext();
  const invalid = isRangeInverted(value);
  // A field may override any of the three; unset, they come from the root's
  // table. Neither path reaches an English literal in this package.
  const minText = minPlaceholder ?? copy.rangeMin;
  const maxText = maxPlaceholder ?? copy.rangeMax;
  const invalidText = invalidLabel ?? copy.invalidRange;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }} data-testid={testId}>
      <Typography sx={{ fontSize: '0.75rem', fontWeight: 500, color: 'text.secondary' }}>
        {label}
        {unit ? ` (${unit})` : ''}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <RangeBound
          bound={value.min}
          error={invalid}
          placeholder={minText}
          step={step}
          ariaLabel={`${label} ${minText}`}
          testId={testId ? `${testId}-min` : undefined}
          onChange={(min) => onChange({ ...value, min })}
        />
        <Typography component="span" sx={{ color: 'text.secondary' }}>
          –
        </Typography>
        <RangeBound
          bound={value.max}
          error={invalid}
          placeholder={maxText}
          step={step}
          ariaLabel={`${label} ${maxText}`}
          testId={testId ? `${testId}-max` : undefined}
          onChange={(max) => onChange({ ...value, max })}
        />
      </Box>
      {invalid && (
        <Typography
          role="alert"
          data-testid={testId ? `${testId}-error` : undefined}
          sx={{ fontSize: '0.7rem', color: 'error.main' }}
        >
          {invalidText}
        </Typography>
      )}
    </Box>
  );
};
TableFilterRangeField.displayName = 'TableFilter.RangeField';

TableFilter.Layout = TableFilterLayout;
TableFilter.Main = TableFilterMain;
TableFilter.Panel = TableFilterPanel;
TableFilter.Keyword = TableFilterKeyword;
TableFilter.Section = TableFilterSection;
TableFilter.CheckboxField = TableFilterCheckboxField;
TableFilter.RangeField = TableFilterRangeField;
