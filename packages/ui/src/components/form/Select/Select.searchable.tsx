import Autocomplete from '@mui/material/Autocomplete/index.js';
import type { AutocompleteRenderInputParams } from '@mui/material/Autocomplete/index.js';
import type { SelectChangeEvent } from '@mui/material/Select/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import type { Theme } from '@mui/material/styles/index.js';
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
  field: Pick<SelectProps, 'label' | 'placeholder' | 'helperText' | 'error' | 'name' | 'required' | 'autoFocus' | 'onBlur' | 'onFocus'>;
  ariaLabel: string | undefined;
  disabled: boolean | undefined;
  triggerTestId: string;
}

function renderField({ params, field, ariaLabel, disabled, triggerTestId }: FieldProps): React.JSX.Element {
  return (
    <TextField
      {...params}
      label={field.label}
      placeholder={field.placeholder}
      helperText={field.helperText}
      error={field.error}
      name={field.name}
      required={field.required}
      autoFocus={field.autoFocus}
      onBlur={field.onBlur as React.FocusEventHandler<HTMLInputElement | HTMLTextAreaElement> | undefined}
      onFocus={field.onFocus as React.FocusEventHandler<HTMLInputElement | HTMLTextAreaElement> | undefined}
      // The menu drew its placeholder under a shrunk label (`displayEmpty`);
      // a floating label left down would hide it until focus.
      slotProps={field.placeholder ? { inputLabel: { shrink: true } } : undefined}
      inputProps={{
        ...params.inputProps,
        'aria-label': ariaLabel,
        // The menu's display div carried `aria-disabled`; the input keeps it.
        'aria-disabled': disabled ? true : undefined,
        'data-testid': triggerTestId,
      }}
    />
  );
}

/**
 * The option the field shows, KEPT STABLE while it is the same one.
 *
 * Consumers build `options` inline (`xs.map(...)`), so a fresh `find` returns a
 * new object on every parent render, which MUI reads as a changed value and
 * answers by resetting the typed text — a refetch mid-search wiped the query.
 * Uncontrolled use (`defaultValue`, no `value`) keeps its own state, as MUI's
 * Select did.
 */
function useSelectedOption(
  options: SelectOption[],
  value: unknown,
  defaultValue: unknown,
): [SelectOption | null, (next: SelectOption) => void] {
  const [own, setOwn] = React.useState<unknown>(defaultValue ?? '');
  const current = value === undefined ? own : value;
  const match = options.find((option) => String(option.value) === String(current ?? '')) ?? null;
  const key = match === null ? null : `${String(match.value)}\u0000${match.label}\u0000${match.disabled === true}`;
  // Keyed on the option's identity, not the object `find` just returned.
  const stable = React.useMemo(() => match, [key]);
  return [stable, (next) => setOwn(next.value)];
}

/**
 * A field that does not fill its row sizes to its longest option, the way the
 * menu sized to its selected text: MUI's Autocomplete input is `width: 0`, so
 * without this a `fullWidth={false}` select collapsed to its arrow.
 */
function intrinsicWidth(
  theme: Theme,
  options: SelectOption[],
  fullWidth: boolean,
): React.CSSProperties | undefined {
  if (fullWidth) return undefined;
  const longest = options.reduce((max, option) => Math.max(max, option.label.length), 0);
  // The label in `ch`, plus the field's inline padding and the arrow's slot.
  return { minWidth: `calc(${longest}ch + ${rem(theme, SELECT_SEARCH.fieldChrome)})` };
}

export const SearchableSelect = React.forwardRef<HTMLDivElement, SelectProps>((props, ref) => {
  const { variant, options, fullWidth = true, size, error, glow, pulse, value, defaultValue } = props;
  const { onChange, disabled, name, noOptionsText, sx, className, style, id } = props;
  const { testId: dataTestId } = splitTestId(props as unknown as Record<string, unknown>);
  const [selected, setOwn] = useSelectedOption(options, value, defaultValue);
  const theme = useTheme();
  const optionTestId = (optionValue: SelectOption['value']): string =>
    dataTestId ? `${dataTestId}-option-${optionValue}` : `option-${optionValue}`;

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
      sx={sx}
      className={className}
      style={{ ...intrinsicWidth(theme, options, fullWidth), ...style }}
      data-testid={dataTestId}
    >
      <Autocomplete<SelectOption, false, true, false>
        id={id}
        value={selected as SelectOption}
        options={options}
        disabled={disabled}
        disableClearable
        autoHighlight
        handleHomeEndKeys
        size={formControlSize(size)}
        noOptionsText={noOptionsText ?? null}
        getOptionLabel={(option) => option.label}
        // Two people may share a name; the value is what tells them apart.
        getOptionKey={(option) => String(option.value)}
        getOptionDisabled={(option) => option.disabled === true}
        isOptionEqualToValue={(option, current) => String(option.value) === String(current.value)}
        onChange={(_event, next) => {
          setOwn(next);
          onChange?.(selectChange(next.value, name), null);
        }}
        renderOption={(optionProps, option) => renderOption(optionProps, option, optionTestId)}
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
            field: props,
            ariaLabel: props['aria-label'],
            disabled,
            triggerTestId: dataTestId ? `${dataTestId}-select` : 'select',
          })
        }
      />
    </SelectFieldControl>
  );
});

SearchableSelect.displayName = 'SearchableSelect';
