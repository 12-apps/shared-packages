import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { Text as RNText } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { ErrorState, iconBoxStyle, messageStyle, retryStyle, titleStyle } from './ErrorState.native';
import { UiProvider } from '../../../provider/UiProvider.native';
import { createUiTheme } from '../../../tokens/theme';

/**
 * Rendered through react-native-web, so `testID` is `data-testid` and plain
 * style objects land inline. What is asserted is the NUMBERS — the same ones
 * `ErrorState.tsx` reads from the metrics — not a snapshot.
 */
const theme = createUiTheme();

describe('ErrorState (native)', () => {
  it('is an alert region under the default test id, described by its message', () => {
    render(<ErrorState message="Falhou" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-testid', 'error-state');
    const message = screen.getByTestId('error-state-message');
    expect(message).toHaveTextContent('Falhou');
    expect(alert).toHaveAttribute('aria-describedby', message.id);
    expect(alert).not.toHaveAttribute('aria-labelledby');
  });

  it('labels itself by the title, rendered as a level-3 heading', () => {
    render(<ErrorState title="Erro de conexão" message="x" />);
    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading).toHaveTextContent('Erro de conexão');
    expect(heading.tagName).toBe('H3');
    expect(screen.getByRole('alert')).toHaveAttribute('aria-labelledby', heading.id);
    expect(screen.getByTestId('error-state-title')).toBe(heading);
  });

  it('derives every part id from either spelling of the test id', () => {
    render(
      <>
        <ErrorState dataTestId="a" title="t" message="m" onRetry={vi.fn()} />
        <ErrorState testID="b" message="m" />
      </>,
    );
    for (const id of ['a', 'a-icon', 'a-title', 'a-message', 'a-retry-button', 'b', 'b-icon', 'b-message']) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it('draws the glyph in an 80px disc of the severity light shade at 0.9', () => {
    render(<ErrorState message="x" />);
    const box = screen.getByTestId('error-state-icon').style;
    expect(box.width).toBe('80px');
    expect(box.height).toBe('80px');
    expect(box.borderTopLeftRadius).toBe('40px');
    expect(box.opacity).toBe('0.9');
    // danger.light is #ef5350
    expect(box.backgroundColor).toBe('rgb(239, 83, 80)');
    const glyph = screen.getByTestId('icon-ErrorOutline');
    expect(glyph).toHaveAttribute('width', '48');
    expect(glyph).toHaveAttribute('fill', theme.palette.danger.main);
  });

  it('switches disc, glyph and button colour for the warning severity', () => {
    render(<ErrorState message="x" severity="warning" onRetry={vi.fn()} />);
    expect(iconBoxStyle(theme, 'warning').backgroundColor).toBe(theme.palette.warning.light);
    expect(screen.getByTestId('icon-WarningAmber')).toHaveAttribute('fill', theme.palette.warning.main);
    expect(screen.getByTestId('error-state-retry-button')).toHaveStyle({ borderTopColor: theme.palette.warning.main });
  });

  it('lets a custom icon replace the glyph', () => {
    render(<ErrorState message="x" icon={<RNText testID="custom">!</RNText>} />);
    expect(screen.getByTestId('error-state-icon')).toContainElement(screen.getByTestId('custom'));
    expect(screen.queryAllByTestId(/^icon-/)).toHaveLength(0);
  });

  it('shows the retry button only with a handler, labelled and firing it once per press', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<ErrorState message="x" />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    rerender(<ErrorState message="x" onRetry={onRetry} retryLabel="Tentar de novo" />);
    const button = screen.getByRole('button');
    expect(button).toBe(screen.getByTestId('error-state-retry-button'));
    expect(button).toHaveTextContent('Tentar de novo');
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('defaults the retry label to Retry and sizes the button to MUI outlined medium', () => {
    render(<ErrorState message="x" onRetry={vi.fn()} />);
    const button = screen.getByTestId('error-state-retry-button');
    expect(button).toHaveTextContent('Retry');
    expect(button.style.marginTop).toBe('8px');
    expect(button.style.minWidth).toBe('120px');
    expect(button.style.paddingTop).toBe('5px');
    expect(button.style.paddingLeft).toBe('15px');
    expect(button.style.borderTopLeftRadius).toBe('4px');
    expect(screen.getByTestId('icon-Refresh')).toHaveAttribute('width', '20');
    expect(retryStyle(theme)).toMatchObject({ marginTop: 8, minWidth: 120, borderRadius: 4 });
  });

  it('sets the title in h6 medium and the message in body2 on a 1.6 line height', () => {
    render(<ErrorState title="T" message="M" />);
    const title = screen.getByTestId('error-state-title').style;
    expect(title.fontSize).toBe('20px');
    expect(title.fontWeight).toBe('500');
    expect(title.lineHeight).toBe('32px');
    expect(title.color).toBe('rgba(0, 0, 0, 0.87)');
    const message = screen.getByTestId('error-state-message').style;
    expect(message.fontSize).toBe('14px');
    // 14 * 1.6, with the float noise the browser also carries for a unitless line-height.
    expect(parseFloat(message.lineHeight)).toBeCloseTo(22.4);
    expect(message.maxWidth).toBe('400px');
    expect(message.color).toBe('rgba(0, 0, 0, 0.6)');
    expect(titleStyle(theme).letterSpacing).toBeCloseTo(0.15);
    expect(messageStyle(theme).letterSpacing).toBeCloseTo(0.15, 3);
  });

  it('lays out like the web: 48px of padding, a 200px floor, 16px between parts, 8px between the lines', () => {
    render(<ErrorState title="T" message="M" dataTestId="e" />);
    const root = screen.getByTestId('e');
    expect(root.style.paddingTop).toBe('48px');
    expect(root.style.minHeight).toBe('200px');
    expect(root.style.gap).toBe('16px');
    expect(root).toHaveStyle({ alignItems: 'center' });
    expect((screen.getByTestId('e-title').parentElement as HTMLElement).style.gap).toBe('8px');
  });

  it('reads the provider theme', () => {
    render(
      <UiProvider theme={{ mode: 'dark', palette: { danger: '#ff5252' } }}>
        <ErrorState title="T" message="M" />
      </UiProvider>,
    );
    expect(screen.getByTestId('error-state-title').style.color).toBe('rgb(255, 255, 255)');
    expect(screen.getByTestId('icon-ErrorOutline')).toHaveAttribute('fill', '#ff5252');
  });

  it('passes View props and a style through to the region', () => {
    render(<ErrorState message="M" dataTestId="v" style={{ marginBottom: 2 }} aria-live="polite" />);
    expect(screen.getByTestId('v').style.marginBottom).toBe('2px');
    expect(screen.getByTestId('v')).toHaveAttribute('aria-live', 'polite');
  });
});
