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
import { TextField, ThemeProvider, createTheme } from '@mui/material';
import type { Theme } from '@mui/material';
import { fireEvent, render, waitFor } from '@testing-library/react';
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

const ID = /_r_[0-9a-z]+_|:r[0-9a-z]+:/g;

/** React's generated ids differ per tree; everything else must not. */
function html(node: JSX.Element, theme?: Theme): string {
  const { container, unmount } = render(theme ? <ThemeProvider theme={theme}>{node}</ThemeProvider> : node);
  const out = container.innerHTML.replace(ID, 'ID');
  unmount();
  return out;
}

/** The DOM after the field takes focus: the label shrinks, the root is focused. */
async function focusedHtml(node: JSX.Element): Promise<string> {
  const { container, unmount } = render(node);
  fireEvent.focusIn(container.querySelector('input') as HTMLInputElement);
  await waitFor(() => expect(container.querySelector('.Mui-focused')).not.toBeNull());
  const out = container.innerHTML.replace(ID, 'ID');
  unmount();
  return out;
}

/**
 * A host theme reaches `TextField` through `components.MuiTextField`. Every
 * hook it offers there has to reach the slot too, or a host that styled its
 * text fields sees the checkout's change — or, for a function reading
 * `ownerState`, sees it throw.
 */
const THEMES: Record<string, Theme> = {
  'a styleOverrides function reading ownerState': createTheme({
    components: { MuiTextField: { styleOverrides: { root: ({ ownerState }) => ({ marginTop: ownerState.size === 'small' ? 3 : 7 }) } } },
  }),
  'variants keyed on variant and color': createTheme({
    components: {
      MuiTextField: {
        variants: [
          { props: { variant: 'outlined' }, style: { marginTop: 9 } },
          { props: { color: 'primary' }, style: { marginBottom: 4 } },
        ],
      },
    },
  }),
  'defaultProps fullWidth': createTheme({ components: { MuiTextField: { defaultProps: { fullWidth: true } } } }),
  'defaultProps pinning the label shrunk': createTheme({
    components: { MuiTextField: { defaultProps: { slotProps: { inputLabel: { shrink: true } } } } },
  }),
  'defaultProps helper-text and html-input slot props': createTheme({
    components: {
      MuiTextField: {
        defaultProps: { slotProps: { formHelperText: { component: 'span' }, htmlInput: { spellCheck: false } } },
      },
    },
  }),
};

const LABELLED: CheckoutInputProps = { label: 'CPF', value: '123', 'data-testid': 'buyer-cpf' };

const CASES: Record<string, CheckoutInputProps> = {
  bare: { value: '' },
  labelled: LABELLED,
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

  it('renders what TextField rendered once focused', async () => {
    expect(await focusedHtml(<DefaultInput {...LABELLED} />)).toBe(await focusedHtml(<TextFieldInput {...LABELLED} />));
  });

  describe.each(Object.entries(THEMES))('under a host theme with %s', (_name, theme) => {
    it.each(Object.entries(CASES))('renders what TextField rendered: %s', (_case, props) => {
      expect(html(<DefaultInput {...props} />, theme)).toBe(html(<TextFieldInput {...props} />, theme));
    });
  });
});
