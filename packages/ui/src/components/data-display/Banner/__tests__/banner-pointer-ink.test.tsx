/**
 * A HOVERED OR PRESSED BANNER KEEPS ITS WORDS READABLE (FUT-4519).
 *
 * The Banner paints the same inset tint as the Alert (`bannerPointerStates`),
 * which moves the surface toward the mode's absolute, the side the ink is on,
 * so the gap the words are read across closes under the pointer. FUT-4506 fixed
 * the Alert by stepping its ink the same way; this holds the Banner to the
 * same claim.
 *
 * jsdom resolves neither `:hover` nor `color-mix()`, so the claim is held in
 * two halves: the ARITHMETIC (the words, composited over the tinted surface
 * with the step the sheet actually emits, clear 4.5:1 in every state) and the
 * RULE (the sheet steps the title, the message and the children, and nothing
 * else). The rest colours are read from what the browser resolves.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createTheme, ThemeProvider } from '../../../../mui/styles';
import { muiThemeOptionsFrom } from '../../../../provider/mui-bridge';
import { blend, getContrastRatio } from '../../../../tokens/color';
import { createUiTheme } from '../../../../tokens/theme';
import { ACTIVE, HOVER, POINTER_INK_STEP } from '../../Alert/Alert.metrics';
import { blocksFor } from '../../__tests__/pointer-states.helpers';
import { Banner } from '../Banner';
import type { BannerVariant } from '../Banner.types';

/** WCAG 2.1 AA for normal-size text. The title (16px/600) is not "large", so it is held here too. */
const MIN_CONTRAST = 4.5;
const VARIANTS: readonly BannerVariant[] = ['info', 'success', 'warning', 'critical'];
const MODES = ['light', 'dark'] as const;
const STATES = ['rest', 'hover', 'press'] as const;
type Mode = (typeof MODES)[number];
type State = (typeof STATES)[number];

const ABSOLUTE = { black: '#000000', white: '#ffffff' } as const;
const TINT: Record<State, number> = { rest: 0, hover: HOVER.tintAlpha, press: ACTIVE.tintAlpha };
const PSEUDO: Record<'hover' | 'press', string> = { hover: ':hover', press: ':active' };
const sideOf = (mode: Mode): keyof typeof ABSOLUTE => (mode === 'dark' ? 'white' : 'black');

const themeOf = (mode: Mode) => createTheme(muiThemeOptionsFrom(createUiTheme({ mode })));

/** Every rule Emotion has injected in this file's jsdom. */
const emittedCss = (): string =>
  Array.from(document.querySelectorAll('style'))
    .map((el) => el.textContent ?? '')
    .join('\n');

/** The fraction of the ink KEPT by the `color-mix()` a state declares, or 1 when it declares none. */
function keptBy(state: 'hover' | 'press', side: keyof typeof ABSOLUTE): number {
  const css = blocksFor(emittedCss(), PSEUDO[state]).join('\n');
  const absolute = side === 'black' ? '#000' : '#fff';
  const match = css.match(new RegExp(`color-mix\\(in srgb, currentColor (\\d+)%, ${absolute}\\)`, 'u'));
  return match ? Number(match[1]) / 100 : 1;
}

/** The rgb() a rendered element resolves to for a property. */
const resolved = (el: Element | null, prop: 'color' | 'backgroundColor'): string => {
  if (!el) throw new Error('element not rendered');
  return getComputedStyle(el)[prop];
};

/** What a reader sees in one state: the surface under the tint, and the stepped ink of each word. */
function measure(variant: BannerVariant, mode: Mode, page: string, state: State) {
  const { unmount } = render(
    <ThemeProvider theme={themeOf(mode)}>
      <Banner variant={variant} title="Atenção" description="mensagem" data-testid="b" />
    </ThemeProvider>,
  );
  const root = document.querySelector('[data-testid="b"]');
  const washed = resolved(root, 'backgroundColor');
  // The wash is `alpha(main, 0.1)`; composite it over the page it sits on.
  const [r, g, b, a] = (washed.match(/[\d.]+/gu) ?? []).map(Number);
  const rest = blend(page, `rgb(${r}, ${g}, ${b})`, a ?? 1);
  const side = sideOf(mode);
  const surface = blend(rest, ABSOLUTE[side], TINT[state]);
  const ink = (el: Element | null, opacity: number): string => {
    // The message declares `color: inherit`: it reads the root's ink.
    const declared = resolved(el, 'color');
    const own = declared === 'inherit' ? resolved(root, 'color') : declared;
    const kept = state === 'rest' ? 1 : keptBy(state, side);
    const stepped = blend(ABSOLUTE[side], own, kept);
    return blend(surface, stepped, opacity);
  };
  const title = ink(root?.querySelector('.banner-title') ?? null, 1);
  const message = ink(root?.querySelector('.banner-description') ?? null, 0.9);
  unmount();
  return {
    title: getContrastRatio(title, surface),
    message: getContrastRatio(message, surface),
  };
}

describe.each(MODES)('Given a %s-mode Banner on the default palette', (mode) => {
  const ui = createUiTheme({ mode });
  describe.each([['paper', ui.palette.background.paper]] as const)(
    'on the %s page',
    (_name, page) => {
      describe.each(VARIANTS)('and the %s variant', (variant) => {
        it.each(STATES)('holds the title and the message at 4.5:1 or more %s', (state) => {
          const { title, message } = measure(variant, mode, page, state);
          // Print the numbers so a failing run records what was measured.
          expect({ state, title: Number(title.toFixed(2)), message: Number(message.toFixed(2)) }).toEqual({
            state,
            title: expect.toSatisfy((v: number) => v >= MIN_CONTRAST),
            message: expect.toSatisfy((v: number) => v >= MIN_CONTRAST),
          });
        });
      });
    },
  );
});

/** Split a selector list at its TOP-LEVEL commas: the press's `:has(...)` carries commas of its own. */
function selectorParts(list: string): string[] {
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

describe('Given the rule the sheet emits', () => {
  const emitted = (): string => {
    for (const mode of MODES) {
      render(
        <ThemeProvider theme={themeOf(mode)}>
          <Banner variant="info" title="Atenção" description="mensagem" dismissible dismissLabel="Fechar" data-testid="full" />
          <Banner variant="warning" data-testid="bare">
            Só o texto, como filho.
          </Banner>
        </ThemeProvider>,
      );
    }
    return emittedCss();
  };
  const percent = (step: number): string => `${Math.round((1 - step) * 100)}%`;
  const steppedTargets = (): string[] => {
    const parts = emitted()
      .split('}')
      .filter((chunk) => chunk.includes('color-mix(in srgb, currentColor'))
      .flatMap((chunk) => selectorParts(chunk.slice(0, chunk.indexOf('{'))));
    for (const part of parts) expect(part).toMatch(/:(hover|active)/);
    return [...new Set(parts.map((part) => part.split(/\s+/u).pop() ?? part))];
  };

  it('steps the title, the message and the children, and nothing else, while hovered or pressed', () => {
    expect(steppedTargets().sort()).toEqual(['.banner-children', '.banner-description', '.banner-title']);
  });

  it('steps by the Alert\'s own hover and press amounts, toward the mode\'s side', () => {
    const css = emitted();
    const hovered = blocksFor(css, ':hover').join('\n');
    const pressed = blocksFor(css, ':active').join('\n');
    expect(hovered).toContain(`color-mix(in srgb, currentColor ${percent(POINTER_INK_STEP.hover.black)}, #000)`);
    expect(hovered).toContain(`color-mix(in srgb, currentColor ${percent(POINTER_INK_STEP.hover.white)}, #fff)`);
    expect(pressed).toContain(`color-mix(in srgb, currentColor ${percent(POINTER_INK_STEP.press.black)}, #000)`);
    expect(pressed).toContain(`color-mix(in srgb, currentColor ${percent(POINTER_INK_STEP.press.white)}, #fff)`);
  });

  it('reaches a children-only message, which has no title and no description to step', () => {
    emitted();
    const words = document.querySelector('[data-testid="bare"] .banner-children');
    expect(words?.textContent).toBe('Só o texto, como filho.');
    expect(steppedTargets().some((target) => words?.matches(target))).toBe(true);
  });

  it('keeps the icon, the actions and the dismiss outside every stepped part', () => {
    emitted();
    const targets = steppedTargets();
    for (const id of ['full-icon', 'full-close']) {
      const el = document.querySelector(`[data-testid="${id}"]`);
      expect(el).not.toBeNull();
      expect(targets.filter((target) => el?.closest(target))).toEqual([]);
    }
  });
});
