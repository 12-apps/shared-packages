'use client';

import { alpha } from '@mui/material';
import Autocomplete, { createFilterOptions } from '@mui/material/Autocomplete';
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

/**
 * A single-select, searchable combobox that can create a new option on the fly.
 *
 * Type to filter {@link CreatableSelectProps.options}; when the typed text matches
 * no option and {@link CreatableSelectProps.onCreate} is provided, a "create" row
 * appears and selecting it (Enter or click) calls `onCreate` with the raw text —
 * the parent persists it, then feeds the new option back via `options`/`value`.
 *
 * Chrome matches the library's other form fields: an external {@link FormLabel}
 * above the control (not a floating label) and the same outlined border treatment
 * as {@link Input}, so it lines up with sibling fields in a grid row.
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
        filterOptions={(available, params) => {
          const filtered = filterOptions(available, params);
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
        }}
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
        renderInput={(params) => (
          <TextField
            {...params}
            id={inputId}
            placeholder={placeholder}
            error={Boolean(error)}
            // Match the outlined border treatment of the `Input` component so the
            // field is visually identical to its siblings.
            sx={{
              '& .MuiOutlinedInput-root': {
                '& fieldset': {
                  borderColor: (theme) => alpha(theme.palette.divider, 0.23),
                },
                '&:hover fieldset': { borderColor: 'primary.main' },
                '&.Mui-focused fieldset': { borderColor: 'primary.main', borderWidth: 2 },
                '&.Mui-error fieldset': { borderColor: 'error.main' },
              },
            }}
            inputProps={{ ...params.inputProps, 'data-testid': `${dataTestId}-input` }}
            slotProps={{
              input: {
                ...params.InputProps,
                endAdornment: (
                  <>
                    {loading ? <CircularProgress color="inherit" size={18} /> : null}
                    {params.InputProps.endAdornment}
                  </>
                ),
              },
            }}
          />
        )}
      />
      {error && <FormMessage error dataTestId={`${dataTestId}-message`}>{error}</FormMessage>}
    </FormControl>
  );
}
