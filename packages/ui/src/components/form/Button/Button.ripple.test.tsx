import { cleanup, render, screen } from '@testing-library/react';
import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { getLuminance } from '../../../tokens/color';
import { controlNeutral } from '../../../tokens/ink';
import { Button } from './Button';
import type { ButtonProps } from './Button.types';

/**
 * FUT-4861: the press ripple is painted in the absolute OPPOSITE the label's
 * ink (so it never moves the surface toward the label), and the focus pulsate
 * keeps `currentColor`. Read off the rules the button's emotion class emitted;
 * the browser pass holds the pixels.
 */
const VARIANTS = ['solid', 'outline', 'text', 'ghost', 'glass', 'gradient'] as const;
const COLORS = ['primary', 'success', 'danger', 'neutral'] as const;
const PRESS = '.MuiTouchRipple-ripple:not(.MuiTouchRipple-ripplePulsate)';

const rules = (): CSSStyleRule[] =>
  Array.from(document.styleSheets)
    .flatMap((sheet) => Array.from(sheet.cssRules))
    .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);

const colorOf = (selector: (s: string) => boolean): string | undefined =>
  rules()
    .filter((r) => selector(r.selectorText))
    .map((r) => r.style.getPropertyValue('color'))
    .filter(Boolean)
    .pop();

const renderButton = (mode: 'light' | 'dark', props: ButtonProps): { cls: string } => {
  render(
    <ThemeProvider theme={createTheme({ palette: { mode } })}>
      <Button {...props} dataTestId="b">
        Salvar
      </Button>
    </ThemeProvider>,
  );
  const cls = screen.getByTestId('b').className.split(/\s+/u).find((c) => c.startsWith('css-'));
  if (!cls) throw new Error('no emotion class');
  return { cls };
};

const BLACK = ['#000', '#000000', 'rgb(0, 0, 0)'];
const WHITE = ['#fff', '#ffffff', 'rgb(255, 255, 255)'];

/** The fill a variant paints its label on, read from the theme and not from the component. */
const FILLED = new Set<string>(['solid', 'gradient']);

const surfaceOf = (theme: ReturnType<typeof createTheme>, variant: string, color: string): string => {
  const fill: Record<string, string> = {
    primary: theme.palette.primary.main,
    success: theme.palette.success.main,
    danger: theme.palette.error.main,
    neutral: controlNeutral(theme).main,
  };
  return String(fill[color]);
};

describe('Button press ripple colour (FUT-4861)', () => {
  describe.each(['light', 'dark'] as const)('in %s mode', (mode) => {
    it.each(VARIANTS.flatMap((variant) => COLORS.map((color) => ({ variant, color }))))(
      '$variant $color: a filled button\'s press ripple sits on the fill side of the label, any other keeps currentColor',
      ({ variant, color }) => {
        const { cls } = renderButton(mode, { variant, color });
        const press = colorOf((s) => s === `.${cls} ${PRESS}`);
        if (!FILLED.has(variant)) {
          expect(press).toBeUndefined();
          return;
        }
        const label = String(colorOf((s) => s === `.${cls}`));
        const surface = surfaceOf(createTheme({ palette: { mode } }), variant, color);
        expect(getLuminance(surface) >= getLuminance(label) ? WHITE : BLACK).toContain(String(press));
      },
    );
  });

  it('paints black under a white label and white under a dark one', () => {
    const solid = renderButton('light', { variant: 'solid', color: 'primary' });
    expect(BLACK).toContain(String(colorOf((s) => s === `.${solid.cls} ${PRESS}`)));
  });

  it('leaves outline, text, ghost and glass with MUI\'s own ripple colour, so a press stays visible', () => {
    for (const variant of ['outline', 'text', 'ghost', 'glass'] as const) {
      const { cls } = renderButton('light', { variant, color: 'primary' });
      expect(colorOf((s) => s.startsWith(`.${cls} `) && s.includes('MuiTouchRipple'))).toBeUndefined();
      cleanup();
    }
  });

  it('does not repaint the focus pulsate or the ripple child', () => {
    const { cls } = renderButton('light', { variant: 'solid', color: 'primary' });
    const own = rules().filter((r) => r.selectorText.startsWith(`.${cls} `) && r.selectorText.includes('MuiTouchRipple'));
    const repainted = own.filter((r) => r.style.getPropertyValue('color'));
    expect(repainted.map((r) => r.selectorText)).toEqual([`.${cls} ${PRESS}`]);
    expect(own.some((r) => /ripplePulsate(?!\))/u.test(r.selectorText.replace(PRESS, '')))).toBe(false);
  });
});
