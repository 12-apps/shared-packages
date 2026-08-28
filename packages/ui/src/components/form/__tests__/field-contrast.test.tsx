/**
 * A FIELD MUST BE VISIBLE BEFORE ANYONE HAS TOUCHED IT.
 *
 * Every outlined control here drew its resting border from
 * `alpha(theme.palette.divider, 0.23)` — 0.2 in some, 0.18 in others, 0.42 for
 * the underline. That expression is a no-op against MUI's DEFAULT theme, whose
 * `divider` is already `rgba(0, 0, 0, 0.12)`: `alpha()` REPLACES the alpha
 * channel rather than multiplying it, so the result is `rgba(0, 0, 0, 0.23)` —
 * byte for byte the border MUI's own `OutlinedInput` ships. Every existing test
 * rendered under that theme, so every existing test agreed with it.
 *
 * Give it a theme whose `divider` is an OPAQUE hex — which is what a themed
 * adopter sets, and what a hairline actually is — and the same line resolves to
 * within 1.06:1 of the paper behind it. The field is not faint; it is gone until
 * you click into it.
 *
 * So {@link THEMES} is the fixture that matters. The two hairline rows are real
 * adopter palettes, not synthetic worst cases, and a suite that only rendered
 * `createTheme()` would have gone green on every commit this shipped broken.
 *
 * ## Why the assertion reads the emitted CSS rather than `getComputedStyle`
 *
 * The border is declared by a DESCENDANT rule — `& .MuiOutlinedInput-root &
 * fieldset`, specificity 0-2-1 — that outranks the 0-1-0 class MUI puts on the
 * fieldset itself. A browser resolves that correctly; jsdom does not do so
 * reliably, and answered with MUI's own default on two of the four themes here
 * while agreeing with the package on the other two. Asserting through it would
 * have made this suite's verdict depend on which theme it happened to be given.
 *
 * The real browser is not in doubt about which rule wins: the bug REPORT is a
 * screenshot of a field at 1.06:1, which is the package's value — MUI's own
 * default is 1.74:1. So what is worth pinning is the declaration each component
 * emits for a given theme, and that is what these read.
 */
import { render } from '@testing-library/react';
import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import type { Theme } from '@mui/material/styles/index.js';
import { describe, expect, it } from 'vitest';

import { fieldEdge, MIN_UI_CONTRAST } from '../../../tokens/field-edge';
import { Input } from '../Input';
import { Select } from '../Select';
import { Textarea } from '../Textarea';

/**
 * A `#RGB` or `#RRGGBB` as `rgb()`.
 *
 * The short form is not a curiosity to tolerate: MUI's own default
 * `background.paper` is `#fff`, so a parser assuming six digits reads it as
 * `rgb(0, 15, 255)` and measures every default-theme assertion against a blue
 * nobody rendered.
 */
function asRgb(hex: string): string {
  const body = hex.replace('#', '');
  const full = body.length === 3 ? body.replace(/./gu, (c) => c + c) : body;
  const n = Number.parseInt(full, 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

function channels(colour: string): [number, number, number] {
  const parts = colour.match(/[\d.]+/gu);
  if (!parts || parts.length < 3) throw new Error(`unreadable colour: ${colour}`);
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

function luminance(colour: string): number {
  const linear = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = channels(colour);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Every rule emotion has put in the document, as one string. */
function emittedCss(): string {
  return Array.from(document.querySelectorAll('style'))
    .map((tag) => tag.textContent ?? '')
    .join('\n');
}

/**
 * The colour a component declares, measured from the rules THIS render added.
 *
 * The delta matters. `emittedCss()` is the whole document, and emotion never
 * removes a rule, so a component asserted against the total would pass on a
 * colour one of its siblings emitted three tests earlier — which is exactly
 * what happened when this was first written: reverting `Input` alone left the
 * `Select` and `Textarea` assertions green.
 */
function declaresAfterRender(paint: () => void, colour: string): boolean {
  const before = emittedCss();
  paint();
  return emittedCss().slice(before.length).includes(colour);
}

/** The paper a field is drawn on, as the `rgb()` the ratio helpers want. */
function paperOf(theme: Theme): string {
  return asRgb(theme.palette.background.paper);
}

/**
 * MUI's default, plus the two real adopter palettes and one of them in dark.
 *
 * `divider` is opaque in the adopter rows because that is the whole mechanism: a
 * hairline picked to separate two rows inside a card, then faded again over the
 * card it sits on.
 */
const THEMES: [string, Theme][] = [
  ['MUI default', createTheme()],
  [
    'warm hairline',
    createTheme({
      palette: { divider: '#EBD9C7', background: { paper: '#FFFFFF', default: '#FDF8F2' } },
    }),
  ],
  [
    'cool hairline',
    createTheme({
      palette: { divider: '#D7DDD5', background: { paper: '#F4F6F3', default: '#F4F6F3' } },
    }),
  ],
  [
    'dark cool hairline',
    createTheme({
      palette: {
        mode: 'dark',
        divider: '#3B453A',
        background: { paper: '#283127', default: '#1C231C' },
      },
    }),
  ],
];

describe.each(THEMES)('a field on the %s theme', (_name, theme) => {
  it('declares an Input border that clears the non-text floor', () => {
    const edge = fieldEdge(theme);
    const declared = declaresAfterRender(
      () =>
        render(
          <ThemeProvider theme={theme}>
            <Input label="Nome" />
          </ThemeProvider>,
        ),
      edge,
    );
    expect(declared).toBe(true);
    expect(contrastRatio(edge, paperOf(theme))).toBeGreaterThanOrEqual(MIN_UI_CONTRAST);
  });

  it('declares a Select border that clears the non-text floor', () => {
    const edge = fieldEdge(theme);
    const declared = declaresAfterRender(
      () =>
        render(
          <ThemeProvider theme={theme}>
            <Select label="Categoria" options={[{ value: 'a', label: 'A' }]} />
          </ThemeProvider>,
        ),
      edge,
    );
    expect(declared).toBe(true);
    expect(contrastRatio(edge, paperOf(theme))).toBeGreaterThanOrEqual(MIN_UI_CONTRAST);
  });

  it('declares a Textarea border that clears the non-text floor', () => {
    const edge = fieldEdge(theme);
    const declared = declaresAfterRender(
      () =>
        render(
          <ThemeProvider theme={theme}>
            <Textarea label="Descrição" />
          </ThemeProvider>,
        ),
      edge,
    );
    expect(declared).toBe(true);
    expect(contrastRatio(edge, paperOf(theme))).toBeGreaterThanOrEqual(MIN_UI_CONTRAST);
  });
});

describe('fieldEdge', () => {
  it.each(THEMES)('clears the floor on the %s theme', (_name, theme) => {
    expect(contrastRatio(fieldEdge(theme), paperOf(theme))).toBeGreaterThanOrEqual(
      MIN_UI_CONTRAST,
    );
  });

  it('leaves a divider that already clears the floor alone', () => {
    // A theme that did the work itself must not be second-guessed: the walk is
    // a floor, not a house style.
    const strong = createTheme({
      palette: { divider: '#595959', background: { paper: '#FFFFFF' } },
    });
    expect(fieldEdge(strong)).toBe('rgb(89, 89, 89)');
  });

  it('walks the MINIMUM distance, so a theme keeps its own hairline', () => {
    // Landing far past the floor would repaint every adopter's fields in a
    // colour none of them chose. Stopping at the first passing tone is what
    // keeps the border recognisably theirs.
    const [, warm] = THEMES[1] as [string, Theme];
    const ratio = contrastRatio(fieldEdge(warm), paperOf(warm));
    expect(ratio).toBeGreaterThanOrEqual(MIN_UI_CONTRAST);
    expect(ratio).toBeLessThan(MIN_UI_CONTRAST + 0.75);
  });

  it('keeps the seed hue rather than falling back to grey', () => {
    // A warm hairline must stay warm. Walking in HSL is what makes the fixed
    // border read as the theme's own instead of as a correction bolted on.
    const [, warm] = THEMES[1] as [string, Theme];
    const [r, , b] = channels(fieldEdge(warm));
    expect(r).toBeGreaterThan(b);
  });

  it('lightens on a dark surface instead of darkening', () => {
    const [, dark] = THEMES[3] as [string, Theme];
    expect(luminance(fieldEdge(dark))).toBeGreaterThan(luminance(paperOf(dark)));
  });

  it('honours a surface the caller passes over background.paper', () => {
    // A control on a deliberately different ground is only as correct as the
    // pair it is given, so the override has to actually be read.
    const [, cool] = THEMES[2] as [string, Theme];
    expect(fieldEdge(cool, '#1C231C')).not.toBe(fieldEdge(cool));
  });

  it('resolves a translucent divider against the surface before measuring', () => {
    // `getContrastRatio` ignores the alpha channel it is given, so measuring
    // the hairline raw would answer for a colour nobody sees.
    const translucent = createTheme({
      palette: { divider: 'rgba(0, 0, 0, 0.12)', background: { paper: '#FFFFFF' } },
    });
    expect(contrastRatio(fieldEdge(translucent), 'rgb(255, 255, 255)')).toBeGreaterThanOrEqual(
      MIN_UI_CONTRAST,
    );
  });
});

/**
 * The guard that keeps this suite a FIX rather than a restatement.
 *
 * Without it a future refactor could reinstate the faded expression and every
 * assertion above would still be checking the same components — against numbers
 * that no longer describe what shipped.
 */
describe('the expression this replaced', () => {
  it.each([
    ['warm hairline', '#EBD9C7', '#FFFFFF'],
    ['cool hairline', '#D7DDD5', '#F4F6F3'],
  ])('did NOT clear the floor on the %s theme', (_name, divider, paper) => {
    const [dr, dg, db] = channels(asRgb(divider));
    const [pr, pg, pb] = channels(asRgb(paper));
    // `alpha(divider, 0.23)` over the paper it sits on — the old expression,
    // composited exactly as a browser would.
    const blend = (f: number, b: number): number => Math.round(0.23 * f + 0.77 * b);
    const old = `rgb(${blend(dr, pr)}, ${blend(dg, pg)}, ${blend(db, pb)})`;
    expect(contrastRatio(old, asRgb(paper))).toBeLessThan(1.1);
  });
});
