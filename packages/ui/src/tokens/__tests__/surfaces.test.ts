import { createTheme } from '@mui/material/styles/index.js';
import { describe, expect, it } from 'vitest';

import { SOFT_SIGNAL_OPACITY, SOFT_SIGNALS, softSignal, surfaces } from '../surfaces';

/**
 * The composite the default soft signal promises, computed here from the hex
 * channels directly rather than through `blend`, so the test states the
 * formula instead of re-running the implementation.
 */
function over(ground: string, ink: string, opacity: number): string {
  const channels = (hex: string): number[] => {
    const full = hex.length === 4 ? `#${[...hex.slice(1)].map((digit) => digit + digit).join('')}` : hex;
    return [1, 3, 5].map((start) => parseInt(full.slice(start, start + 2), 16));
  };
  const [g, i] = [channels(ground), channels(ink)];
  const mixed = g.map((value, index) => Math.round(value * (1 - opacity) + (i[index] ?? 0) * opacity));
  return `rgb(${mixed.join(', ')})`;
}

const MODES = ['light', 'dark'] as const;

describe('surfaces(theme) — defaults leave a host that sets nothing unchanged', () => {
  it.each(MODES)('%s: raised = background.paper, sunken = background.default, border = divider', (mode) => {
    const theme = createTheme({ palette: { mode } });
    expect(surfaces(theme)).toEqual({
      raised: theme.palette.background.paper,
      sunken: theme.palette.background.default,
      borderOnSunken: theme.palette.divider,
    });
  });

  it('follows a host palette that states its own grounds', () => {
    const theme = createTheme({
      palette: { background: { default: '#F4F6F3', paper: '#FFFFFF' }, divider: '#D7DDD5' },
    });
    expect(surfaces(theme)).toEqual({ sunken: '#F4F6F3', raised: '#FFFFFF', borderOnSunken: '#D7DDD5' });
  });
});

describe('softSignal(theme, signal) — the default formula', () => {
  describe.each(MODES)('%s mode', (mode) => {
    const theme = createTheme({
      palette: {
        mode,
        background: { paper: mode === 'light' ? '#FFFFFF' : '#1E1E1E' },
        success: { main: '#2E7D32' },
        warning: { main: '#ED6C02' },
        error: { main: '#D32F2F' },
        info: { main: '#0288D1' },
      },
    });

    it.each(SOFT_SIGNALS)('%s = main at 8%% composited over background.paper', (signal) => {
      const expected = over(theme.palette.background.paper, theme.palette[signal].main, 0.08);
      expect(softSignal(theme, signal)).toBe(expected);
    });

    it.each(SOFT_SIGNALS)('%s is OPAQUE', (signal) => {
      expect(softSignal(theme, signal)).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    });
  });

  it('uses 8%', () => {
    expect(SOFT_SIGNAL_OPACITY).toBe(0.08);
  });

  it('reproduces the values FUT-3098 measured by hand (light mains over #FAFBF9)', () => {
    const theme = createTheme({
      palette: {
        background: { paper: '#FAFBF9' },
        success: { main: '#2F7A45' },
        warning: { main: '#8A6408' },
      },
    });
    // #EAF1EB and #F1EFE6, the ticket's soft success and soft warning.
    expect(softSignal(theme, 'success')).toBe('rgb(234, 241, 235)');
    expect(softSignal(theme, 'warning')).toBe('rgb(241, 239, 230)');
  });

  it('reads MUI stock palettes, whose mains are hex', () => {
    const theme = createTheme();
    expect(theme.palette.background.paper).toBe('#fff');
    expect(softSignal(theme, 'error')).toBe(over('#fff', theme.palette.error.main, 0.08));
  });
});

describe('a host override wins, per key', () => {
  it('replaces only the surface keys it states', () => {
    const theme = createTheme({ uiSurfaces: { sunken: '#D7DDD5' } });
    expect(surfaces(theme)).toEqual({
      sunken: '#D7DDD5',
      raised: theme.palette.background.paper,
      borderOnSunken: theme.palette.divider,
    });
  });

  it('replaces every surface key when all are stated', () => {
    const stated = { sunken: '#D7DDD5', raised: '#FAFBF9', borderOnSunken: '#A5AEA3' };
    expect(surfaces(createTheme({ uiSurfaces: stated }))).toEqual(stated);
  });

  it('keeps the default for a key passed as undefined', () => {
    const theme = createTheme({ uiSurfaces: { raised: undefined, borderOnSunken: '#A5AEA3' } });
    expect(surfaces(theme).raised).toBe(theme.palette.background.paper);
    expect(surfaces(theme).borderOnSunken).toBe('#A5AEA3');
  });

  it('replaces only the soft signals it states', () => {
    const theme = createTheme({ uiSoftSignal: { success: '#EAF1EB' } });
    expect(softSignal(theme, 'success')).toBe('#EAF1EB');
    expect(softSignal(theme, 'error')).toBe(
      over(theme.palette.background.paper, theme.palette.error.main, 0.08),
    );
  });

  it('survives a second createTheme layered over the base, as a host theme is built', () => {
    const base = createTheme({ palette: { mode: 'light' } });
    const themed = createTheme(base, {
      uiSurfaces: { sunken: '#D7DDD5' },
      uiSoftSignal: { info: '#EAF0EE' },
    });
    expect(surfaces(themed).sunken).toBe('#D7DDD5');
    expect(softSignal(themed, 'info')).toBe('#EAF0EE');
  });
});

describe('a palette the composite cannot read', () => {
  it('hands the browser a color-mix for a named paper instead of throwing', () => {
    const theme = createTheme({ palette: { background: { paper: 'white' } } });
    expect(softSignal(theme, 'success')).toBe(`color-mix(in srgb, ${theme.palette.success.main} 8%, white)`);
  });

  it('does the same for a CSS variable', () => {
    const theme = createTheme({ palette: { background: { paper: 'var(--paper)' } } });
    expect(softSignal(theme, 'error')).toBe(`color-mix(in srgb, ${theme.palette.error.main} 8%, var(--paper))`);
  });

  it('treats an empty override as unstated, as surfaces() does', () => {
    const theme = createTheme({ uiSoftSignal: { warning: '' } });
    expect(softSignal(theme, 'warning')).toBe(
      over(theme.palette.background.paper, theme.palette.warning.main, 0.08),
    );
  });
});

describe('dark mode resolves its own values', () => {
  const light = createTheme({ palette: { mode: 'light' } });
  const dark = createTheme({ palette: { mode: 'dark' } });

  it('defaults read the dark palette, not the light one', () => {
    expect(surfaces(dark)).toEqual({
      sunken: dark.palette.background.default,
      raised: dark.palette.background.paper,
      borderOnSunken: dark.palette.divider,
    });
    expect(surfaces(dark)).not.toEqual(surfaces(light));
  });

  it.each(SOFT_SIGNALS)('soft %s composites the dark main over the dark paper', (signal) => {
    expect(softSignal(dark, signal)).toBe(over('#121212', dark.palette[signal].main, 0.08));
    expect(softSignal(dark, signal)).not.toBe(softSignal(light, signal));
  });

  it("a host's dark theme carries its own override, independent of the light one", () => {
    const hostLight = createTheme({ palette: { mode: 'light' }, uiSurfaces: { sunken: '#D7DDD5' } });
    const hostDark = createTheme({ palette: { mode: 'dark' }, uiSurfaces: { sunken: '#121712' } });
    expect(surfaces(hostLight).sunken).toBe('#D7DDD5');
    expect(surfaces(hostDark).sunken).toBe('#121712');
  });
});
