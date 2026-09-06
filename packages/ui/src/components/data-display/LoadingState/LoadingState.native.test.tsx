import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { LoadingState, messageStyle, skeletonTint } from './LoadingState.native';
import { SKELETON_ROW_HEIGHT, SPINNER_SIZES } from './LoadingState.metrics';
import { UiProvider } from '../../../provider/UiProvider.native';
import { createUiTheme } from '../../../tokens/theme';

/**
 * Rendered through react-native-web, so `testID` is `data-testid` and the
 * resolved style is what the browser would paint. What is asserted is the
 * NUMBERS — the same ones `LoadingState.tsx` reads — not a snapshot.
 */
const theme = createUiTheme();

/**
 * react-native-web puts the spinner's px size on the indicator INSIDE the
 * `progressbar` element, and writes plain style objects inline while
 * `StyleSheet.create` styles become classes — so px are read off `.style`
 * and class-borne values through `toHaveStyle` (computed).
 */
const spinnerBox = (testId: string): CSSStyleDeclaration =>
  (screen.getByTestId(testId).firstElementChild as HTMLElement).style;

describe('LoadingState (native)', () => {
  it('is a busy status region under the default test id', () => {
    render(<LoadingState />);
    const status = screen.getByTestId('loading-state');
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveAttribute('aria-label', 'Loading');
  });

  it('honours both spellings of the test id and derives the parts from it', () => {
    render(
      <>
        <LoadingState dataTestId="a" message="x" />
        <LoadingState testID="b" message="y" />
      </>,
    );
    expect(screen.getByTestId('a-spinner')).toBeInTheDocument();
    expect(screen.getByTestId('a-message')).toHaveTextContent('x');
    expect(screen.getByTestId('b-message')).toHaveTextContent('y');
  });

  it('shows a progressbar spinner and names the region after the message', () => {
    render(<LoadingState message="Carregando pedidos" />);
    expect(screen.getByRole('progressbar')).toBe(screen.getByTestId('loading-state-spinner'));
    expect(screen.getByTestId('loading-state')).toHaveAttribute('aria-label', 'Carregando pedidos');
    expect(screen.getByTestId('loading-state-message')).toHaveTextContent('Carregando pedidos');
  });

  it.each(['xs', 'sm', 'md', 'lg', 'xl'] as const)('size %s draws the web spinner diameter', (size) => {
    render(<LoadingState size={size} dataTestId={size} />);
    const style = spinnerBox(`${size}-spinner`);
    expect(style.width).toBe(`${SPINNER_SIZES[size]}px`);
    expect(style.height).toBe(`${SPINNER_SIZES[size]}px`);
  });

  it('pads the spinner view like the web: 48px, 200px tall, 16px apart', () => {
    render(<LoadingState message="x" />);
    const style = screen.getByTestId('loading-state').style;
    expect(style.paddingTop).toBe('48px');
    expect(style.paddingLeft).toBe('48px');
    expect(style.minHeight).toBe('200px');
    expect(style.gap).toBe('16px');
    expect(screen.getByTestId('loading-state')).toHaveStyle({ alignItems: 'center', justifyContent: 'center' });
  });

  it('sets the message in MUI body1 at md, body2 below, h6 above', () => {
    expect(messageStyle(theme, 'md')).toMatchObject({ fontSize: 16, lineHeight: 24, fontWeight: '400' });
    expect(messageStyle(theme, 'sm')).toMatchObject({ fontSize: 14, fontWeight: '400' });
    expect(messageStyle(theme, 'sm').lineHeight).toBeCloseTo(14 * 1.43);
    expect(messageStyle(theme, 'lg')).toMatchObject({ fontSize: 20, lineHeight: 32, fontWeight: '500' });
    expect(messageStyle(theme, 'md').color).toBe(theme.palette.text.secondary);
    render(<LoadingState size="lg" message="Grande" />);
    const message = screen.getByTestId('loading-state-message').style;
    expect(message.fontSize).toBe('20px');
    expect(message.fontWeight).toBe('500');
    expect(message.lineHeight).toBe('32px');
  });

  it('renders the asked-for skeleton rows, the last one short', () => {
    render(<LoadingState variant="skeleton" skeletonRows={4} dataTestId="sk" size="md" />);
    const rows = [0, 1, 2, 3].map((index) => screen.getByTestId(`sk-skeleton-${index}`));
    for (const row of rows) {
      expect(row).toHaveAttribute('aria-hidden', 'true');
      expect(row.style.height).toBe(`${SKELETON_ROW_HEIGHT.md}px`);
      expect(row.style.borderTopLeftRadius).toBe('4px');
    }
    expect(rows[0]?.style.width).toBe('100%');
    expect(rows[3]?.style.width).toBe('60%');
    expect(screen.queryAllByTestId(/^sk-skeleton-/)).toHaveLength(4);
  });

  it('tints the rows with the house Skeleton alpha and lays them out 16px apart under 24px of padding', () => {
    render(<LoadingState variant="skeleton" dataTestId="sk" />);
    expect(skeletonTint(theme)).toBe('rgba(0, 0, 0, 0.13)');
    expect(screen.getByTestId('sk-skeleton-0')).toHaveStyle({ backgroundColor: 'rgba(0, 0, 0, 0.13)' });
    const container = screen.getByTestId('sk');
    expect(container.style.paddingTop).toBe('24px');
    expect(container).toHaveStyle({ width: '100%' });
    expect(container).toHaveAttribute('aria-label', 'Loading content');
    expect((screen.getByTestId('sk-skeleton-0').parentElement as HTMLElement).style.gap).toBe('16px');
  });

  it('gives skeleton rows no id at all without a base id, and centres the message 16px below them', () => {
    render(<LoadingState variant="skeleton" message="Preparando" />);
    expect(screen.getByTestId('loading-state')).toBeInTheDocument();
    expect(screen.queryAllByTestId(/skeleton-\d+$/)).toHaveLength(0);
    const message = screen.getByTestId('loading-state-message');
    expect(message.style.marginTop).toBe('16px');
    expect(message.style.textAlign).toBe('center');
  });

  it('falls back to the defaults for explicitly undefined props', () => {
    render(<LoadingState variant={undefined} size={undefined} skeletonRows={undefined} dataTestId="d" />);
    expect(spinnerBox('d-spinner').width).toBe(`${SPINNER_SIZES.md}px`);
  });

  it('reads the provider theme', () => {
    const dark = createUiTheme({ mode: 'dark' });
    render(
      <UiProvider theme={dark}>
        <LoadingState variant="skeleton" dataTestId="dk" message="x" />
      </UiProvider>,
    );
    expect(skeletonTint(dark)).toBe('rgba(255, 255, 255, 0.13)');
    expect(screen.getByTestId('dk-skeleton-0')).toHaveStyle({ backgroundColor: 'rgba(255, 255, 255, 0.13)' });
    expect(screen.getByTestId('dk-message')).toHaveStyle({ color: dark.palette.text.secondary });
  });

  it('passes a View prop and a style through to the region', () => {
    render(<LoadingState dataTestId="v" style={{ marginTop: 3 }} aria-live="polite" />);
    const region = screen.getByTestId('v');
    expect(region.style.marginTop).toBe('3px');
    expect(region).toHaveAttribute('aria-live', 'polite');
  });
});
