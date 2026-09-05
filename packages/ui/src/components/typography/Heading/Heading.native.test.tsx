import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { headingGradientStops } from './Heading.metrics';
import { Heading, headingStyle } from './Heading.native';
import { UiProvider } from '../../../provider/UiProvider.native';
import { createUiTheme } from '../../../tokens/theme';
import { COLOR_VALUES } from '../../../tokens/vocabulary';

/**
 * Rendered through react-native-web, so `testID` is `data-testid` and the
 * resolved style is what the browser would paint. What is asserted is the
 * NUMBERS — the same scale `Heading.styles.ts` reads through the MUI theme —
 * not a snapshot.
 */
describe('Heading (native)', () => {
  it('renders its children under every spelling of the test id', () => {
    render(
      <>
        <Heading testID="a">a</Heading>
        <Heading dataTestId="b">b</Heading>
        <Heading {...{ 'data-testid': 'c' }}>c</Heading>
      </>,
    );
    for (const id of ['a', 'b', 'c']) expect(screen.getByTestId(id)).toHaveTextContent(id);
  });

  it('announces a heading at the rank `level` names — display is an h1, an unknown level the h2 default', () => {
    render(
      <>
        <Heading level="h1">one</Heading>
        <Heading level="h4">four</Heading>
        <Heading level="display">hero</Heading>
        <Heading>default</Heading>
      </>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'one' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'four' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'hero' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'default' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading')).toHaveLength(4);
  });

  it('draws `size`, not `level`, and keeps the rank — the two are independent', () => {
    render(
      <Heading level="h1" size="h6" dataTestId="small-title">
        page title
      </Heading>,
    );
    const heading = screen.getByTestId('small-title');
    expect(heading).toHaveAttribute('aria-level', '1');
    expect(heading.style.fontSize).toBe('16px');
  });

  it('reads the steps off the theme scale and multiplies the ratios out', () => {
    const ui = createUiTheme();
    const h1 = headingStyle(ui, base({ size: 'h1' }));
    expect(h1.fontSize).toBe(32);
    expect(h1.lineHeight).toBeCloseTo(32 * 1.2);
    expect(h1.letterSpacing).toBeCloseTo(-0.64);
    expect(headingStyle(ui, base({ size: 'display' })).fontSize).toBe(48);
    expect(headingStyle(ui, base({ size: 'display' })).lineHeight).toBeCloseTo(48 * 1.05);
    const h6 = headingStyle(ui, base({ size: 'h6' }));
    expect(h6.fontSize).toBe(16);
    expect(h6.lineHeight).toBe(24);
    // h5 and h6 carry no tracking on the scale: "normal", not 0.
    expect(h6.letterSpacing).toBeUndefined();
    expect(headingStyle(ui, base({ size: 'h5' })).letterSpacing).toBeUndefined();
  });

  it('is bold by default; `normal` is the weight the step was designed to carry', () => {
    const ui = createUiTheme();
    expect(headingStyle(ui, base({})).fontWeight).toBe('700');
    expect(headingStyle(ui, base({ weight: 'normal', size: 'display' })).fontWeight).toBe('800');
    expect(headingStyle(ui, base({ weight: 'normal', size: 'h1' })).fontWeight).toBe('700');
    expect(headingStyle(ui, base({ weight: 'normal', size: 'h3' })).fontWeight).toBe('600');
    expect(headingStyle(ui, base({ weight: 'light' })).fontWeight).toBe('300');
    expect(headingStyle(ui, base({ weight: 'medium' })).fontWeight).toBe('500');
  });

  it('maps colours the way the web does', () => {
    const ui = createUiTheme();
    expect(headingStyle(ui, base({ color: 'neutral' })).color).toBe(ui.palette.text.primary);
    expect(headingStyle(ui, base({ color: 'primary' })).color).toBe(ui.palette.primary.main);
    expect(headingStyle(ui, base({ color: 'secondary' })).color).toBe(ui.palette.secondary.main);
    expect(headingStyle(ui, base({ color: 'danger' })).color).toBe(ui.palette.danger.main);
    expect(headingStyle(ui, base({ color: 'info' })).color).toBe(ui.palette.info.main);
  });

  it('paints a gradient heading in its first stop, and every colour has its own pair', () => {
    const ui = createUiTheme();
    expect(headingGradientStops(ui, 'primary')).toEqual([ui.palette.primary.main, ui.palette.secondary.main]);
    expect(headingGradientStops(ui, 'secondary')).toEqual([ui.palette.secondary.main, ui.palette.primary.main]);
    expect(headingGradientStops(ui, 'success')).toEqual([ui.palette.success.light, ui.palette.success.dark]);
    expect(headingGradientStops(ui, 'danger')).toEqual([ui.palette.danger.light, ui.palette.danger.dark]);
    expect(headingGradientStops(ui, 'neutral')).toEqual([ui.palette.grey[500], ui.palette.grey[900]]);
    // The two that fell back to primary on the web before the map was made exhaustive.
    expect(headingGradientStops(ui, 'info')).not.toEqual(headingGradientStops(ui, 'primary'));
    expect(headingGradientStops(ui, 'neutral')).not.toEqual(headingGradientStops(ui, 'primary'));
    const pairs = COLOR_VALUES.map((color) => headingGradientStops(ui, color).join('>'));
    expect(new Set(pairs).size).toBe(COLOR_VALUES.length);

    expect(headingStyle(ui, base({ gradient: true, color: 'success' })).color).toBe(ui.palette.success.light);
    expect(headingStyle(ui, base({ gradient: true, color: 'neutral' })).color).toBe(ui.palette.grey[500]);
  });

  it('reaches the DOM with the same numbers', () => {
    render(<Heading dataTestId="h2">x</Heading>);
    // Read the inline declarations, not the computed style: react-native-web's
    // Text class sets a `font` shorthand, and jsdom lets that shadow the inline
    // longhands that a browser (and the native Storybook) paints.
    const { style } = screen.getByTestId('h2');
    expect(style.fontSize).toBe('28px');
    expect(Number.parseFloat(style.lineHeight)).toBeCloseTo(35);
    expect(Number.parseFloat(style.letterSpacing)).toBeCloseTo(-0.42);
    expect(style.fontWeight).toBe('700');
  });

  it('reads the provider theme', () => {
    render(
      <UiProvider theme={{ mode: 'dark' }}>
        <Heading dataTestId="dark">x</Heading>
      </UiProvider>,
    );
    expect(screen.getByTestId('dark')).toHaveStyle({ color: 'rgb(255, 255, 255)' });
  });

  it('fires onClick and onPress, both spelled', () => {
    const onClick = vi.fn();
    const onPress = vi.fn();
    render(
      <Heading dataTestId="go" onClick={onClick} onPress={onPress}>
        x
      </Heading>,
    );
    fireEvent.click(screen.getByTestId('go'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('lets a caller override the announced rank and the resolved style', () => {
    render(
      <Heading dataTestId="own" level="h2" {...{ 'aria-level': 5 }} style={{ fontSize: 11 }}>
        x
      </Heading>,
    );
    const heading = screen.getByTestId('own');
    expect(heading).toHaveAttribute('aria-level', '5');
    expect(heading.style.fontSize).toBe('11px');
  });
});

function base(over: Partial<Parameters<typeof headingStyle>[1]>): Parameters<typeof headingStyle>[1] {
  return { size: 'h2', color: 'neutral', weight: 'bold', gradient: false, ...over };
}
