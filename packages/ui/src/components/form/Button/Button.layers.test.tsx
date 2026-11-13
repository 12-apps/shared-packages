import { fireEvent, render, screen } from '@testing-library/react';
import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { Button } from './Button';
import type { ButtonProps } from './Button.types';

/**
 * FUT-4861: MUI's press ripple and focus pulsate (`.MuiTouchRipple-root`) are
 * the button's LAST child at `z-index: 0`, so they painted over the label. The
 * button is its own stacking context and the ripple sits at `z-index: -1`:
 * above the button's surface, below its label. The DOM is MUI's own (no label
 * wrapper, no z-index on the content). A `pulse` button keeps MUI's layering,
 * because its `::after` (z-index -1) must stay behind the fill.
 *
 * jsdom resolves `getComputedStyle` by document order and never by
 * specificity, so the paint order is read off the rules the button's own
 * emotion class emitted. The browser pass is in the delivery report.
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
        const button = renderButton(mode, { variant, color, icon: <span>+</span> });
        const cls = ownClass(button);
        expect(declared(`.${cls}`, 'isolation')).toBe('isolate');
        expect(declared(`.${cls} .MuiTouchRipple-root`, 'z-index')).toBe('-1');
        fireEvent.mouseDown(button);
        expect(button.querySelectorAll('.MuiTouchRipple-root')).toHaveLength(1);
      },
    );
  });

  it.each(['solid', 'outline', 'gradient'] as const)(
    'leaves a pulse %s button with MUI\'s layering: no isolation, no ripple layer, ::after at -1',
    (variant) => {
      const button = renderButton('light', { variant, pulse: true });
      const cls = ownClass(button);
      expect(declared(`.${cls}`, 'isolation')).toBeUndefined();
      expect(declared(`.${cls} .MuiTouchRipple-root`, 'z-index')).toBeUndefined();
      expect(declared(`.${cls}::after`, 'z-index')).toBe('-1');
    },
  );

  it('keeps MUI\'s DOM: the label is a bare text child and nothing in the content takes a layer', () => {
    const button = renderButton('light', { icon: <span>+</span> });
    const cls = ownClass(button);
    expect(Array.from(button.childNodes).some((n) => n.nodeType === 3 && n.textContent === 'Salvar')).toBe(true);
    expect(button.querySelectorAll(':scope > span:not(.MuiButton-startIcon):not(.MuiTouchRipple-root)')).toHaveLength(0);
    expect(declared(`.${cls}>.MuiButton-startIcon,.${cls}>.MuiButton-endIcon`, 'z-index')).toBeUndefined();
    expect(screen.getByTestId('b-icon').style.zIndex).toBe('');
  });

  it('adds no z-index to the loading spinner, which is positioned and so paints above the ripple', () => {
    const loadingButton = renderButton('light', { loading: true, icon: <span>+</span> });
    expect(screen.getByTestId('b-loading').parentElement?.style.zIndex).toBe('');
    fireEvent.mouseDown(loadingButton);
    expect(loadingButton.querySelectorAll('.MuiTouchRipple-root')).toHaveLength(0);
  });

  it('leaves a disabled button with no ripple at all', () => {
    const offButton = renderButton('light', { disabled: true });
    fireEvent.mouseDown(offButton);
    expect(offButton.querySelectorAll('.MuiTouchRipple-root')).toHaveLength(0);
  });
});
