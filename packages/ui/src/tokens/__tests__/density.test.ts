import { createTheme } from '@mui/material/styles/index.js';
import type { ThemeOptions } from '@mui/material/styles/index.js';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DENSITY,
  DENSITY_FACTOR,
  densityFieldHeight,
  densityFontSize,
  densitySpacingUnit,
  densityThemeOptions,
  resolveDensityFactor,
} from '../density';
import { muiThemeOptionsFrom } from '../../provider/mui-bridge';
import { buttonSize } from '../../components/form/Button/Button.styles';
import { mergeMuiComponents } from '../field-height';
import { DEFAULT_FIELD_RADIUS } from '../field-radius.core';
import { createUiTheme } from '../theme';

/**
 * FUT-2765 — the theme's density knob, and the factor it resolves to.
 *
 * `size` is untouched here on purpose (FUT-2764 Decision 3): every assertion
 * below is about the FACTOR (`typography.fontSize` / `spacingUnit` /
 * `fieldHeight`), never a `size` step.
 */

describe('resolveDensityFactor — the precedence table', () => {
  it('defaults to normal, factor 1, with no density given at all', () => {
    expect(resolveDensityFactor()).toEqual({ level: 'normal', factor: 1 });
    expect(DEFAULT_DENSITY).toBe('normal');
  });

  it('a numeric density IS the factor, verbatim — no table lookup, no level to report', () => {
    expect(resolveDensityFactor(0.95)).toEqual({ factor: 0.95 });
  });

  it("a repository's own densityFactors entry for a named level wins over the built-in table", () => {
    expect(resolveDensityFactor('compact', { compact: 0.8 })).toEqual({ level: 'compact', factor: 0.8 });
  });

  it('no densityFactors entry for the level falls through to the built-in table exactly', () => {
    expect(resolveDensityFactor('compact')).toEqual({ level: 'compact', factor: DENSITY_FACTOR.compact });
    expect(resolveDensityFactor('comfortable')).toEqual({ level: 'comfortable', factor: DENSITY_FACTOR.comfortable });
    expect(DENSITY_FACTOR).toEqual({ compact: 0.9, normal: 1, comfortable: 1.1 });
  });

  it("a densityFactors entry for a DIFFERENT level does not leak into this one", () => {
    expect(resolveDensityFactor('compact', { comfortable: 2 })).toEqual({ level: 'compact', factor: 0.9 });
  });

  /**
   * Coordinator follow-up (blocking): an unusable numeric `density` (`0`, a
   * negative number, `NaN`, `Infinity`) was passed straight through as the
   * factor, so `createUiTheme` baked it into `spacingUnit`/`fieldHeight`/
   * `typography.fontSize` — a `0` factor collapses every size to nothing, a
   * negative one draws negative padding, `NaN`/`Infinity` poison every
   * arithmetic that touches them. Held to the SAME rule `resolveFieldHeight`
   * (`./field-height.core`) already applies to its own `height` argument: not
   * a positive, finite number falls back, exactly as if none were given.
   */
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'an unusable numeric density (%s) falls back to normal, factor 1 — not a NaN/Infinity/negative/zero factor',
    (bad) => {
      expect(resolveDensityFactor(bad)).toEqual({ level: 'normal', factor: 1 });
    },
  );

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "an unusable densityFactors.compact (%s) falls back to the BUILT-IN table's compact value, not to normal",
    (bad) => {
      expect(resolveDensityFactor('compact', { compact: bad })).toEqual({ level: 'compact', factor: 0.9 });
    },
  );
});

describe('densityFontSize / densitySpacingUnit / densityFieldHeight — bit-identical to today at factor 1', () => {
  it('factor 1 reproduces the literals this PR replaces', () => {
    expect(densityFontSize(1)).toBe(14);
    expect(densitySpacingUnit(1)).toBe(8);
    expect(densityFieldHeight(1)).toBe(2.5);
  });

  it('scales linearly at any other factor', () => {
    expect(densityFontSize(0.9)).toBeCloseTo(12.6);
    expect(densitySpacingUnit(0.9)).toBeCloseTo(7.2);
    expect(densityFieldHeight(0.9)).toBeCloseTo(2.25);
    expect(densityFontSize(1.1)).toBeCloseTo(15.4);
    expect(densitySpacingUnit(1.1)).toBeCloseTo(8.8);
    expect(densityFieldHeight(1.1)).toBeCloseTo(2.75);
  });
});

describe('createUiTheme — the precedence threaded end to end', () => {
  it('an explicit spacingUnit/fieldHeight still wins over EVERYTHING, including a numeric density', () => {
    const ui = createUiTheme({ density: 0.5, spacingUnit: 8, fieldHeight: 2.5 });
    expect(ui.spacingUnit).toBe(8);
    expect(ui.fieldHeight).toBe(2.5);
    // The density itself is still reported as given — only the FALLBACK moved.
    expect(ui.density).toEqual({ factor: 0.5 });
  });

  it('a numeric density is used as the factor directly, with no level to report', () => {
    const ui = createUiTheme({ density: 0.95 });
    expect(ui.density).toEqual({ factor: 0.95 });
    expect(ui.spacingUnit).toBeCloseTo(7.6);
    expect(ui.fieldHeight).toBeCloseTo(2.375);
  });

  it("a repository's densityFactors override wins over the built-in compact factor", () => {
    const ui = createUiTheme({ density: 'compact', densityFactors: { compact: 0.8 } });
    expect(ui.density).toEqual({ level: 'compact', factor: 0.8 });
    expect(ui.spacingUnit).toBeCloseTo(6.4);
  });

  it('named levels with no override fall through to the built-in table', () => {
    expect(createUiTheme({ density: 'compact' }).density).toEqual({ level: 'compact', factor: 0.9 });
    expect(createUiTheme({ density: 'comfortable' }).density).toEqual({ level: 'comfortable', factor: 1.1 });
  });

  it("no density at all is 'normal', factor 1 — today's numbers, byte-for-byte", () => {
    const ui = createUiTheme();
    expect(ui.density).toEqual({ level: 'normal', factor: 1 });
    expect(ui.spacingUnit).toBe(8);
    expect(ui.fieldHeight).toBe(2.5);
  });

  /** Coordinator follow-up (blocking) — see resolveDensityFactor's own cases above. */
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'an unusable numeric density (%s) never reaches spacingUnit/fieldHeight as a bad factor',
    (bad) => {
      const ui = createUiTheme({ density: bad });
      expect(ui.density).toEqual({ level: 'normal', factor: 1 });
      expect(ui.spacingUnit).toBe(8);
      expect(ui.fieldHeight).toBe(2.5);
    },
  );

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'an unusable densityFactors.compact (%s) falls back to the built-in 0.9, not to normal',
    (bad) => {
      const ui = createUiTheme({ density: 'compact', densityFactors: { compact: bad } });
      expect(ui.density).toEqual({ level: 'compact', factor: 0.9 });
      expect(ui.spacingUnit).toBeCloseTo(7.2);
    },
  );
});

describe('densityThemeOptions — the standalone entry, for a host that never calls createUiTheme', () => {
  it.each(['compact', 0.95] as const)(
    'agrees with the createUiTheme(%s) round-trip on the density-derived numbers',
    (density) => {
      const standalone = densityThemeOptions(density);
      const viaUiTheme = muiThemeOptionsFrom(createUiTheme({ density }));
      // Not full-object equality: `muiThemeOptionsFrom`'s typography also
      // carries `fontFamily` (from the `UiTheme` it was built from), which
      // `densityThemeOptions` — a bare fragment, no `UiTheme` in sight — has
      // no opinion on. The two paths agree on the NUMBERS density derives.
      // Both are known plain objects here (never MUI's `(palette) => …` form),
      // so a narrow cast reads `fontSize` off the union type safely.
      const fontSizeOf = (t: ThemeOptions['typography']) => (t as { fontSize?: number } | undefined)?.fontSize;
      expect(fontSizeOf(standalone.typography)).toBe(fontSizeOf(viaUiTheme.typography));
      expect(standalone.spacing).toBe(viaUiTheme.spacing);
    },
  );

  it("a repository's densityFactors override reaches the standalone entry too", () => {
    const standalone = densityThemeOptions('compact', { compact: 0.8 });
    expect(standalone.typography).toEqual({ fontSize: densityFontSize(0.8) });
    expect(standalone.spacing).toBe(densitySpacingUnit(0.8));
  });

  /** Coordinator follow-up (blocking) — the standalone path validates identically. */
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'an unusable numeric density (%s) reaches the standalone entry as normal, factor 1 too',
    (bad) => {
      expect(densityThemeOptions(bad)).toEqual(densityThemeOptions('normal'));
    },
  );

  it('spreads cleanly into a bare createTheme({ ... }) call — the FIRST (options) argument', () => {
    // `createTheme` only runs `createSpacing`/`createTypography` on this,
    // its FIRST argument (`createThemeNoVars.js`) — see `densityThemeOptions`'s
    // own docblock for the "second, layering argument" caveat this proves.
    const layered = createTheme({ ...densityThemeOptions('compact') });
    expect(layered.typography.fontSize).toBeCloseTo(12.6);
    expect(layered.spacing(1)).toBe('7.2px'); // MUI's spacing function returns a CSS length
  });

  it('a SECOND, layering createTheme(base, { ... }) call preserves density set at the FIRST', () => {
    // The correct shape for a host with a base theme and a second theme
    // layered on top (`createTheme(outer, { palette: { ... } })`): density
    // goes into the base's own construction; the layering call carries it
    // over unchanged because it never restates spacing/typography/fieldHeight.
    const base = createTheme({ palette: { primary: { main: '#6366F1' } }, ...densityThemeOptions('compact') });
    const layered = createTheme(base, { palette: { primary: { main: '#111111' } } });
    expect(layered.fieldHeight).toBe(base.fieldHeight);
    expect(layered.typography.fontSize).toBe(base.typography.fontSize);
    expect(layered.typography.pxToRem(14)).toBe(base.typography.pxToRem(14));
    expect(layered.spacing(1)).toBe(base.spacing(1));
    expect(layered.components?.MuiOutlinedInput?.styleOverrides).toEqual(
      base.components?.MuiOutlinedInput?.styleOverrides,
    );
  });

  it('the existing 2-argument call keeps working — fieldRadius defaults to DEFAULT_FIELD_RADIUS', () => {
    const twoArg = densityThemeOptions('compact', { compact: 0.8 });
    const threeArgExplicitDefault = densityThemeOptions('compact', { compact: 0.8 }, DEFAULT_FIELD_RADIUS);
    expect(twoArg).toEqual(threeArgExplicitDefault);
  });

  it("a host's own field radius reaches the components override (3rd argument)", () => {
    const options = densityThemeOptions('compact', undefined, 12);
    expect(options.components?.MuiOutlinedInput?.styleOverrides?.root).toEqual({ borderRadius: 12 });
    // The default (no 3rd argument) is unaffected.
    expect(densityThemeOptions('compact').components?.MuiOutlinedInput?.styleOverrides?.root).toEqual({
      borderRadius: DEFAULT_FIELD_RADIUS,
    });
  });

  it("a host's own OTHER-component override merges in untouched, by component name", () => {
    const hostOverride = { MuiChip: { styleOverrides: { root: { height: 32 } } } };
    const merged = mergeMuiComponents(densityThemeOptions('compact').components ?? {}, hostOverride);
    // The field overrides this function knows about are unaffected...
    expect(merged.MuiOutlinedInput?.styleOverrides?.root).toEqual({ borderRadius: DEFAULT_FIELD_RADIUS });
    // ...and the host's own, unrelated component survives beside them.
    expect(merged.MuiChip?.styleOverrides?.root).toEqual({ height: 32 });
  });

  it('a SHARED inner key (both sides styling MuiOutlinedInput.root) is replaced WHOLESALE by the later source, not deep-merged', () => {
    const hostOverride = { MuiOutlinedInput: { styleOverrides: { root: { background: 'red' } } } };
    const merged = mergeMuiComponents(densityThemeOptions('compact').components ?? {}, hostOverride);
    // The host's `root` REPLACES density's (no borderRadius survives) — this is
    // exactly why `densityThemeOptions`'s own docblock says a host wanting to
    // ADD to a key both sides touch must write that key out in full itself.
    expect(merged.MuiOutlinedInput?.styleOverrides?.root).toEqual({ background: 'red' });
  });
});

/**
 * Coordinator follow-up: `Input`/`Select`/`Button` all read `theme.fieldHeight`
 * directly (`Input.tsx:46`, `Select.tsx:61`, `Button.styles.ts`'s `buttonSize`),
 * so a standalone-path host that gets `typography`/`spacing` but no
 * `fieldHeight` renders every field at the DEFAULT height (2.5) at every
 * density — the standalone path silently disagreeing with `createUiTheme` on
 * the one number three components actually key their layout off. The epic's
 * Design section is explicit that the two paths agree on
 * "typography/spacing/components" (and, transitively, the `fieldHeight` that
 * `components` is built from) — this was a real gap, not a documentation nit.
 */
describe('densityThemeOptions — fieldHeight and the field components agree with the createUiTheme round-trip', () => {
  it.each(['compact', 'comfortable', 0.95, 'normal'] as const)(
    'density=%s: same fieldHeight, same MuiOutlinedInput/MuiInputLabel override numbers',
    (density) => {
      const standaloneOptions = densityThemeOptions(density);
      const viaUiThemeOptions = muiThemeOptionsFrom(createUiTheme({ density }));

      // The top-level key `Input`/`Select`/`Button` read directly.
      expect(standaloneOptions.fieldHeight).toBe(viaUiThemeOptions.fieldHeight);

      // The MUI-native override a HOST's own bare TextField/Select renders at.
      expect(standaloneOptions.components?.MuiOutlinedInput?.styleOverrides).toEqual(
        viaUiThemeOptions.components?.MuiOutlinedInput?.styleOverrides,
      );
      expect(standaloneOptions.components?.MuiInputLabel?.styleOverrides).toEqual(
        viaUiThemeOptions.components?.MuiInputLabel?.styleOverrides,
      );

      // End to end: a theme built from either path lays a field out identically.
      const standaloneTheme = createTheme(standaloneOptions);
      const viaUiThemeTheme = createTheme(viaUiThemeOptions);
      expect(standaloneTheme.fieldHeight).toBe(viaUiThemeTheme.fieldHeight);
    },
  );

  it("at normal/unset, the standalone path's fieldHeight is today's literal 2.5 — no visual change", () => {
    expect(densityThemeOptions('normal').fieldHeight).toBe(2.5);
  });

  it.each(['compact', 'normal', 'comfortable'] as const)(
    "Button's own minHeight (buttonSize, size='md') agrees on both paths at density=%s — " +
      'it does not read theme.fieldHeight through a components override at all, only ' +
      'through the SAME top-level key Input/Select read, so fixing that key fixes all three',
    (density) => {
      const standaloneTheme = createTheme(densityThemeOptions(density));
      const viaUiThemeTheme = createTheme(muiThemeOptionsFrom(createUiTheme({ density })));
      const standaloneHeight = buttonSize('md', false)(standaloneTheme).minHeight;
      const viaUiThemeHeight = buttonSize('md', false)(viaUiThemeTheme).minHeight;
      expect(standaloneHeight).toBe(viaUiThemeHeight);
      // 36px / 40px / 44px at the 16px root — the SAME three numbers the
      // Input/Select fieldHeight fix produces, because both read one theme key.
      const expectedRem = { compact: '2.25rem', normal: '2.5rem', comfortable: '2.75rem' }[density];
      expect(standaloneHeight).toBe(expectedRem);
    },
  );
});
