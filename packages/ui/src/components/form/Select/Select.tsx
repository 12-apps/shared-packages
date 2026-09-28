import FormHelperText from '@mui/material/FormHelperText/index.js';
import InputLabel from '@mui/material/InputLabel/index.js';
import MenuItem from '@mui/material/MenuItem/index.js';
import MuiSelect from '@mui/material/Select/index.js';
import React from 'react';

import { shouldSearch } from './Select.search-rule';
import { formControlSize, SelectFieldControl } from './Select.styles';
import type { SelectProps } from './Select.types';

import { splitTestId } from '../../../platform/test-id';
import { asFieldSize } from '../../../tokens/field-height';

/**
 * Build the placeholder item plus one MenuItem per option. Returns a flat ARRAY
 * (not a Fragment): MUI `Select` enumerates its children with `React.Children`,
 * which does not descend into Fragments — a Fragment would hide every option.
 */
function renderMenuItems(
  options: SelectProps['options'],
  placeholder: string | undefined,
  dataTestId: string | undefined,
): React.ReactNode[] {
  const optionTestId = (value: string | number): string =>
    dataTestId ? `${dataTestId}-option-${value}` : `option-${value}`;
  const items = options.map((option) => (
    <MenuItem
      key={option.value}
      value={option.value}
      disabled={option.disabled}
      data-testid={optionTestId(option.value)}
    >
      {option.label}
    </MenuItem>
  ));
  if (placeholder) {
    items.unshift(
      <MenuItem key="__placeholder__" value="" disabled>
        {placeholder}
      </MenuItem>,
    );
  }
  return items;
}

const MenuSelect = React.forwardRef<HTMLDivElement, SelectProps>(
  (
    {
      // `variant`/`size`/`glow`/`pulse` intentionally have no defaults: undefined
      // resolves to the default variant, MUI's medium size, and no glow/pulse —
      // keeping this render function under the complexity budget.
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
      'aria-label': ariaLabel,
      ...rest
    },
    ref,
  ) => {
    const { testId: dataTestId, rest: props } = splitTestId(rest);
    const labelId = React.useId();
    const helperTextId = React.useId();
    const selectId = React.useId();

    return (
      <SelectFieldControl
        fullWidth={fullWidth}
        size={formControlSize(size)}
        error={error}
        customVariant={variant}
        fieldSize={asFieldSize(size)}
        glow={glow} pulse={pulse}
        ref={ref}
        data-testid={dataTestId}
      >
        {label && (
          <InputLabel id={labelId} htmlFor={selectId}>
            {label}
          </InputLabel>
        )}
        <MuiSelect
          id={selectId}
          labelId={label ? labelId : undefined}
          label={label}
          displayEmpty={Boolean(placeholder)}
          aria-describedby={helperText ? helperTextId : undefined}
          data-testid={dataTestId ? `${dataTestId}-select` : 'select'}
          value={value ?? ''}
          {...props}
          /*
           * `role="combobox"` sits on MUI's display DIV, not on the hidden
           * native input that `{...props}` reaches — so an `aria-label` passed
           * to this component never landed on the element carrying the role,
           * and MUI's `aria-labelledby` then fell back to that div's OWN id.
           * The control announced as its current value: a filter's field
           * select read "Status" instead of "Filtro 1 — campo".
           *
           * Forwarding it here names the right element. The explicit
           * `undefined` clears that self-referential `aria-labelledby`, which
           * would otherwise win — a labelledby always beats a label in the
           * accessible-name computation.
           */
          SelectDisplayProps={
            ariaLabel === undefined
              ? undefined
              : { 'aria-label': ariaLabel, 'aria-labelledby': undefined }
          }
        >
          {renderMenuItems(options, placeholder, dataTestId)}
        </MuiSelect>
        {helperText && (
          <FormHelperText id={helperTextId} error={error}>
            {helperText}
          </FormHelperText>
        )}
      </SelectFieldControl>
    );
  },
);

MenuSelect.displayName = 'MenuSelect';

/**
 * The house select. Up to five options it opens a menu; from six on it is a
 * search box over a list of bounded height (`Select.searchable.tsx`), with the
 * same props, events and test ids either way. `searchable` overrides the count.
 */
/** The menu select given everything but the searchable path's own props. */
const PlainSelect = React.forwardRef<HTMLDivElement, SelectProps>((props, ref) => {
  // The searchable path's own props: nothing for MUI's Select to receive.
  const { searchable: _searchable, noOptionsText: _noOptionsText, ...menuProps } = props;
  return <MenuSelect {...menuProps} ref={ref} />;
});

PlainSelect.displayName = 'PlainSelect';

/**
 * The search box, fetched only by a select that needs one.
 *
 * A static import put MUI `Autocomplete` (~29 KB) into every bundle that renders
 * any `Select`, a menu of two options included: a storefront checkout grew past
 * its page-load budget on the upgrade alone. A chunk that fails to load — the
 * previous deploy's hash, gone — degrades to the menu select, which has the same
 * props, events and test ids, rather than taking the screen down with it.
 */
const SearchableSelect = React.lazy(() =>
  import('./Select.searchable').then(
    (module) => ({ default: module.SearchableSelect }),
    () => ({ default: PlainSelect }),
  ),
);

export const Select = React.forwardRef<HTMLDivElement, SelectProps>((props, ref) => {
  if (!shouldSearch(props)) return <PlainSelect {...props} ref={ref} />;
  // The menu select holds the field's place while the search box loads, so the
  // label, value and size are on screen from the first frame.
  return (
    <React.Suspense fallback={<PlainSelect {...props} ref={ref} />}>
      <SearchableSelect {...props} ref={ref} />
    </React.Suspense>
  );
});

Select.displayName = 'Select';
