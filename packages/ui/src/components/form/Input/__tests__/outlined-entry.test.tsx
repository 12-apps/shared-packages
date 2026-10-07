import { ThemeProvider, createTheme } from '@mui/material/styles/index.js';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { Input } from '../Input';
import type { InputProps } from '../Input.types';
import { Input as OutlinedInput } from '../outlined';
import type { OutlinedInputVariant } from '../outlined';

/**
 * The outlined entry is the generic `Input` with one MUI input instead of three
 * (FUT-1054), and this is how "the same component" is checked: by rendering
 * both from one set of props and comparing the DOM, for every variant the
 * outlined entry accepts.
 *
 * Each render gets its own explicit `id`: `Input` derives one from
 * `React.useId()` otherwise, and two trees would differ on that alone.
 */
const theme = createTheme();

function html(node: ReactElement): string {
  const { container, unmount } = render(<ThemeProvider theme={theme}>{node}</ThemeProvider>);
  const out = container.innerHTML;
  unmount();
  return out;
}

const VARIANTS: OutlinedInputVariant[] = ['outlined', 'glass', 'gradient'];

const CASES: Record<string, Omit<InputProps, 'variant'>> = {
  bare: { id: 'f' },
  'label and helper text': { id: 'f', label: 'CEP', helperText: 'Somente números', placeholder: '00000-000' },
  error: { id: 'f', label: 'CEP', error: true, helperText: 'CEP inválido' },
  adornments: { id: 'f', startAdornment: <span>R$</span>, endAdornment: <span>kg</span> },
  loading: { id: 'f', label: 'CEP', loading: true },
  'small, not full width': { id: 'f', size: 'sm', fullWidth: false, 'aria-label': 'Buscar produtos', type: 'search' },
  'test id and ARIA': { id: 'f', 'data-testid': 'cep', 'aria-describedby': 'cep-status', 'aria-busy': true },
};

describe('the outlined Input entry', () => {
  describe.each(VARIANTS)('variant %s', (variant) => {
    it.each(Object.entries(CASES))('renders what the generic Input renders: %s', (_name, props) => {
      expect(html(<OutlinedInput variant={variant} {...props} />)).toBe(html(<Input variant={variant} {...props} />));
    });
  });

  it('renders outlined when no variant is given, as the generic Input does', () => {
    expect(html(<OutlinedInput id="f" label="CEP" />)).toBe(html(<Input id="f" label="CEP" />));
  });

  it('keeps the generic displayName', () => {
    expect(OutlinedInput.displayName).toBe('Input');
  });
});
