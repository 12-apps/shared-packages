import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { Text as RNText } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { alertLook, descriptionStyle, messageTextStyle, titleStyle } from './Alert.look.native';
import { alertPalette, glassSurface, gradientSurface, semanticSurface } from './Alert.metrics';
import { Alert } from './Alert.native';
import { UiProvider } from '../../../provider/UiProvider.native';
import { alpha, darken, lighten } from '../../../tokens/color';
import { createUiTheme } from '../../../tokens/theme';

/**
 * Rendered through react-native-web, so `testID` is `data-testid`, plain style
 * objects land inline and a `Pressable` button is a `<button>`. What is
 * asserted is the NUMBERS — the same ones `Alert.styles.tsx` derives its CSS
 * from — through the same colour arithmetic, not a snapshot.
 */
const theme = createUiTheme();
const info = theme.palette.info.main;
const look = (over: Partial<Parameters<typeof alertLook>[1]>) =>
  alertLook(theme, { variant: 'info', color: undefined, glow: false, pulse: false, ...over });

describe('Alert (native)', () => {
  it('is a polite, atomic, focusable alert under the default test id', () => {
    render(<Alert>Olá</Alert>);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-testid', 'alert');
    expect(alert).toHaveAttribute('aria-live', 'polite');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    expect(alert).toHaveAttribute('tabindex', '0');
    expect(alert).toHaveTextContent('Olá');
  });

  it('announces danger assertively unless told otherwise, and takes another role', () => {
    render(
      <>
        <Alert variant="danger" dataTestId="d">x</Alert>
        <Alert variant="danger" aria-live="polite" dataTestId="p">x</Alert>
        <Alert role="status" dataTestId="s">x</Alert>
      </>,
    );
    expect(screen.getByTestId('d')).toHaveAttribute('aria-live', 'assertive');
    expect(screen.getByTestId('p')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByTestId('s')).toHaveAttribute('role', 'status');
  });

  it('honours every spelling of the test id and derives the parts from it', () => {
    render(
      <>
        <Alert testID="a" title="t" description="d" closable closeLabel="fechar">c</Alert>
        <Alert dataTestId="b" title="t" />
        <Alert {...{ 'data-testid': 'c' }} title="t" />
      </>,
    );
    for (const id of ['a', 'a-icon', 'a-title', 'a-message', 'a-close', 'b', 'b-title', 'c', 'c-title']) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it('paints a semantic variant as an opaque tint with a same-hue ink and hairline', () => {
    render(<Alert variant="info" dataTestId="i" title="T" />);
    const root = screen.getByTestId('i');
    expect(lighten(info, 0.9)).toBe('rgb(229, 243, 250)');
    expect(root).toHaveStyle({ backgroundColor: lighten(info, 0.9) });
    expect(root).toHaveStyle({ borderTopColor: alpha(info, 0.35), borderTopWidth: '1px' });
    expect(screen.getByTestId('i-title').style.color).toBe(darken(info, 0.6));
    expect(screen.getByTestId('icon-Info')).toHaveAttribute('fill', info);
  });

  it('inverts the tint and ink in dark mode', () => {
    const dark = createUiTheme({ mode: 'dark' });
    const surface = semanticSurface(dark, dark.palette.success);
    expect(surface.backgroundColor).toBe(darken(dark.palette.success.main, 0.8));
    expect(surface.color).toBe(lighten(dark.palette.success.main, 0.6));
    render(
      <UiProvider theme={dark}>
        <Alert variant="success" dataTestId="s" title="T" />
      </UiProvider>,
    );
    expect(screen.getByTestId('s')).toHaveStyle({ backgroundColor: surface.backgroundColor });
    expect(screen.getByTestId('s-title').style.color).toBe(surface.color);
  });

  it('lets color override the variant palette, neutral coming from the greys', () => {
    expect(look({ color: 'primary' }).palette.main).toBe(theme.palette.primary.main);
    expect(look({ color: 'neutral' }).palette).toEqual({
      main: theme.palette.grey[500],
      light: theme.palette.grey[300],
      dark: theme.palette.grey[700],
    });
    expect(alertPalette(theme, 'gradient')).toBe(theme.palette.info);
    render(<Alert variant="info" color="danger" dataTestId="c" />);
    expect(screen.getByTestId('c')).toHaveStyle({ backgroundColor: lighten(theme.palette.danger.main, 0.9) });
  });

  it('paints glass as an 85% paper pane and gradient as its first stop', () => {
    const glass = glassSurface(theme);
    expect(glass.backgroundColor).toBe('rgba(255, 255, 255, 0.85)');
    expect(glass.borderColor).toBe(alpha(theme.palette.divider, 0.4));
    expect(glass.iconColor).toBe(theme.palette.primary.main);
    const gradient = gradientSurface(theme.palette.primary);
    expect(gradient.backgroundColor).toBe(alpha(theme.palette.primary.light, 0.9));
    expect(gradient.color).toBe('#fff');
    render(
      <>
        <Alert variant="glass" dataTestId="g" title="T" />
        <Alert variant="gradient" color="primary" dataTestId="gr" title="T" />
      </>,
    );
    expect(screen.getByTestId('g')).toHaveStyle({ backgroundColor: 'rgba(255, 255, 255, 0.85)' });
    expect(screen.getByTestId('g-title').style.color).toBe('rgba(0, 0, 0, 0.87)');
    expect(screen.getByTestId('gr')).toHaveStyle({ backgroundColor: alpha(theme.palette.primary.light, 0.9) });
    expect(screen.getByTestId('gr').style.borderTopWidth).toBe('');
    expect(screen.getByTestId('gr-title').style.color).toBe('rgb(255, 255, 255)');
  });

  it('lays out like the web: 14px 16px of padding, 12px corners, the slots where MUI puts them', () => {
    render(<Alert dataTestId="l" title="T" description="D" closable closeLabel="fechar">c</Alert>);
    const root = screen.getByTestId('l').style;
    expect(root.paddingTop).toBe('14px');
    expect(root.paddingLeft).toBe('16px');
    expect(root.borderTopLeftRadius).toBe('12px');
    expect(root.flexDirection).toBe('row');
    expect(root.overflowX).toBe('hidden');
    const icon = screen.getByTestId('l-icon').style;
    expect(icon.marginRight).toBe('14px');
    expect(icon.paddingTop).toBe('2px');
    expect(icon.paddingBottom).toBe('7px');
    expect(icon.alignSelf).toBe('flex-start');
    expect(icon.opacity).toBe('0.9');
    const message = (screen.getByTestId('l-title').parentElement as HTMLElement).style;
    expect(message.gap).toBe('8px');
    expect(message.flexShrink).toBe('1');
    const action = (screen.getByTestId('l-close').parentElement as HTMLElement).style;
    expect(action.paddingLeft).toBe('16px');
    expect(action.paddingTop).toBe('4px');
    expect(action.marginLeft).toBe('auto');
    expect(action.marginRight).toBe('-8px');
  });

  it('sets the title at 1.05rem/600, the description at 0.925rem faded, children at 0.95rem', () => {
    render(<Alert dataTestId="t" title="T" description="D">c</Alert>);
    const title = screen.getByTestId('t-title').style;
    expect(title.fontSize).toBe('16.8px');
    expect(title.fontWeight).toBe('600');
    expect(parseFloat(title.lineHeight)).toBeCloseTo(25.2);
    expect(title.marginTop).toBe('-2px');
    expect(title.marginBottom).toBe('4px');
    const description = screen.getByTestId('t-message').style;
    expect(description.fontSize).toBe('14.8px');
    expect(description.opacity).toBe('0.9');
    expect(parseFloat(description.lineHeight)).toBeCloseTo(22.2);
    const child = screen.getByText('c').style;
    expect(child.fontSize).toBe('15.2px');
    expect(parseFloat(child.lineHeight)).toBeCloseTo(22.8);
    expect(titleStyle(theme, '#000', false).marginBottom).toBe(0);
    expect(messageTextStyle(theme, '#000').letterSpacing).toBeCloseTo(0.01071 * 15.2);
    expect(descriptionStyle(theme, '#000').letterSpacing).toBeCloseTo(0.01071 * 14.8);
  });

  it('draws the variant glyph at 22px, a custom icon instead, or an empty slot for glass', () => {
    const { rerender } = render(<Alert variant="success" dataTestId="g" />);
    expect(screen.getByTestId('icon-CheckCircle')).toHaveAttribute('width', '22');
    expect(screen.getByTestId('icon-CheckCircle')).toHaveAttribute('fill', theme.palette.success.main);
    rerender(<Alert variant="warning" dataTestId="g" icon={<RNText testID="custom">!</RNText>} />);
    expect(screen.getByTestId('g-icon')).toContainElement(screen.getByTestId('custom'));
    rerender(<Alert variant="glass" dataTestId="g" />);
    expect(screen.getByTestId('g-icon').childElementCount).toBe(0);
    rerender(<Alert variant="glass" dataTestId="g" showIcon={false} />);
    expect(screen.queryAllByTestId('g-icon')).toHaveLength(0);
  });

  it('dismisses through a labelled close button: onClose 200ms in, gone once the collapse has run', async () => {
    const onClose = vi.fn();
    render(<Alert dataTestId="x" title="T" closable closeLabel="fechar aviso" onClose={onClose} />);
    const close = screen.getByRole('button', { name: 'fechar aviso' });
    expect(close).toBe(screen.getByTestId('x-close'));
    expect(close.style.paddingTop).toBe('5px');
    expect(close.style.opacity).toBe('0.7');
    expect(screen.getByTestId('icon-Close')).toHaveAttribute('width', '18');
    fireEvent.click(close);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('renders no close button unless closable', () => {
    render(<Alert title="T" />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('glows with the web shadow and brightness, and pulses with a hidden wash', () => {
    render(
      <>
        <Alert dataTestId="g" glow title="T" />
        <Alert dataTestId="p" pulse title="T" />
        <Alert dataTestId="n" title="T" />
      </>,
    );
    const shadow = `0 0 20px 5px ${alpha(info, 0.3)}`;
    const glow = screen.getByTestId('g');
    expect(glow.getAttribute('style')).toContain(`box-shadow: ${shadow}`);
    expect(glow.getAttribute('style')).toContain('filter: brightness(1.05)');
    expect(glow.style.overflowX).toBe('visible');
    expect(look({ glow: true }).root.boxShadow).toBe(shadow);
    const pulse = screen.getByTestId('p-pulse');
    expect(pulse).toHaveAttribute('aria-hidden', 'true');
    expect(pulse).toHaveStyle({ backgroundColor: info });
    expect(screen.queryAllByTestId('n-pulse')).toHaveLength(0);
  });

  it('animates on mount only when asked', () => {
    render(
      <>
        <Alert dataTestId="a" title="T" />
        <Alert dataTestId="s" title="T" animate={false} />
      </>,
    );
    expect(screen.getByTestId('a').style.transform).not.toBe('');
    expect(screen.getByTestId('s').style.transform).toBe('');
    expect(screen.getByTestId('s').style.opacity).toBe('');
  });

  it('passes View props and a style through to the root', () => {
    render(<Alert dataTestId="v" title="T" style={{ marginBottom: 3 }} aria-label="aviso" />);
    expect(screen.getByTestId('v').style.marginBottom).toBe('3px');
    expect(screen.getByTestId('v')).toHaveAttribute('aria-label', 'aviso');
  });
});
