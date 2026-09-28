import Autocomplete from '@mui/material/Autocomplete/index.js';
import type { AutocompleteRenderInputParams } from '@mui/material/Autocomplete/index.js';
import type { SelectChangeEvent } from '@mui/material/Select/index.js';
import TextField from '@mui/material/TextField/index.js';
import React from 'react';

import { SEARCHABLE_MIN_OPTIONS, SELECT_SEARCH } from './Select.metrics';
import { formControlSize, SelectFieldControl } from './Select.styles';
import type { SelectOption, SelectProps } from './Select.types';

import { splitTestId } from '../../../platform/test-id';
import { asFieldSize } from '../../../tokens/field-height';
import { stackedOverlayZIndex } from '../../../tokens/layers';
import { rem } from '../../../tokens/relative';

/**
 * THE SELECT, PAST FIVE OPTIONS: a search box over a list of bounded height.
 *
 * Same engine as `CreatableSelect` — MUI `Autocomplete` — so every searchable
 * dropdown in the library types, filters and scrolls the same way. What it
 * keeps from `Select` is the whole CONTRACT, so a call site cannot tell which
 * one it got until it opens it:
 *
 * - the field chrome ({@link SelectFieldControl}: variant, size, glow, pulse);
 * - the floating label, placeholder, helper text and error;
 * - `onChange(event)` with `event.target.value` — the option's value, a number
 *   staying a number, exactly what MUI's `Select` hands its handlers;
 * - disabled options, and the `-select` / `-option-<value>` test ids.
 *
 * It cannot be cleared (a `Select` has no "none" either — its placeholder is
 * disabled), and it never accepts text that is not an option.
 */

/** Whether `props` should render as a search box. */
export function shouldSearch(props: SelectProps): boolean {
  if (props.multiple || props.renderValue) return false;
  if (props.searchable !== undefined) return props.searchable;
  return props.options.length >= SEARCHABLE_MIN_OPTIONS;
}

/**
 * The change MUI's `Select` would have emitted: handlers read
 * `event.target.value` (and sometimes `.name`), so that is what they get.
 */
function selectChange(value: SelectOption['value'], name: string | undefined): SelectChangeEvent<unknown> {
  return { target: { value, name: name ?? '' } } as unknown as SelectChangeEvent<unknown>;
}

function renderOption(
  props: React.HTMLAttributes<HTMLLIElement>,
  option: SelectOption,
  optionTestId: (value: SelectOption['value']) => string,
): React.JSX.Element {
  const { key, ...rest } = props as typeof props & { key?: React.Key };
  return (
    <li key={key ?? option.value} {...rest} data-testid={optionTestId(option.value)}>
      {option.label}
    </li>
  );
}

interface FieldProps {
  params: AutocompleteRenderInputParams;
  label: SelectProps['label'];
  placeholder: SelectProps['placeholder'];
  helperText: SelectProps['helperText'];
  error: SelectProps['error'];
  ariaLabel: string | undefined;
  triggerTestId: string;
}

function renderField({
  params,
  label,
  placeholder,
  helperText,
  error,
  ariaLabel,
  triggerTestId,
}: FieldProps): React.JSX.Element {
  return (
    <TextField
      {...params}
      label={label}
      placeholder={placeholder}
      helperText={helperText}
      error={error}
      inputProps={{
        ...params.inputProps,
        'aria-label': ariaLabel,
        'data-testid': triggerTestId,
      }}
    />
  );
}

export const SearchableSelect = React.forwardRef<HTMLDivElement, SelectProps>(
  (
    {
      variant,
      options,
      label,
      helperText,
      fullWidth = true,
      size,
      error,
      placeholder,
      glow,
      pulse,
      value,
      onChange,
      disabled,
      name,
      noOptionsText,
      'aria-label': ariaLabel,
      ...rest
    },
    ref,
  ) => {
    const { testId: dataTestId } = splitTestId(rest);
    const optionTestId = (optionValue: SelectOption['value']): string =>
      dataTestId ? `${dataTestId}-option-${optionValue}` : `option-${optionValue}`;
    const selected = options.find((option) => String(option.value) === String(value ?? '')) ?? null;

    return (
      <SelectFieldControl
        fullWidth={fullWidth}
        size={formControlSize(size)}
        error={error}
        customVariant={variant}
        fieldSize={asFieldSize(size)}
        glow={glow}
        pulse={pulse}
        ref={ref}
        data-testid={dataTestId}
      >
        <Autocomplete<SelectOption, false, true, false>
          value={selected as SelectOption}
          options={options}
          disabled={disabled}
          disableClearable
          autoHighlight
          openOnFocus
          handleHomeEndKeys
          size={formControlSize(size)}
          noOptionsText={noOptionsText ?? null}
          getOptionLabel={(option) => option.label}
          getOptionDisabled={(option) => option.disabled === true}
          isOptionEqualToValue={(option, current) => String(option.value) === String(current.value)}
          onChange={(_event, next) => onChange?.(selectChange(next.value, name), null)}
          renderOption={(props, option) => renderOption(props, option, optionTestId)}
          slotProps={{
            // Above stacked sheets and dialogs, as `CreatableSelect` does.
            popper: { sx: { zIndex: stackedOverlayZIndex } },
            // THE bounded height: MUI's own default is 40vh, which on a tall
            // screen is the whole page again.
            listbox: { sx: (theme) => ({ maxHeight: rem(theme, SELECT_SEARCH.listMaxHeight) }) },
          }}
          renderInput={(params) =>
            renderField({
              params,
              label,
              placeholder,
              helperText,
              error,
              ariaLabel,
              triggerTestId: dataTestId ? `${dataTestId}-select` : 'select',
            })
          }
        />
      </SelectFieldControl>
    );
  },
);

SearchableSelect.displayName = 'SearchableSelect';
