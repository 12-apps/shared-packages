import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { Text, textStyle } from './Text.native';
import { UiProvider } from '../../../provider/UiProvider.native';
import { createUiTheme } from '../../../tokens/theme';

/**
 * Rendered through react-native-web, so `testID` is `data-testid` and the
 * resolved style is what the browser would paint. What is asserted is the
 * NUMBERS — the same ones `Text.tsx` derives its rem from — not a snapshot.
 */
const theme = createUiTheme();

describe('Text (native)', () => {
  it('renders its children under the test id', () => {
    render(<Text dataTestId="greeting">Olá</Text>);
    expect(screen.getByTestId('greeting')).toHaveTextContent('Olá');
  });

  it('honours every spelling of the test id', () => {
    render(
      <>
        <Text testID="a">a</Text>
        <Text dataTestId="b">b</Text>
        <Text {...{ 'data-testid': 'c' }}>c</Text>
      </>,
    );
    for (const id of ['a', 'b', 'c']) expect(screen.getByTestId(id)).toBeInTheDocument();
  });

  it('paints the body scale at the web sizes', () => {
    const md = textStyle(theme, base({ size: 'md' }));
    expect(md.fontSize).toBe(16);
    expect(md.lineHeight).toBe(24);
    expect(textStyle(theme, base({ size: 'xs' })).fontSize).toBe(12);
    expect(textStyle(theme, base({ size: 'xl' })).fontSize).toBe(20);
    expect(textStyle(theme, base({ size: 'lg' })).lineHeight).toBeCloseTo(18 * 1.4);
  });

  it('maps colours the way the web does', () => {
    expect(textStyle(theme, base({ color: 'neutral' })).color).toBe(theme.palette.text.primary);
    expect(textStyle(theme, base({ color: 'secondary' })).color).toBe(theme.palette.text.secondary);
    expect(textStyle(theme, base({ color: 'danger' })).color).toBe(theme.palette.danger.main);
    expect(textStyle(theme, base({ color: 'info' })).color).toBe(theme.palette.info.main);
  });

  it('heading is 600 by default and keeps an explicit weight', () => {
    expect(textStyle(theme, base({ variant: 'heading' })).fontWeight).toBe('600');
    expect(textStyle(theme, base({ variant: 'heading', weight: 'light' })).fontWeight).toBe('300');
    expect(textStyle(theme, base({ variant: 'heading' })).letterSpacing).toBeCloseTo(-0.16);
  });

  it('caption shrinks only at the default size', () => {
    expect(textStyle(theme, base({ variant: 'caption' })).fontSize).toBe(12);
    expect(textStyle(theme, base({ variant: 'caption' })).opacity).toBe(0.8);
    expect(textStyle(theme, base({ variant: 'caption', size: 'lg' })).fontSize).toBe(18);
  });

  it('code sits on a primary wash inside a hairline', () => {
    const code = textStyle(theme, base({ variant: 'code' }));
    expect(code.fontSize).toBe(14);
    expect(code.backgroundColor).toBe('rgba(99, 102, 241, 0.08)');
    expect(code.borderColor).toBe('rgba(99, 102, 241, 0.12)');
    expect(code.borderRadius).toBe(2);
    expect(code.paddingVertical).toBe(2);
    expect(code.paddingHorizontal).toBe(6);
  });

  it('combines underline and strikethrough', () => {
    expect(textStyle(theme, base({ underline: true, strikethrough: true })).textDecorationLine).toBe(
      'underline line-through',
    );
    expect(textStyle(theme, base({ underline: true })).textDecorationLine).toBe('underline');
    expect(textStyle(theme, base({})).textDecorationLine).toBe('none');
  });

  it('reads the provider theme', () => {
    render(
      <UiProvider theme={{ mode: 'dark' }}>
        <Text dataTestId="dark">x</Text>
      </UiProvider>,
    );
    expect(screen.getByTestId('dark')).toHaveStyle({ color: 'rgb(255, 255, 255)' });
  });

  it('announces a heading to assistive technology', () => {
    render(<Text variant="heading">Título</Text>);
    expect(screen.getByRole('heading')).toHaveTextContent('Título');
  });
});

function base(over: Partial<Parameters<typeof textStyle>[1]>): Parameters<typeof textStyle>[1] {
  return {
    variant: 'body',
    color: 'neutral',
    size: 'md',
    weight: 'normal',
    italic: false,
    underline: false,
    strikethrough: false,
    ...over,
  };
}
