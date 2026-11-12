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
import { inkAbsolute, pointerInkStyles } from '../Alert.ink';
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
    expect(inkAbsolute(themeOf(mode), 'info')).toBe(sideOf(mode));
  });

  it.each(MODES)('steps a %s-mode gradient toward the side its ink is on, like a semantic one', (mode) => {
    // The gradient's ink follows the mode since FUT-4516 (dark text over a
    // light sweep, white over a deep one), so its ink side is known and the
    // step is the mode's like every other variant's. It was `null` while the
    // ink was `getContrastText` of the hue and a host repaint could flip it.
    const styles = pointerInkStyles(themeOf(mode), 'gradient');
    expect(inkAbsolute(themeOf(mode), 'gradient')).toBe(sideOf(mode));
    expect(styles).toEqual(pointerInkStyles(themeOf(mode), 'info'));
    expect(JSON.stringify(styles.press)).toContain(mode === 'dark' ? ', #fff)' : ', #000)');
  });
});

/** Split a selector list at its TOP-LEVEL commas — the press's `:has(…)` carries commas of its own. */
function selectorParts(list: string): string[] {
  // A reduce rather than a walk with `let`s: the flakiness lane rejects
  // reassigning a closed-over binding (see `pointer-states.helpers.tsx`).
  const { parts, current } = Array.from(list).reduce(
    (acc, char) => {
      const depth = acc.depth + (char === '(' ? 1 : char === ')' ? -1 : 0);
      if (char === ',' && depth === 0) return { parts: [...acc.parts, acc.current], current: '', depth };
      return { parts: acc.parts, current: acc.current + char, depth };
    },
    { parts: [] as string[], current: '', depth: 0 },
  );
  return [...parts, current].map((part) => part.trim());
}

/** The element each stepped selector part lands on: its last compound, e.g. `.MuiAlertTitle-root`. */
const targetOf = (part: string): string => part.split(/\s+/u).pop() ?? part;

describe('Given the rule the sheet emits', () => {
  const VARIANTS = ['info', 'success', 'warning', 'danger', 'glass', 'gradient'] as const;
  const titled = (mode: Mode) =>
    createTheme({ ...muiThemeOptionsFrom(createUiTheme({ mode })), uiAlert: { iconPlacement: 'title' } });
  const emitted = (): string => {
    for (const mode of MODES) {
      for (const variant of VARIANTS) {
        render(
          <ThemeProvider theme={createTheme(muiThemeOptionsFrom(createUiTheme({ mode })))}>
            <Alert variant={variant} title="Atenção" description="mensagem" closable closeLabel="Fechar" data-testid="surface" />
            <Alert variant={variant}>Só o texto, como filho.</Alert>
          </ThemeProvider>,
        );
        render(
          <ThemeProvider theme={titled(mode)}>
            <Alert variant={variant} title="Atenção" description="mensagem" />
          </ThemeProvider>,
        );
      }
    }
    return Array.from(document.querySelectorAll('style'))
      .map((el) => el.textContent ?? '')
      .join('\n');
  };
  const percent = (step: number): string => `${Math.round((1 - step) * 100)}%`;
  const steppedParts = (css: string): string[] =>
    css
      .split('}')
      .filter((chunk) => chunk.includes('color-mix(in srgb, currentColor'))
      .flatMap((chunk) => selectorParts(chunk.slice(0, chunk.indexOf('{'))));
  const steppedTargets = (): string[] => [...new Set(steppedParts(emitted()).map(targetOf))];

  it('steps the title, the description and the children, and nothing else, while hovered or pressed', () => {
    const parts = steppedParts(emitted());
    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) expect(part).toMatch(/:(hover|active)/);
    expect(steppedTargets().sort()).toEqual(['.MuiAlertTitle-root', '.alert-children', '.alert-description']);
  });

  it('steps by the hover and the press amounts, toward the side', () => {
    const css = emitted();
    const hovered = blocksFor(css, ':hover').join('\n');
    const pressed = blocksFor(css, ':active').join('\n');
    expect(hovered).toContain(`color-mix(in srgb, currentColor ${percent(POINTER_INK_STEP.hover.black)}, #000)`);
    expect(hovered).toContain(`color-mix(in srgb, currentColor ${percent(POINTER_INK_STEP.hover.white)}, #fff)`);
    expect(pressed).toContain(`color-mix(in srgb, currentColor ${percent(POINTER_INK_STEP.press.black)}, #000)`);
    expect(pressed).toContain(`color-mix(in srgb, currentColor ${percent(POINTER_INK_STEP.press.white)}, #fff)`);
  });

  it('reaches a children-only message, which has no title and no description to step', () => {
    render(<Alert variant="warning" data-testid="bare">Só o texto, como filho.</Alert>);
    const words = document.querySelector('[data-testid="bare"] .MuiAlert-message')?.firstElementChild;
    expect(words?.textContent).toBe('Só o texto, como filho.');
    expect(steppedTargets().some((target) => words?.closest(target))).toBe(true);
  });

  it('keeps a title-row icon still: it sits in the column, beside the title, under no stepped part', () => {
    render(
      <ThemeProvider theme={titled('light')}>
        <Alert variant="info" title="Esta loja entrega aí" description="A entrega é grátis." data-testid="answer" />
      </ThemeProvider>,
    );
    const icon = document.querySelector('[data-testid="answer-icon"]');
    const title = document.querySelector('[data-testid="answer-title"]');
    // The case that matters: the icon IS inside the message column here.
    expect(icon?.closest('.MuiAlert-message')).not.toBeNull();
    const targets = steppedTargets();
    expect(targets.filter((target) => icon?.closest(target))).toEqual([]);
    expect(targets.some((target) => title?.closest(target))).toBe(true);
  });

  it('keeps the gutter icon and the close button outside every stepped part', () => {
    render(<Alert variant="info" title="Atenção" description="mensagem" closable closeLabel="Fechar" data-testid="closable" />);
    const close = document.querySelector('[data-testid="closable-close"]');
    const icon = document.querySelector('[data-testid="closable-icon"]');
    expect(close?.closest('.MuiAlert-action')).not.toBeNull();
    const targets = steppedTargets();
    expect(targets.filter((target) => close?.closest(target) || icon?.closest(target))).toEqual([]);
  });
});
