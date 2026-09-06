import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Avatar, AvatarGroup } from './Avatar.native';
import { avatarRadius, avatarSurfaceStyle } from './Avatar.look.native';
import { AVATAR_SIZES, GROUP_OVERLAP, STATUS_DOT, avatarAccent, statusColor } from './Avatar.metrics';
import { UiProvider } from '../../../provider/UiProvider.native';
import { alpha, hexToRgb } from '../../../tokens/color';
import { createUiTheme } from '../../../tokens/theme';

/**
 * Rendered through react-native-web, so `testID` is `data-testid`, `role` and
 * `aria-label` reach the DOM, and an `Image` puts a hidden `<img>` beside its
 * background box. What is asserted is the NUMBERS — the same ones
 * `Avatar.view.tsx` reads.
 */
const theme = createUiTheme();

/** A hex from the palette, as the DOM normalises it in a resolved style. */
const paint = (color: string): string => (color.startsWith('#') ? hexToRgb(color) : color);

/**
 * react-native-web loads a portrait through its own `new window.Image()` rather
 * than the `<img>` it renders, and jsdom fetches nothing — so the failure is
 * staged by standing in for that loader.
 */
class ErroringImage {
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;
  set src(_uri: string) {
    // On a microtask, not synchronously: a browser reports the failure after
    // the mount effects have run, and the avatar resets its own load state in
    // one of them.
    void Promise.resolve().then(() => this.onerror?.());
  }
}

afterEach(() => vi.unstubAllGlobals());

describe('Avatar (native)', () => {
  it('is a 40px circle in the accent, with the initials inside it', () => {
    render(<Avatar fallback="TS" dataTestId="a" />);
    const avatar = screen.getByTestId('a');
    expect(avatar.style.width).toBe(`${AVATAR_SIZES.md.box}px`);
    expect(avatar.style.borderTopLeftRadius).toBe(`${AVATAR_SIZES.md.box / 2}px`);
    expect(avatar.style.backgroundColor).toBe(paint(theme.palette.primary.main));
    const slot = screen.getByTestId('a-fallback');
    expect(slot).toHaveTextContent('TS');
    expect(avatar).toHaveAttribute('aria-label', 'Avatar');
  });

  it('draws all six boxes and their type steps', () => {
    render(
      <>
        <Avatar fallback="a" size="xs" dataTestId="xs" />
        <Avatar fallback="b" size="xl" dataTestId="xl" />
        <Avatar fallback="c" size="xxl" dataTestId="xxl" />
      </>,
    );
    expect(screen.getByTestId('xs').style.height).toBe(`${AVATAR_SIZES.xs.box}px`);
    expect(screen.getByTestId('xl').style.height).toBe(`${AVATAR_SIZES.xl.box}px`);
    expect(screen.getByTestId('xxl').style.height).toBe('80px');
    const text = screen.getByTestId('xxl-fallback').firstElementChild as HTMLElement;
    expect(text.style.fontSize).toBe(`${AVATAR_SIZES.xxl.fontSize}px`);
  });

  it('gives each shape variant its own radius', () => {
    render(
      <>
        <Avatar fallback="a" variant="square" dataTestId="sq" />
        <Avatar fallback="b" variant="rounded" dataTestId="rd" />
      </>,
    );
    expect(screen.getByTestId('sq').style.borderTopLeftRadius).toBe('0px');
    // `rounded` is one 8px spacing unit on both renderers.
    expect(screen.getByTestId('rd').style.borderTopLeftRadius).toBe('8px');
    expect(avatarRadius(theme, 'circle', 40)).toBe(20);
  });

  it('paints neutral from the ramp and danger from the error slot', () => {
    expect(avatarAccent(theme, 'neutral')).toEqual({ main: theme.palette.grey[700], contrastText: '#fff' });
    render(
      <>
        <Avatar fallback="n" color="neutral" dataTestId="n" />
        <Avatar fallback="d" color="danger" dataTestId="d" />
      </>,
    );
    expect(screen.getByTestId('n').style.backgroundColor).toBe(paint(theme.palette.grey[700]));
    expect(screen.getByTestId('d').style.backgroundColor).toBe(paint(theme.palette.danger.main));
  });

  it('picks children over a fallback, a fallback over an icon, an icon over the default', () => {
    render(
      <>
        <Avatar dataTestId="c" fallback="F" icon={<>I</>}>
          C
        </Avatar>
        <Avatar dataTestId="f" fallback="F" icon={<>I</>} />
        <Avatar dataTestId="i" icon={<>I</>} />
        <Avatar dataTestId="d" />
      </>,
    );
    expect(screen.getByTestId('c-children')).toHaveTextContent('C');
    expect(screen.getByTestId('f-fallback')).toHaveTextContent('F');
    expect(screen.getByTestId('i-icon')).toHaveTextContent('I');
    expect(screen.getByTestId('d-default').querySelector('svg')).toBeInTheDocument();
  });

  it('is a button only when it is interactive or handles a click', () => {
    render(
      <>
        <Avatar fallback="a" interactive dataTestId="a" />
        <Avatar fallback="b" onClick={() => undefined} dataTestId="b" />
        <Avatar fallback="c" dataTestId="c" />
      </>,
    );
    for (const id of ['a', 'b']) {
      expect(screen.getByTestId(id)).toHaveAttribute('role', 'button');
      expect(screen.getByTestId(id)).toHaveAttribute('tabindex', '0');
      expect(screen.getByTestId(id).style.cursor).toBe('pointer');
    }
    expect(screen.getByTestId('c')).not.toHaveAttribute('role');
    expect(screen.getByTestId('c')).toHaveAttribute('tabindex', '-1');
  });

  it('fires both handler spellings on a press', () => {
    const onClick = vi.fn();
    const onPress = vi.fn();
    render(<Avatar fallback="a" onClick={onClick} onPress={onPress} dataTestId="a" />);
    fireEvent.click(screen.getByTestId('a'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('names itself after the portrait, and lets a caller override it', () => {
    render(
      <>
        <Avatar src="https://example.test/a.jpg" alt="Foto de João" dataTestId="a" />
        <Avatar fallback="b" aria-label="Perfil" dataTestId="b" />
      </>,
    );
    expect(screen.getByTestId('a')).toHaveAttribute('aria-label', 'Foto de João');
    expect(screen.getByTestId('b')).toHaveAttribute('aria-label', 'Perfil');
  });

  it('shows the portrait until it fails, then the fallback', async () => {
    const onError = vi.fn();
    render(
      <Avatar src="https://example.test/a.jpg" alt="Retrato" fallback="ERR" onError={onError} dataTestId="a" />,
    );
    const img = screen.getByTestId('a').querySelector('img') as HTMLImageElement;
    expect(img).toHaveAttribute('alt', 'Retrato');
    expect(img.getAttribute('src')).toBe('https://example.test/a.jpg');
    expect(screen.queryAllByTestId('a-fallback')).toHaveLength(0);
  });

  it('falls back to the initials, in the error hue, when the portrait fails', async () => {
    vi.stubGlobal('Image', ErroringImage);
    const onError = vi.fn();
    render(
      <Avatar src="https://example.test/broken.jpg" fallback="ERR" onError={onError} dataTestId="a" />,
    );
    await waitFor(() => expect(screen.getByTestId('a-fallback')).toHaveTextContent('ERR'));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('a').style.backgroundColor).toBe(paint(theme.palette.danger.main));
  });

  it('shows the broken-image glyph on a failure, or the person when refused', async () => {
    vi.stubGlobal('Image', ErroringImage);
    render(
      <>
        <Avatar src="https://example.test/broken.jpg" dataTestId="b" />
        <Avatar src="https://example.test/broken.jpg" showFallbackOnError={false} dataTestId="p" />
      </>,
    );
    // The broken-image glyph shares the icon slot's id, as it does on the web.
    await waitFor(() => expect(screen.getByTestId('b-icon')).toBeInTheDocument());
    expect(screen.getByTestId('p-default')).toBeInTheDocument();
  });

  it('covers a loading avatar with the paper wash and a spinner', () => {
    render(<Avatar fallback="a" loading dataTestId="a" />);
    const overlay = screen.getByTestId('a-loading');
    expect(overlay.style.backgroundColor).toBe(alpha(theme.palette.background.paper, 0.7));
    expect(overlay.style.width).toBe(`${AVATAR_SIZES.md.box}px`);
    const spinner = screen.getByTestId('a-loading-spinner');
    expect(spinner.style.width).toBe(`${AVATAR_SIZES.md.box * 0.4}px`);
    expect(spinner.style.borderTopColor).toBe(paint(theme.palette.primary.main));
    expect(screen.queryAllByTestId('a-fallback')).toHaveLength(0);
  });

  it('glows and borders with the web shadows', () => {
    render(
      <>
        <Avatar fallback="g" glow dataTestId="g" />
        <Avatar fallback="b" bordered dataTestId="b" />
      </>,
    );
    expect(screen.getByTestId('g').style.boxShadow).toBe(
      `0 0 20px 5px ${alpha(theme.palette.primary.main, 0.4)}`,
    );
    const bordered = screen.getByTestId('b').style;
    expect(bordered.borderTopWidth).toBe('2px');
    expect(bordered.borderTopColor).toBe(paint(theme.palette.background.paper));
    expect(avatarSurfaceStyle(theme, {
      variant: 'circle',
      size: 'md',
      color: 'primary',
      glow: false,
      bordered: false,
      interactive: false,
      hasError: false,
    }).cursor).toBe('auto');
  });

  it('anchors a status dot in the corner, in the status colour', () => {
    render(
      <>
        <Avatar fallback="o" variant="status" status="online" dataTestId="o" />
        <Avatar fallback="b" variant="status" status="busy" dataTestId="b" />
      </>,
    );
    const badge = screen.getByTestId('o-badge');
    expect(badge).toContainElement(screen.getByTestId('o'));
    const dot = badge.lastElementChild as HTMLElement;
    expect(dot.style.width).toBe(`${Math.max(STATUS_DOT.min, AVATAR_SIZES.md.box * STATUS_DOT.scale)}px`);
    expect(dot.style.backgroundColor).toBe(paint(statusColor(theme, 'online')));
    expect(statusColor(theme, 'busy')).toBe(theme.palette.danger.main);
    expect(statusColor(theme, 'offline')).toBe(theme.palette.grey[500]);
  });

  it('draws no badge without a status', () => {
    render(<Avatar fallback="a" variant="status" dataTestId="a" />);
    expect(screen.queryAllByTestId('a-badge')).toHaveLength(0);
  });

  it('fades in and leaves the avatar visible', async () => {
    render(<Avatar fallback="a" dataTestId="a" />);
    const fade = screen.getByTestId('a').parentElement as HTMLElement;
    await waitFor(() => expect(parseFloat(fade.style.opacity)).toBeGreaterThan(0));
  });

  it('overlaps a group and counts the ones it does not show', () => {
    render(
      <AvatarGroup max={2} dataTestId="g">
        <Avatar fallback="A1" dataTestId="a1" />
        <Avatar fallback="A2" dataTestId="a2" />
        <Avatar fallback="A3" dataTestId="a3" />
        <Avatar fallback="A4" dataTestId="a4" />
      </AvatarGroup>,
    );
    expect(screen.getByTestId('a1')).toBeInTheDocument();
    expect(screen.getByTestId('a2')).toBeInTheDocument();
    expect(screen.queryAllByTestId('a3')).toHaveLength(0);
    expect(screen.getByTestId('g-overflow-fallback')).toHaveTextContent('+2');
    const second = screen.getByTestId('a2').parentElement?.parentElement as HTMLElement;
    expect(second.style.marginLeft).toBe(`-${GROUP_OVERLAP}px`);
  });

  it('honours both spellings of the avatar id and reads the provider theme', () => {
    const dark = createUiTheme({ mode: 'dark' });
    render(
      <UiProvider theme={dark}>
        <Avatar fallback="x" testID="t" />
      </UiProvider>,
    );
    expect(screen.getByTestId('t').style.backgroundColor).toBe(paint(dark.palette.primary.main));
    expect(screen.getByTestId('t-fallback')).toBeInTheDocument();
  });
});
