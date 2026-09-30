import React, { useCallback, useId } from 'react';

import { Input } from '../Input';

import { clamp, formatValue, isRefusedKey, parseDigits, stepValue } from './NumberField.helpers';
import type { NumberFieldProps } from './NumberField.types';

/**
 * A digits-only number input whose value is a `number | null`.
 *
 * - `inputMode="numeric"` on the `<input>` itself, so a phone opens its number
 *   pad (the attribute does nothing anywhere else — see `Input.types.ts`).
 * - A non-digit keystroke never reaches the field, and a paste keeps only its
 *   digits: `"1.500 min"` pastes as `1500`.
 * - `suffix` is drawn inside the field's border, and read as its description.
 * - ArrowUp / ArrowDown move by `step`, never past `min` / `max`. Typing may go
 *   out of bounds for a moment (typing `5` on the way to `50` must not snap to a
 *   minimum of 10); the blur brings it back inside.
 * - Clearing the field reports `null`, not `0` and not `NaN`.
 *
 * `role="spinbutton"` with `aria-valuenow` / `-min` / `-max`, because that is
 * what the arrow keys make it — a screen reader then says so, and says where
 * in the range the value sits.
 */
export const NumberField = React.forwardRef<HTMLInputElement, NumberFieldProps>(function NumberField(
  props,
  ref,
) {
  const {
    value, onChange, min, max, step = 1, suffix, onKeyDown, onBlur, inputProps, id: idProp,
    'aria-describedby': callerDescribedBy, ...rest
  } = props;
  const generated = useId();
  const id = idProp ?? `number-field-${generated}`;
  const suffixId = `${id}-suffix`;

  const commit = useCallback(
    (next: number | null) => {
      if (next !== value) onChange(next);
    },
    [value, onChange],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      commit(stepValue(value, event.key === 'ArrowUp' ? 1 : -1, step, { min, max }));
    } else if (isRefusedKey(event)) {
      event.preventDefault();
    }
  };

  const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    if (value !== null) commit(clamp(value, { min, max }));
    onBlur?.(event);
  };

  const describedBy = [callerDescribedBy, suffix != null ? suffixId : undefined].filter(Boolean).join(' ');

  return (
    <Input
      ref={ref}
      {...rest}
      id={id}
      type="text"
      autoComplete="off"
      value={formatValue(value)}
      onChange={(event) => commit(parseDigits(event.target.value))}
      onBlur={handleBlur}
      aria-describedby={describedBy || undefined}
      endAdornment={suffix != null ? <span id={suffixId}>{suffix}</span> : undefined}
      inputProps={{
        ...inputProps,
        inputMode: 'numeric',
        pattern: '[0-9]*',
        role: 'spinbutton',
        'aria-valuenow': value ?? undefined,
        'aria-valuemin': min,
        'aria-valuemax': max,
        onKeyDown: handleKeyDown,
      }}
    />
  );
});

NumberField.displayName = 'NumberField';
