import { fireEvent, render, screen } from '@testing-library/react';
import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { Button } from './Button';
import type { ButtonProps } from './Button.types';

/**
 * FUT-4861: MUI's press ripple and focus pulsate (`.MuiTouchRipple-root`) are
 * the button's LAST child at `z-index: 0`, so they painted over the label. The
 * CONTENT now takes the layer above them (the label wrapper, the icon slots, the
 * spinner: `position: relative; z-index: 1`), and the button is NOT a stacking
 * context, so a `pulse` button's `::after` (z-index -1) still paints behind the
 * button's own fill, as on main.
 *
 * jsdom resolves `getComputedStyle` by document order and never by
 * specificity, so the paint order is read off the rules the button's own
 * emotion class emitted and the inline styles of its content. The browser pass
 * is in the delivery report.
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
      'lifts the $variant $color content above the ripple without making the button a stacking context',
      ({ variant, color }) => {
        const button = renderButton(mode, { variant, color, icon: <span>+</span> });
        const cls = ownClass(button);
        const label = button.querySelector<HTMLElement>(':scope > span:not(.MuiButton-startIcon)');
        expect(label?.style.position).toBe('relative');
        expect(label?.style.zIndex).toBe('1');
        expect(declared(`.${cls}>.MuiButton-startIcon,.${cls}>.MuiButton-endIcon`, 'z-index')).toBe('1');
        // No context on the button, and the ripple is left at MUI's own layer.
        expect(declared(`.${cls}`, 'isolation')).toBeUndefined();
        expect(declared(`.${cls} .MuiTouchRipple-root`, 'z-index')).toBeUndefined();
        // The ripple is still there to be painted (MUI mounts it on the first press).
        fireEvent.mouseDown(button);
        expect(button.querySelectorAll('.MuiTouchRipple-root')).toHaveLength(1);
      },
    );
  });

  it.each(['solid', 'outline', 'gradient'] as const)(
    'keeps a pulse %s button\'s ::after behind its fill: no isolation, the layer at -1',
    (variant) => {
      const button = renderButton('light', { variant, pulse: true });
      const cls = ownClass(button);
      expect(declared(`.${cls}`, 'isolation')).toBeUndefined();
      expect(declared(`.${cls}::after`, 'z-index')).toBe('-1');
    },
  );

  it('asks for the layer above the ripple for the spinner too', () => {
    const loadingButton = renderButton('light', { loading: true, icon: <span>+</span> });
    expect(screen.getByTestId('b-loading').parentElement?.style.zIndex).toBe('1');
    // A loading button is disabled and mounts no ripple.
    fireEvent.mouseDown(loadingButton);
    expect(loadingButton.querySelectorAll('.MuiTouchRipple-root')).toHaveLength(0);
  });

  it('leaves a disabled button with no ripple at all', () => {
    const offButton = renderButton('light', { disabled: true });
    fireEvent.mouseDown(offButton);
    expect(offButton.querySelectorAll('.MuiTouchRipple-root')).toHaveLength(0);
  });
});
