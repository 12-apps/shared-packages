'use client';

import { alpha } from '@mui/material';
import Autocomplete, { createFilterOptions } from '@mui/material/Autocomplete';
import type { AutocompleteRenderInputParams } from '@mui/material/Autocomplete';
import CircularProgress from '@mui/material/CircularProgress';
import TextField from '@mui/material/TextField';
import { useId, useMemo } from 'react';

import { FormControl, FormLabel, FormMessage } from '../Form';
import type { CreatableSelectOption, CreatableSelectProps } from './CreatableSelect.types';

/** Internal option shape: a real option, or the synthetic "create new" row. */
interface InternalOption extends CreatableSelectOption {
  /** True for the synthetic row that triggers {@link CreatableSelectProps.onCreate}. */
  isCreate?: boolean;
}

/** Prefix that marks a synthetic create-row value so it can never collide with a real one. */
const CREATE_PREFIX = ' create:';

const filterOptions = createFilterOptions<InternalOption>();

/** `sm`/`md` → MUI's own scale, the same mapping {@link Input} uses. */
const MUI_SIZE = { sm: 'small', md: 'medium' } as const;

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

/** The text field Autocomplete renders, with the library's border + a loading adornment. */
function renderField(
  params: AutocompleteRenderInputParams,
  field: {
    inputId: string;
    placeholder?: string;
    error?: string;
    loading: boolean;
    size: 'sm' | 'md';
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
  createOptionLabel = (input) => `Criar "${input}"`,
  noOptionsText,
  disabled = false,
  loading = false,
  fullWidth = true,
  size = 'md',
  dataTestId = 'creatable-select',
}: CreatableSelectProps): React.JSX.Element {
  const inputId = useId();

  const items = useMemo<InternalOption[]>(
    () => options.map((option) => ({ value: option.value, label: option.label })),
    [options],
  );

  // MUI holds the selected *option object*; derive it from the controlled value.
  const selected = useMemo<InternalOption | null>(
    () => items.find((option) => option.value === value) ?? null,
    [items, value],
  );

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
        // which would otherwise cover the options. +100 clears ~10 stack levels.
        slotProps={{ popper: { sx: { zIndex: (theme) => theme.zIndex.modal + 100 } } }}
        getOptionLabel={(option) => (typeof option === 'string' ? option : option.label)}
        isOptionEqualToValue={(option, current) => option.value === current.value}
        filterOptions={buildFilter(onCreate, createOptionLabel)}
        onChange={(_event, next) => {
          if (!next) {
            onChange(null);
            return;
          }
          if (next.isCreate) {
            void onCreate?.(next.value.slice(CREATE_PREFIX.length));
            return;
          }
          onChange(next.value);
        }}
        renderInput={(params) =>
          renderField(params, { inputId, placeholder, error, loading, size, dataTestId })
        }
      />
      {error && <FormMessage error dataTestId={`${dataTestId}-message`}>{error}</FormMessage>}
    </FormControl>
  );
}
