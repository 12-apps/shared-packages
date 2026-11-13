import { fireEvent, render, screen } from '@testing-library/react';
import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { Button } from './Button';
import type { ButtonProps } from './Button.types';

/**
 * FUT-4861: MUI's press ripple and focus pulsate (`.MuiTouchRipple-root`) were
 * the button's LAST child at `z-index: 0`, so they painted over the label. The
 * button is now its own stacking context and the ripple sits at `z-index: -1`:
 * above the button's surface, below its label.
 *
 * jsdom resolves `getComputedStyle` by document order and never by
 * specificity, so the paint order is read off the rules the button's own
 * emotion class emitted. The browser pass (label contrast held down, focused,
 * and the focus pulsate's visibility) is in the delivery report.
 */
const VARIANTS = ['solid', 'outline', 'text', 'ghost', 'glass', 'gradient'] as const;
const COLORS = ['primary', 'success', 'danger', 'neutral'] as const;

const ownClass = (el: HTMLElement): string => {
  const own = el.className.split(/\s+/u).find((c) => c.startsWith('css-'));
  if (!own) throw new Error(`no emotion class on ${el.className}`);
  return own;
};

/** The declarations of every rule whose selector is exactly `selector`, last one wins. */
const declared = (selector: string, property: string): string | undefined =>
  Array.from(document.styleSheets)
    .flatMap((sheet) => Array.from(sheet.cssRules))
    .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.selectorText === selector)
    .map((rule) => rule.style.getPropertyValue(property))
    .filter(Boolean)
    .pop();

const renderButton = (mode: 'light' | 'dark', props: ButtonProps): HTMLElement => {
  render(
    <ThemeProvider theme={createTheme({ palette: { mode } })}>
      <Button {...props} dataTestId="b">
        Salvar
      </Button>
    </ThemeProvider>,
  );
  return screen.getByTestId('b');
};

describe('Button ripple layer (FUT-4861)', () => {
  describe.each(['light', 'dark'] as const)('in %s mode', (mode) => {
    it.each(VARIANTS.flatMap((variant) => COLORS.map((color) => ({ variant, color }))))(
      'paints the $variant $color ripple under the label: an isolated button, the ripple at -1',
      ({ variant, color }) => {
        const button = renderButton(mode, { variant, color });
        const cls = ownClass(button);
        expect(declared(`.${cls}`, 'isolation')).toBe('isolate');
        expect(declared(`.${cls} .MuiTouchRipple-root`, 'z-index')).toBe('-1');
        // The ripple is still there to be painted (MUI mounts it on the first press): only its layer moved.
        fireEvent.mouseDown(button);
        expect(button.querySelectorAll('.MuiTouchRipple-root')).toHaveLength(1);
      },
    );
  });

  it('asks for no layer of its own for the spinner or the icon: both paint above the ripple', () => {
    const button = renderButton('light', { loading: true, icon: <span>+</span> });
    // A loading button is disabled and mounts no ripple; what it does carry is
    // a spinner wrapper at the auto layer and an icon in the flow, both of which
    // paint above a `z-index: -1` ripple.
    expect(screen.getByTestId('b-loading').parentElement?.style.zIndex).toBe('');
    expect(screen.getByTestId('b-icon').style.zIndex).toBe('');
    expect(button.querySelectorAll('.MuiTouchRipple-root')).toHaveLength(0);
  });

  it('leaves a disabled button with no ripple at all', () => {
    const button = renderButton('light', { disabled: true });
    fireEvent.mouseDown(button);
    expect(button.querySelectorAll('.MuiTouchRipple-root')).toHaveLength(0);
  });
});
