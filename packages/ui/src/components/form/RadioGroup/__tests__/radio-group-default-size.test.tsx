/**
 * `DefaultRadios` NEVER FORWARDED `size` TO ITS `<Radio>` (FUT-2865).
 *
 * `RadioGroup.tsx` resolves `size` (defaulting to `'md'`) and hands it to
 * whichever variant is selected — `CardRadios`/`ButtonRadios`/`SegmentRadios`
 * all read it and forward it as `customSize`. `DefaultRadios`, the variant a
 * caller reaches by doing nothing at all (`variant` unset, or an unknown
 * name), never read it: its `<Radio>` got no `size` prop of any kind, so the
 * glyph always drew at MUI's own default (`medium`) no matter what the caller
 * asked for.
 *
 * The fix translates `size` through `muiSize()` — the same house pattern
 * `Checkbox` already follows (FUT-2771, `Checkbox.metrics.ts`) — and forwards
 * it as `<Radio size={muiSize(size)} …>`. Unlike `Checkbox`, MUI's own `Radio`
 * types `size` as `'small' | 'medium'` only; `'large'` still renders correctly
 * at runtime (`RadioButtonIcon`'s `SvgIcon` reads whatever `size` it is given
 * as its own `fontSize`), so the fix also extends `RadioPropsSizeOverrides`
 * (`RadioGroup.variants.tsx`) rather than clamping `lg`/`xl` down to `medium`
 * — a clamp would make `size="lg"` indistinguishable from size unset, which
 * is exactly the "hard-coded value" this suite's companion case rules out.
 */
import { createTheme } from '@mui/material/styles/index.js';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RadioGroup } from '../RadioGroup';
import type { RadioOption } from '../RadioGroup.types';

const OPTIONS: RadioOption[] = [
  { value: 'a', label: 'Option A' },
  { value: 'b', label: 'Option B' },
];

/** The class MUI's `Radio` adds to its root only when `size !== 'medium'`. */
const radioSizeClass = (root: Element | null): string | undefined =>
  Array.from(root?.classList ?? []).find((name) => name.startsWith('MuiRadio-size'));

/** The class MUI's `SvgIcon` adds unconditionally, whatever `fontSize` it drew at. */
const svgFontSizeClass = (root: Element | null): string | undefined =>
  Array.from(root?.querySelector('svg')?.classList ?? []).find((name) =>
    name.startsWith('MuiSvgIcon-fontSize'),
  );

describe('DefaultRadios forwards size to the rendered Radio glyph', () => {
  it.each([
    ['xs', 'Small'],
    ['sm', 'Small'],
    ['lg', 'Large'],
    ['xl', 'Large'],
  ] as const)(
    'size="%s" reaches the glyph as MUI %s — on today\'s code this stays "medium"',
    (houseSize, muiCap) => {
      render(<RadioGroup options={OPTIONS} size={houseSize} dataTestId="rg" />);
      const root = screen.getByTestId('rg-radio-0');

      expect(radioSizeClass(root)).toBe(`MuiRadio-size${muiCap}`);
      expect(svgFontSizeClass(root)).toBe(`MuiSvgIcon-fontSize${muiCap}`);
    },
  );

  it('size="sm" and size="lg" draw genuinely different glyphs, ruling out a hard-coded value', () => {
    const { unmount } = render(<RadioGroup options={OPTIONS} size="sm" dataTestId="rg-sm" />);
    const small = svgFontSizeClass(screen.getByTestId('rg-sm-radio-0'));
    unmount();

    render(<RadioGroup options={OPTIONS} size="lg" dataTestId="rg-lg" />);
    const large = svgFontSizeClass(screen.getByTestId('rg-lg-radio-0'));

    expect(small).toBe('MuiSvgIcon-fontSizeSmall');
    expect(large).toBe('MuiSvgIcon-fontSizeLarge');
    expect(small).not.toBe(large);
  });

  it('size="md" keeps drawing exactly as size unset does — both stay MUI\'s own default', () => {
    render(<RadioGroup options={OPTIONS} size="md" dataTestId="rg-md" />);
    render(<RadioGroup options={OPTIONS} dataTestId="rg-unset" />);

    const md = screen.getByTestId('rg-md-radio-0');
    const unset = screen.getByTestId('rg-unset-radio-0');

    // Radio only adds a `MuiRadio-size*` class when `size !== 'medium'`, so "no
    // size class at all" IS medium here — true before this fix (nothing ever
    // reached `<Radio>`) and true after it (`RadioGroup.tsx` already defaults
    // `size` to `'md'`, and `muiSize('md')` is `'medium'`).
    expect(radioSizeClass(md)).toBeUndefined();
    expect(radioSizeClass(unset)).toBeUndefined();
    expect(svgFontSizeClass(md)).toBe('MuiSvgIcon-fontSizeMedium');
    expect(svgFontSizeClass(unset)).toBe('MuiSvgIcon-fontSizeMedium');
  });
});

describe('the other three variants keep their own sizing untouched', () => {
  /** The declarations Emotion wrote for one element's own classes, concatenated. */
  function ownDeclarations(element: HTMLElement): string {
    const sheet = Array.from(document.querySelectorAll('style'))
      .map((tag) => tag.textContent ?? '')
      .join('\n');
    return element.className
      .split(/\s+/u)
      .filter((cls) => cls.startsWith('css-'))
      .map((cls) => new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`, 'u').exec(sheet)?.[1] ?? '')
      .join(';');
  }

  /**
   * The LAST declaration of `property` among an element's own rules.
   *
   * `ButtonRadios`/`SegmentRadios` compose a `styled(ButtonBase, …)`, and MUI
   * v6's own `zero-styled` bakes the base component's defaults and this
   * package's overrides into ONE rule rather than two — `ButtonBase` already
   * declares `padding: 0` before `buttonBase()`'s own `padding` runs. CSS takes
   * the later declaration, so the assertion must read the same one back rather
   * than the first (unstyled) `padding` in the block.
   */
  const declared = (element: HTMLElement, property: 'padding' | 'font-size'): string | undefined => {
    const pattern = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'gu');
    const matches = Array.from(ownDeclarations(element).matchAll(pattern));
    return matches.at(-1)?.[1]?.trim();
  };

  // Computed once against the real theme these styles read (`pxToRem`), rather
  // than duplicating MUI's own division — the point is pinning `lg`'s numbers
  // (20/12/24/18px), not re-deriving `rem()`.
  const theme = createTheme();
  const px = (value: number) => theme.typography.pxToRem(value);

  it('CardRadios: size="lg" keeps its own 20px padding, not the Radio glyph size', () => {
    render(
      <RadioGroup variant="cards" options={OPTIONS} size="lg" dataTestId="rg-cards" />,
    );
    const card = screen.getByTestId('rg-cards-card-0');

    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(declared(card, 'padding')).toBe(px(20));
  });

  it('ButtonRadios: size="lg" keeps its own 12/24px padding and 18px label', () => {
    render(
      <RadioGroup variant="buttons" options={OPTIONS} size="lg" dataTestId="rg-buttons" />,
    );
    const button = screen.getByTestId('rg-buttons-button-0');

    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(declared(button, 'padding')).toBe(`${px(12)} ${px(24)}`);
    expect(declared(button, 'font-size')).toBe(px(18));
  });

  it('SegmentRadios: size="lg" keeps its own 10/20px padding and 18px label', () => {
    render(
      <RadioGroup variant="segments" options={OPTIONS} size="lg" dataTestId="rg-segments" />,
    );
    const segment = screen.getByTestId('rg-segments-segment-0');

    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(declared(segment, 'padding')).toBe(`${px(10)} ${px(20)}`);
    expect(declared(segment, 'font-size')).toBe(px(18));
  });
});
