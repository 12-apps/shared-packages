// @vitest-environment jsdom
/**
 * The raw-MUI `Input` slot renders what MUI's `TextField` rendered (FUT-3402).
 *
 * `TextField` imports `Select` unconditionally, and with it `Menu`, `MenuList`,
 * `Popover` and `List`. The fallback slot sits in every host's checkout bundle
 * whether or not the host fills the slot, so it now composes the same parts
 * `TextField` composes for an outlined field, without the select branch. This
 * renders both, with the same props, and compares the DOM.
 */
import { TextField } from '@mui/material';
import { render } from '@testing-library/react';
import type { JSX } from 'react';
import { describe, expect, it } from 'vitest';

import { defaultCheckoutComponents } from '../mui-defaults';
import type { CheckoutInputProps } from '../ui';

const DefaultInput = defaultCheckoutComponents.Input;

/** What the slot used to render, verbatim. */
function TextFieldInput({ label, type = 'text', inputMode, fullWidth, required, autoComplete, placeholder, maxLength, value, error, helperText, endAdornment, onChange, onBlur, ...rest }: CheckoutInputProps): JSX.Element {
  return (
    <TextField
      label={label}
      type={type}
      size="small"
      fullWidth={fullWidth}
      required={required}
      placeholder={placeholder}
      value={value}
      error={error}
      helperText={helperText}
      onChange={onChange}
      onBlur={onBlur}
      slotProps={{
        htmlInput: { inputMode, maxLength, autoComplete, 'data-testid': rest['data-testid'] },
        input: { endAdornment },
      }}
    />
  );
}

/** React's generated ids differ per tree; everything else must not. */
function html(node: JSX.Element): string {
  const { container, unmount } = render(node);
  const out = container.innerHTML.replace(/_r_[0-9a-z]+_|:r[0-9a-z]+:/g, 'ID');
  unmount();
  return out;
}

const CASES: Record<string, CheckoutInputProps> = {
  bare: { value: '' },
  labelled: { label: 'CPF', value: '123', 'data-testid': 'buyer-cpf' },
  everything: {
    label: 'E-mail',
    type: 'email',
    inputMode: 'numeric',
    fullWidth: true,
    required: true,
    autoComplete: 'email',
    placeholder: 'voce@exemplo.com',
    maxLength: 80,
    value: 'a@b.c',
    error: true,
    helperText: 'E-mail inválido',
    endAdornment: <span>@</span>,
    'data-testid': 'buyer-email',
  },
  'helper without a label': { value: 'x', helperText: 'Obrigatório' },
};

describe('the default Input slot', () => {
  it.each(Object.entries(CASES))('renders what TextField rendered: %s', (_name, props) => {
    expect(html(<DefaultInput {...props} />)).toBe(html(<TextFieldInput {...props} />));
  });
});
