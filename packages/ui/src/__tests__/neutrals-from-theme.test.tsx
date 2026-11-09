/**
 * THE WEB COMPONENTS READ THEIR NEUTRALS FROM THE THEME (FUT-4215).
 *
 * Two promises, one table each:
 *
 *   - a host that passes nothing keeps today's look EXACTLY: each colour below
 *     is resolved under a stock `createTheme()` and compared with the literal
 *     the component drew before the neutrals moved onto the theme;
 *   - a host that hands in `palette.grey` / `palette.common` / `palette.divider`
 *     / `uiInk` reaches the component: the same colour, resolved under a theme
 *     that overrides the source, follows it.
 *
 * Switch, Card (`section`), Checkbox (`glow`, `pulse`), Breadcrumbs (`pulse`)
 * and the gradient ink of Button / Switch were the places that still painted a
 * token constant. Alert, Avatar and Heading already read the grey ramp; they
 * are in the second table so the claim stays true.
 */
import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import type { Theme } from '@mui/material/styles/index.js';
import { cleanup, render } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { getColorFromTheme as alertPalette } from '../components/data-display/Alert/Alert.styles';
import { Avatar } from '../components/data-display/Avatar';
import { pulse as breadcrumbsPulse } from '../components/navigation/Breadcrumbs/Breadcrumbs.styles';
import { Checkbox } from '../components/form/Checkbox';
import { iosThumbShadow, iosTrackShadow } from '../components/form/Switch/Switch.metrics';
import { onTrackInk, switchSx } from '../components/form/Switch/Switch.styles';
import { Card } from '../components/layout/Card';
import { cardStyles } from '../components/layout/Card/Card.styles';
import { Heading } from '../components/typography/Heading';
import { inkPair } from '../tokens/ink';
import { rem } from '../tokens/relative';
import { inkOver } from '../tokens/theme';

afterEach(cleanup);

const DEFAULT: Theme = createTheme();
const DARK: Theme = createTheme({ palette: { mode: 'dark' } });

const RE_TINTED = createTheme({
  palette: {
    common: { black: '#102030', white: '#fafafa' },
    grey: { ...DEFAULT.palette.grey, 500: '#123456', 700: '#234567', 900: '#345678' },
    divider: '#abcdef',
  },
});
const RE_TINTED_DARK = createTheme({
  palette: { mode: 'dark', common: { black: '#102030', white: '#fafafa' } },
});
const GLOWS = createTheme({
  uiInk: { effectGlow: { muiBlue: 'rgb(1, 2, 3)', brandIndigo: 'rgb(4, 5, 6)' } },
});

/** Every rule emotion has put in the document, as one string. */
const emittedCss = (): string =>
  Array.from(document.querySelectorAll('style'))
    .map((style) => style.textContent ?? '')
    .join('\n');

const renderIn = (theme: Theme, ui: React.ReactElement): void => {
  render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
};

type Flags = Parameters<typeof switchSx>[1];
const part = (theme: Theme, flags: Flags, key: string): Record<string, unknown> =>
  (switchSx(theme, flags) as Record<string, Record<string, unknown>>)[key] ?? {};
const thumb = (theme: Theme, flags: Flags = {}) => part(theme, flags, '& .MuiSwitch-thumb');
const track = (theme: Theme, flags: Flags = {}) => part(theme, flags, '& .MuiSwitch-track');

const section = (theme: Theme, lifted: boolean) =>
  (cardStyles(theme, {
    variant: 'section',
    interactive: lifted,
    glow: false,
    pulse: false,
    borderRadius: 'md',
  }) as Record<string, Record<string, unknown> | unknown>);

describe('a host that passes nothing keeps today\'s look', () => {
  it('Switch: the resting thumb is white and the iOS shadows are black washes', () => {
    expect(thumb(DEFAULT).backgroundColor).toBe('#fff');
    expect(thumb(DEFAULT, { customVariant: 'ios' }).boxShadow).toBe(
      iosThumbShadow((px) => rem(DEFAULT, px)),
    );
    expect(thumb(DEFAULT, { customVariant: 'ios' }).boxShadow).toContain('rgba(0, 0, 0, 0.12)');
    expect(track(DEFAULT, { customVariant: 'ios' }).boxShadow).toBe(
      iosTrackShadow((px) => rem(DEFAULT, px)),
    );
    expect(track(DEFAULT, { customVariant: 'ios' }).boxShadow).toContain('rgba(0, 0, 0, 0.1)');
    expect(track(DEFAULT, { customVariant: 'ios' }).backgroundColor).toBe('rgba(0, 0, 0, 0.1)');
  });

  it('Switch: the checked ink is white on a dark brand and MUI\'s dark ink on a pale one', () => {
    const dark = createTheme({ palette: { primary: { main: '#1A237E' } } });
    const pale = createTheme({ palette: { primary: { main: '#7ED957' } } });
    expect(onTrackInk(dark, {})).toBe('#fff');
    expect(onTrackInk(pale, {})).toBe('rgba(0, 0, 0, 0.87)');
    expect(onTrackInk(pale, { gradient: true })).toBe('rgba(0, 0, 0, 0.87)');
  });

  it('inkOver / inkPair: the pair at the default theme is the pair the function defaults to', () => {
    expect(inkPair(DEFAULT)).toEqual({ light: '#fff', dark: 'rgba(0, 0, 0, 0.87)' });
    expect(inkOver(['#7ED957'], '#fff', inkPair(DEFAULT))).toBe(inkOver(['#7ED957'], '#fff'));
    expect(inkOver(['#1A237E'], '#fff', inkPair(DEFAULT))).toBe(inkOver(['#1A237E'], '#fff'));
  });

  it('Card section: a black wash at 2% / 4% (light) and 20% / 25% (dark)', () => {
    expect(section(DEFAULT, false).backgroundColor).toBe('rgba(0, 0, 0, 0.02)');
    expect((section(DEFAULT, true)['&:hover'] as Record<string, unknown>).backgroundColor).toBe('rgba(0, 0, 0, 0.04)');
    expect(section(DARK, false).backgroundColor).toBe('rgba(0, 0, 0, 0.2)');
  });

  it('Checkbox glow and pulse: MUI\'s blue', () => {
    renderIn(DEFAULT, <Checkbox pulse />);
    renderIn(DEFAULT, <Checkbox glow />);
    const css = emittedCss();
    expect(css).toContain('rgba(25, 118, 210, 0.7)');
    expect(css).toContain('rgba(25, 118, 210, 0.8)');
    expect(css).toContain('rgba(25, 118, 210, 0.5)');
  });

  it('Breadcrumbs pulse: the platform indigo', () => {
    const css = breadcrumbsPulse(DEFAULT).styles;
    expect(css).toContain('rgba(99, 102, 241, 0.4)');
    expect(css).toContain('rgba(99, 102, 241, 0)');
  });
});

describe('a host that hands in a theme reaches the component', () => {
  it('Switch: palette.common moves the thumb, the iOS shadows and the track wash', () => {
    expect(thumb(RE_TINTED).backgroundColor).toBe('#fafafa');
    expect(thumb(RE_TINTED, { customVariant: 'ios' }).boxShadow).toContain('rgba(16, 32, 48, 0.12)');
    expect(thumb(RE_TINTED, { customVariant: 'ios' }).boxShadow).not.toContain('rgba(0, 0, 0');
    expect(track(RE_TINTED, { customVariant: 'ios' }).boxShadow).toContain('rgba(16, 32, 48, 0.1)');
    expect(track(RE_TINTED, { customVariant: 'ios' }).backgroundColor).toBe('rgba(16, 32, 48, 0.1)');
  });

  it('Switch / Button gradient: palette.common picks the ink over a fill', () => {
    const neutral = createTheme({ palette: { common: { black: '#102030', white: '#fafafa' } } });
    // A fill white cannot label: the dark ink is the palette's black at 0.87.
    expect(inkOver(['#7ED957'], '#fff', inkPair(neutral))).toBe('rgba(16, 32, 48, 0.87)');
    expect(inkOver(['#1A237E'], inkPair(neutral).light, inkPair(neutral))).toBe('#fafafa');
  });

  it('Switch: palette.grey moves the neutral colour', () => {
    const sx = switchSx(RE_TINTED, { customColor: 'neutral' }) as Record<string, Record<string, unknown>>;
    expect(JSON.stringify(sx)).toContain('#234567');
  });

  it('Card section: palette.common.black tints the wash', () => {
    expect(section(RE_TINTED, false).backgroundColor).toBe('rgba(16, 32, 48, 0.02)');
    expect(section(RE_TINTED_DARK, false).backgroundColor).toBe('rgba(16, 32, 48, 0.2)');
  });

  it('Card outlined: palette.divider draws the hairline', () => {
    const css = cardStyles(RE_TINTED, {
      variant: 'outlined',
      interactive: false,
      glow: false,
      pulse: false,
      borderRadius: 'md',
    }) as Record<string, unknown>;
    expect(css.border).toBe('1px solid #abcdef');
  });

  it('Checkbox: uiInk.effectGlow.muiBlue recolours glow and pulse', () => {
    renderIn(GLOWS, <Checkbox pulse />);
    renderIn(GLOWS, <Checkbox glow />);
    const css = emittedCss();
    expect(css).toContain('rgba(1, 2, 3, 0.7)');
    expect(css).toContain('rgba(1, 2, 3, 0.8)');
    expect(css).toContain('rgba(1, 2, 3, 0.5)');
  });

  it('Breadcrumbs pulse: uiInk.effectGlow.brandIndigo recolours it', () => {
    const css = breadcrumbsPulse(GLOWS).styles;
    expect(css).toContain('rgba(4, 5, 6, 0.4)');
    expect(css).not.toContain('rgba(99, 102, 241');
  });

  it('Alert neutral: palette.grey 500 / 300 / 700 draw it', () => {
    const grey = createTheme({ palette: { grey: { ...DEFAULT.palette.grey, 300: '#c3c3c3', 500: '#555555', 700: '#777777' } } });
    expect(alertPalette(grey, 'neutral')).toMatchObject({ main: '#555555', light: '#c3c3c3', dark: '#777777' });
    expect(alertPalette(DEFAULT, 'neutral')).toMatchObject({ main: '#9e9e9e', light: '#e0e0e0', dark: '#616161' });
  });

  it('Avatar offline dot: palette.grey 500 draws it', () => {
    renderIn(RE_TINTED, <Avatar variant="status" status="offline" />);
    expect(emittedCss().toLowerCase()).toContain('#123456');
  });

  it('Heading neutral gradient: palette.grey 500 into 900', () => {
    renderIn(RE_TINTED, <Heading gradient color="neutral">Hi</Heading>);
    const css = emittedCss().toLowerCase();
    expect(css).toContain('#123456');
    expect(css).toContain('#345678');
  });

  it('Card renders under a re-tinted theme', () => {
    renderIn(RE_TINTED, <Card variant="section">x</Card>);
    expect(emittedCss()).toContain('rgba(16, 32, 48, 0.02)');
  });
});
