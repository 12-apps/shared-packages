import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Paragraph, paragraphStyle } from './Paragraph.native';
import { UiProvider } from '../../../provider/UiProvider.native';
import { createUiTheme } from '../../../tokens/theme';

/**
 * Rendered through react-native-web, so `testID` is `data-testid` and the
 * resolved style is what the browser would paint. What is asserted is the
 * NUMBERS — the same ones `Paragraph.tsx` derives its rem from — not a snapshot.
 */
describe('Paragraph (native)', () => {
  it('renders its children under every spelling of the test id', () => {
    render(
      <>
        <Paragraph testID="a">a</Paragraph>
        <Paragraph dataTestId="b">b</Paragraph>
        <Paragraph {...{ 'data-testid': 'c' }}>c</Paragraph>
      </>,
    );
    for (const id of ['a', 'b', 'c']) expect(screen.getByTestId(id)).toHaveTextContent(id);
  });

  it('paints the paragraph scale, looser than the body scale, with a 1em margin below', () => {
    const ui = createUiTheme();
    const md = paragraphStyle(ui, base({}));
    expect(md.fontSize).toBe(16);
    expect(md.lineHeight).toBeCloseTo(16 * 1.6);
    expect(md.marginBottom).toBe(16);
    expect(paragraphStyle(ui, base({ size: 'xs' })).fontSize).toBe(12);
    expect(paragraphStyle(ui, base({ size: 'xs' })).lineHeight).toBeCloseTo(12 * 1.4);
    expect(paragraphStyle(ui, base({ size: 'xl' })).fontSize).toBe(20);
    expect(paragraphStyle(ui, base({ size: 'xl' })).lineHeight).toBeCloseTo(20 * 1.7);
    expect(paragraphStyle(ui, base({ size: 'xl' })).marginBottom).toBe(20);
  });

  it('lead steps up only at the default size, with looser leading and tracking', () => {
    const ui = createUiTheme();
    const lead = paragraphStyle(ui, base({ variant: 'lead' }));
    expect(lead.fontSize).toBe(18);
    expect(lead.lineHeight).toBeCloseTo(18 * 1.7);
    expect(lead.letterSpacing).toBeCloseTo(0.18);
    expect(lead.marginBottom).toBe(18);
    expect(paragraphStyle(ui, base({ variant: 'lead', size: 'sm' })).fontSize).toBe(14);
    expect(paragraphStyle(ui, base({ variant: 'lead', size: 'xl' })).fontSize).toBe(20);
  });

  it('small steps down only at the default size, on the secondary ink', () => {
    const ui = createUiTheme();
    const small = paragraphStyle(ui, base({ variant: 'small', color: 'primary' }));
    expect(small.fontSize).toBe(14);
    expect(small.lineHeight).toBeCloseTo(14 * 1.5);
    expect(small.color).toBe(ui.palette.text.secondary);
    expect(paragraphStyle(ui, base({ variant: 'small', size: 'xl' })).fontSize).toBe(20);
  });

  it('muted keeps the scale, fades, and ignores the colour prop', () => {
    const ui = createUiTheme();
    const muted = paragraphStyle(ui, base({ variant: 'muted', color: 'danger', size: 'lg' }));
    expect(muted.fontSize).toBe(18);
    expect(muted.opacity).toBe(0.8);
    expect(muted.color).toBe(ui.palette.text.secondary);
  });

  it('maps colours the way the web does — secondary is the palette slot, not the muted ink', () => {
    const ui = createUiTheme();
    expect(paragraphStyle(ui, base({ color: 'neutral' })).color).toBe(ui.palette.text.primary);
    expect(paragraphStyle(ui, base({ color: 'secondary' })).color).toBe(ui.palette.secondary.main);
    expect(paragraphStyle(ui, base({ color: 'danger' })).color).toBe(ui.palette.danger.main);
    expect(paragraphStyle(ui, base({ color: 'info' })).color).toBe(ui.palette.info.main);
    expect(paragraphStyle(ui, base({ variant: 'lead', color: 'success' })).color).toBe(ui.palette.success.main);
  });

  it('is always regular weight', () => {
    const ui = createUiTheme();
    for (const variant of ['default', 'lead', 'muted', 'small'] as const) {
      expect(paragraphStyle(ui, base({ variant })).fontWeight, variant).toBe('400');
    }
  });

  it('reaches the DOM with the same numbers', () => {
    render(
      <Paragraph dataTestId="p" variant="lead">
        x
      </Paragraph>,
    );
    // Read the inline declarations, not the computed style: react-native-web's
    // Text class sets a `font` shorthand, and jsdom lets that shadow the inline
    // longhands that a browser (and the native Storybook) paints.
    const { style } = screen.getByTestId('p');
    expect(style.fontSize).toBe('18px');
    expect(Number.parseFloat(style.lineHeight)).toBeCloseTo(30.6);
    expect(style.marginBottom).toBe('18px');
    expect(style.letterSpacing).toBe('0.18px');
    expect(style.fontWeight).toBe('400');
  });

  it('reads the provider theme', () => {
    render(
      <UiProvider theme={{ mode: 'dark' }}>
        <Paragraph dataTestId="dark">x</Paragraph>
      </UiProvider>,
    );
    expect(screen.getByTestId('dark')).toHaveStyle({ color: 'rgb(255, 255, 255)' });
  });

  it('fires onClick and onPress, both spelled', () => {
    const onClick = vi.fn();
    const onPress = vi.fn();
    render(
      <Paragraph dataTestId="go" onClick={onClick} onPress={onPress}>
        x
      </Paragraph>,
    );
    fireEvent.click(screen.getByTestId('go'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('lets a caller style win over the resolved one', () => {
    render(
      <Paragraph dataTestId="s" style={{ marginBottom: 0 }}>
        x
      </Paragraph>,
    );
    const { style } = screen.getByTestId('s');
    expect(style.marginBottom).toBe('0px');
    expect(style.fontSize).toBe('16px');
  });
});

function base(over: Partial<Parameters<typeof paragraphStyle>[1]>): Parameters<typeof paragraphStyle>[1] {
  return { variant: 'default', color: 'neutral', size: 'md', ...over };
}
