/**
 * A HOVERED OR PRESSED ALERT KEEPS ITS WORDS READABLE (FUT-4506).
 *
 * The pointer states lay a tint over the surface that moves it toward the
 * mode's absolute — the side the ink is on — so the gap the title and summary
 * are read across closed under the pointer. A summary at 4.71:1 idle fell to
 * 4.22:1 hovered and 3.17:1 pressed; in dark mode, to 2.68:1. Nothing in the
 * suite noticed, because nothing measured a state other than rest.
 *
 * The fix steps the title and summary ink toward the same absolute while the
 * tint is on (`POINTER_INK_STEP`), as a `color-mix()` over `currentColor` so a
 * host's repainted ink is stepped too. jsdom resolves neither `:hover` nor
 * `color-mix()`, so this file holds the claim in two halves: the ARITHMETIC
 * (the composited colours clear 4.5:1 in every state) and the RULE (the sheet
 * actually emits that step, on those two lines, at those amounts).
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createTheme, ThemeProvider } from '../../../../mui/styles';
import { muiThemeOptionsFrom } from '../../../../provider/mui-bridge';
import { blend, getContrastRatio } from '../../../../tokens/color';
import { createUiTheme } from '../../../../tokens/theme';
import { blocksFor } from '../../__tests__/pointer-states.helpers';
import { Alert } from '../Alert';
import { inkAbsolute } from '../Alert.ink';
import { ACTIVE, DESCRIPTION, HOVER, POINTER_INK_STEP, semanticSurface } from '../Alert.metrics';

/** WCAG 2.1 AA for normal-size text. The title (16.8px/600) is not "large", so it is held here too. */
const MIN_CONTRAST = 4.5;

const SEVERITIES = ['info', 'success', 'warning', 'danger'] as const;
const MODES = ['light', 'dark'] as const;
const STATES = ['rest', 'hover', 'press'] as const;
type Mode = (typeof MODES)[number];
type State = (typeof STATES)[number];

const ABSOLUTE = { black: '#000000', white: '#ffffff' } as const;
const TINT: Record<State, number> = { rest: 0, hover: HOVER.tintAlpha, press: ACTIVE.tintAlpha };

/** The ink side for a semantic alert: the mode's absolute, what the tint layer is painted in. */
const sideOf = (mode: Mode): keyof typeof ABSOLUTE => (mode === 'dark' ? 'white' : 'black');

/**
 * What a reader sees in one state: the pane under the tint layer, the ink
 * stepped as the `color-mix()` steps it, and the summary at its 0.9 opacity.
 */
function painted(pane: string, ink: string, mode: Mode, state: State): { title: number; summary: number } {
  const side = sideOf(mode);
  const surface = blend(pane, ABSOLUTE[side], TINT[state]);
  const stepped = state === 'rest' ? ink : blend(ink, ABSOLUTE[side], POINTER_INK_STEP[state][side]);
  const summary = blend(surface, stepped, DESCRIPTION.opacity);
  return { title: getContrastRatio(stepped, surface), summary: getContrastRatio(summary, surface) };
}

describe.each(MODES)('Given a %s-mode Alert on the default palette', (mode) => {
  const ui = createUiTheme({ mode });

  describe.each(SEVERITIES)('and the %s severity', (severity) => {
    const { backgroundColor, color } = semanticSurface(ui, ui.palette[severity]);

    it.each(STATES)('holds the title and the summary at 4.5:1 or more %s', (state) => {
      const { title, summary } = painted(backgroundColor, color, mode, state);
      expect({ state, title: title >= MIN_CONTRAST, summary: summary >= MIN_CONTRAST }).toEqual({
        state,
        title: true,
        summary: true,
      });
    });

    it('never lets a pointer state read worse than the tint alone would', () => {
      // The step must WIDEN the gap the tint closes, never narrow it further.
      for (const state of ['hover', 'press'] as const) {
        const side = sideOf(mode);
        const surface = blend(backgroundColor, ABSOLUTE[side], TINT[state]);
        const unstepped = getContrastRatio(blend(surface, color, DESCRIPTION.opacity), surface);
        expect(painted(backgroundColor, color, mode, state).summary).toBeGreaterThan(unstepped);
      }
    });
  });
});

describe('Given a repainted pane whose summary sits just above the floor at rest', () => {
  // The worst case the step was measured on: a 16% wash of the hue over paper,
  // with the ink chosen to clear the floor there — the tones a theme override
  // repaints every alert with. Untouched, the press took these to 3.05:1 and
  // 2.69:1.
  const PANES: Array<{ mode: Mode; pane: string; ink: string }> = [
    { mode: 'light', pane: '#deeade', ink: '#266729' },
    { mode: 'light', pane: '#d7ecf8', ink: '#015d8f' },
    { mode: 'dark', pane: '#0f2531', ink: '#02a2f9' },
    { mode: 'dark', pane: '#162317', ink: '#40ad45' },
  ];

  it.each(PANES)('keeps the $mode $ink summary at 4.5:1 hovered and pressed', ({ mode, pane, ink }) => {
    // The case bites: pressed with the tint and no step, the summary fails.
    const surface = blend(pane, ABSOLUTE[sideOf(mode)], ACTIVE.tintAlpha);
    expect(getContrastRatio(blend(surface, ink, DESCRIPTION.opacity), surface)).toBeLessThan(MIN_CONTRAST);
    for (const state of ['hover', 'press'] as const) {
      const { title, summary } = painted(pane, ink, mode, state);
      expect({ state, title: title >= MIN_CONTRAST, summary: summary >= MIN_CONTRAST }).toEqual({
        state,
        title: true,
        summary: true,
      });
    }
  });
});

describe('Given which absolute the ink steps toward', () => {
  const themeOf = (mode: Mode) => createTheme(muiThemeOptionsFrom(createUiTheme({ mode })));

  it.each(MODES)('steps a semantic %s-mode ink toward the side it is already on', (mode) => {
    const theme = themeOf(mode);
    expect(inkAbsolute(theme, theme.palette.info, 'info')).toBe(sideOf(mode));
  });

  it('steps a dark ink on a dark-mode gradient toward black, away from its surface (FUT-4516 owns its rest)', () => {
    // `getContrastText` of dark mode's light info is DARK. Keyed by the mode it
    // would step toward white — onto the gradient it is read against.
    const theme = themeOf('dark');
    expect(inkAbsolute(theme, theme.palette.info, 'gradient')).toBe('black');
  });

  it('steps a white ink on a light-mode gradient toward white, which leaves it where it is', () => {
    const theme = themeOf('light');
    expect(inkAbsolute(theme, theme.palette.info, 'gradient')).toBe('white');
  });
});

describe('Given the rule the sheet emits', () => {
  const VARIANTS = ['info', 'success', 'warning', 'danger', 'glass', 'gradient'] as const;
  const emitted = (): string => {
    for (const mode of MODES) {
      for (const variant of VARIANTS) {
        render(
          <ThemeProvider theme={createTheme(muiThemeOptionsFrom(createUiTheme({ mode })))}>
            <Alert variant={variant} title="Atenção" description="mensagem" data-testid="surface" />
          </ThemeProvider>,
        );
      }
    }
    return Array.from(document.querySelectorAll('style'))
      .map((el) => el.textContent ?? '')
      .join('\n');
  };
  const percent = (step: number): string => `${Math.round((1 - step) * 100)}%`;

  it('steps the title and the summary, and nothing else, while hovered', () => {
    const css = emitted();
    const rule = `color-mix(in srgb, currentColor ${percent(POINTER_INK_STEP.hover.black)}, #000)`;
    const stepped = css.split('}').filter((chunk) => chunk.includes(rule));
    expect(stepped.length).toBeGreaterThan(0);
    for (const chunk of stepped) {
      const selector = chunk.slice(0, chunk.indexOf('{'));
      expect(selector).toMatch(/:hover/);
      for (const part of selector.split(',')) expect(part).toMatch(/\.MuiAlertTitle-root|\.alert-description/);
    }
  });

  it('steps by the press amount, toward the side, while pressed', () => {
    const css = emitted();
    const pressed = blocksFor(css, ':active').join('\n');
    expect(pressed).toContain(`color-mix(in srgb, currentColor ${percent(POINTER_INK_STEP.press.black)}, #000)`);
    expect(pressed).toContain(`color-mix(in srgb, currentColor ${percent(POINTER_INK_STEP.press.white)}, #fff)`);
  });

  it('puts the summary class on the description, so the rule has something to reach', () => {
    render(<Alert variant="info" description="mensagem" data-testid="described" />);
    expect(document.querySelector('[data-testid="described-message"]')?.classList).toContain('alert-description');
  });
});
