'use client';

import { alpha } from '@mui/material/styles/index.js';
import Autocomplete, { createFilterOptions } from '@mui/material/Autocomplete/index.js';
import type { AutocompleteRenderInputParams } from '@mui/material/Autocomplete/index.js';
import CircularProgress from '@mui/material/CircularProgress/index.js';
import TextField from '@mui/material/TextField/index.js';
import { useId, useMemo } from 'react';

import { stackedOverlayZIndex } from '../../../tokens/layers';
import { FormControl, FormLabel, FormMessage } from '../Form';
import type { CreatableSelectOption, CreatableSelectProps } from './CreatableSelect.types';
import type { SizeValue } from '../../../tokens/scales';

/** Internal option shape: a real option, or the synthetic "create new" row. */
interface InternalOption extends CreatableSelectOption {
  /** True for the synthetic row that triggers {@link CreatableSelectProps.onCreate}. */
  isCreate?: boolean;
}

/** Prefix that marks a synthetic create-row value so it can never collide with a real one. */
const CREATE_PREFIX = ' create:';

const filterOptions = createFilterOptions<InternalOption>();

/** How far one nesting level indents a dropdown row, in px. */
const INDENT_STEP = 16;

/** `sm`/`md` → MUI's own scale, the same mapping {@link Input} uses. */
// All five house stops onto MUI's two. `xs`/`sm` draw small; `md` and up draw
// medium, because an autocomplete field has no third or fourth height to give.
const MUI_SIZE = { xs: 'small', sm: 'small', md: 'medium', lg: 'medium', xl: 'medium' } as const;

/** Match the outlined border treatment of `Input` so siblings look identical. */
const fieldSx = {
  '& .MuiOutlinedInput-root': {
    '& fieldset': {
      borderColor: (theme: { palette: { divider: string } }) => alpha(theme.palette.divider, 0.23),
    },
    '&:hover fieldset': { borderColor: 'primary.main' },
    '&.Mui-focused fieldset': { borderColor: 'primary.main', borderWidth: 2 },
    '&.Mui-error fieldset': { borderColor: 'error.main' },
  },
} as const;

/**
 * The filter that appends the synthetic "create" row when the typed text matches
 * no existing option. Built per render from the two props it closes over.
 */
function buildFilter(
  onCreate: CreatableSelectProps['onCreate'],
  createOptionLabel: (input: string) => string,
) {
  return (available: InternalOption[], params: { inputValue: string }): InternalOption[] => {
    const filtered = filterOptions(available, params as Parameters<typeof filterOptions>[1]);
    const input = params.inputValue.trim();
    const alreadyExists = available.some(
      (option) => option.label.toLowerCase() === input.toLowerCase(),
    );
    if (input && !alreadyExists && onCreate) {
      filtered.push({
        value: `${CREATE_PREFIX}${input}`,
        label: createOptionLabel(input),
        isCreate: true,
      });
    }
    return filtered;
  };
}

/**
 * A nested option is indented on its ROW; the label itself stays the bare name,
 * so the closed field never shows the tree drawing (see `depth`).
 */
function renderIndentedOption(
  props: React.HTMLAttributes<HTMLLIElement>,
  option: InternalOption,
): React.JSX.Element {
  const { key, ...rest } = props as typeof props & { key?: string };
  return (
    <li
      key={key ?? option.value}
      {...rest}
      style={{ paddingLeft: INDENT_STEP * (1 + (option.depth ?? 0)) }}
    >
      {option.label}
    </li>
  );
}

/** The text field Autocomplete renders, with the library's border + a loading adornment. */
function renderField(
  params: AutocompleteRenderInputParams,
  field: {
    inputId: string;
    placeholder?: string;
    error?: string;
    loading: boolean;
    size: SizeValue;
    dataTestId: string;
  },
): React.JSX.Element {
  return (
    <TextField
      {...params}
      id={field.inputId}
      placeholder={field.placeholder}
      error={Boolean(field.error)}
      size={MUI_SIZE[field.size]}
      sx={fieldSx}
      inputProps={{ ...params.inputProps, 'data-testid': `${field.dataTestId}-input` }}
      slotProps={{
        input: {
          ...params.InputProps,
          endAdornment: (
            <>
              {field.loading ? <CircularProgress color="inherit" size={18} /> : null}
              {params.InputProps.endAdornment}
            </>
          ),
        },
      }}
    />
  );
}

/**
 * The option list, plus the selected OBJECT MUI wants, from the controlled value.
 * `depth` is carried through: it is what {@link renderIndentedOption} draws.
 */
function useInternalOptions(
  options: CreatableSelectOption[],
  value: string | null,
): { items: InternalOption[]; selected: InternalOption | null } {
  const items = useMemo<InternalOption[]>(
    () => options.map(({ value: optionValue, label, depth }) => ({
      value: optionValue,
      label,
      depth,
    })),
    [options],
  );
  const selected = useMemo<InternalOption | null>(
    () => items.find((option) => option.value === value) ?? null,
    [items, value],
  );
  return { items, selected };
}

/** Route a picked row: cleared, the synthetic create row, or a real option. */
function handlePick(
  next: InternalOption | null,
  onChange: CreatableSelectProps['onChange'],
  onCreate: CreatableSelectProps['onCreate'],
): void {
  if (!next) {
    onChange(null);
    return;
  }
  if (next.isCreate) {
    void onCreate?.(next.value.slice(CREATE_PREFIX.length));
    return;
  }
  onChange(next.value);
}

/**
 * A single-select, searchable combobox that can create a new option on the fly.
 *
 * Type to filter {@link CreatableSelectProps.options}; when the typed text matches
 * no option and {@link CreatableSelectProps.onCreate} is provided, a "create" row
 * appears and selecting it (Enter or click) calls `onCreate` with the raw text —
 * the parent persists it, then feeds the new option back via `options`/`value`.
 *
 * Chrome matches the library's other form fields: an external {@link FormLabel}
 * above the control (not a floating label), the same outlined border treatment as
 * {@link Input} and the same `sm`/`md` scale, so it lines up with sibling fields
 * in a grid row.
 */
export function CreatableSelect({
  options,
  value,
  onChange,
  onCreate,
  label,
  error,
  placeholder,
  createOptionLabel,
  noOptionsText,
  disabled = false,
  loading = false,
  fullWidth = true,
  size = 'md',
  dataTestId = 'creatable-select',
}: CreatableSelectProps): React.JSX.Element {
  const inputId = useId();
  const { items, selected } = useInternalOptions(options, value);

  return (
    <FormControl fullWidth={fullWidth} error={Boolean(error)}>
      {label && (
        <FormLabel htmlFor={inputId} error={Boolean(error)}>
          {label}
        </FormLabel>
      )}
      <Autocomplete<InternalOption, false, false, false>
        value={selected}
        options={items}
        disabled={disabled}
        loading={loading}
        fullWidth={fullWidth}
        size={MUI_SIZE[size]}
        handleHomeEndKeys
        selectOnFocus
        clearOnBlur
        data-testid={dataTestId}
        noOptionsText={noOptionsText}
        // Lift the dropdown above stacked modals: the default popup z-index is
        // `modal` (1300), but a stacked sheet at depth ≥2 sits at 1300 + depth*10,
        // which would otherwise cover the options. The height is the token's
        // now — this component used to be the only place the rule was written
        // down, which is how `CategorySelect` came to be missing it (12-57).
        slotProps={{ popper: { sx: { zIndex: stackedOverlayZIndex } } }}
        getOptionLabel={(option) => (typeof option === 'string' ? option : option.label)}
        isOptionEqualToValue={(option, current) => option.value === current.value}
        renderOption={renderIndentedOption}
        filterOptions={buildFilter(onCreate, createOptionLabel)}
        onChange={(_event, next) => handlePick(next, onChange, onCreate)}
        renderInput={(params) =>
          renderField(params, { inputId, placeholder, error, loading, size, dataTestId })
        }
      />
      {error && <FormMessage error dataTestId={`${dataTestId}-message`}>{error}</FormMessage>}
    </FormControl>
  );
}
