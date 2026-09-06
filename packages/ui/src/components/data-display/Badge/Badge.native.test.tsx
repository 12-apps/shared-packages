import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { badgeBoxStyle, badgeTextStyle } from './Badge.look.native';
import { BADGE_SIZES, badgeAnchor, badgePalette } from './Badge.metrics';
import { Badge } from './Badge.native';
import { UiProvider } from '../../../provider/UiProvider.native';
import { alpha, hexToRgb } from '../../../tokens/color';
import { createUiTheme } from '../../../tokens/theme';

/**
 * Rendered through react-native-web, so `testID` is `data-testid` and the
 * resolved style is what the browser would paint. What is asserted is the
 * NUMBERS — the same ones `Badge.styles.ts` and `Badge.variants.ts` read.
 */
const theme = createUiTheme();

/** A hex from the palette, as the DOM normalises it in a resolved style. */
const paint = (color: string): string => (color.startsWith('#') ? hexToRgb(color) : color);

/** The chip, on either renderer: MUI's badge span and the native box share this id. */
const chip = (id = 'badge'): HTMLElement => screen.getByTestId(`${id}-content-wrapper`);

describe('Badge (native)', () => {
  /*
   * On `pulse`, and why nothing below asserts it.
   *
   * `AnimationTest` is the only story that turns `pulse` on, and it is
   * `native-skip`ped because it reads a CSS `animation-duration` off the chip.
   * The motion cannot be asserted here either: react-native-web writes
   * `opacity: 1; transform: scale(1)` on EVERY `Animated.View`, pulsing or
   * not, so there is no discriminator at rest — and the loop runs on
   * `requestAnimationFrame`, which this runner's fake timers do not advance.
   * Any assertion would be vacuous or flaky.
   *
   * What the story guarded against — the two renderers drifting apart — cannot
   * happen: `Badge.animations.ts` interpolates `PULSE.scale` and
   * `PULSE.opacity` at its 70% keyframe stop, and `usePulseStyle` interpolates
   * the same two constants at the same 0.7 input, out of the same table.
   */
  it('anchors a 20px chip off the top-right of what it is attached to', () => {
    render(
      <Badge badgeContent={5}>
        <span data-testid="child">x</span>
      </Badge>,
    );
    expect(screen.getByTestId('badge')).toContainElement(screen.getByTestId('child'));
    const anchor = (chip().parentElement as HTMLElement).style;
    expect(anchor.position).toBe('absolute');
    expect(anchor.top).toBe('0px');
    expect(anchor.right).toBe('0px');
    expect(anchor.transform).toContain('50%');
    const box = chip().style;
    expect(box.minWidth).toBe(`${BADGE_SIZES.md.minWidth}px`);
    expect(box.height).toBe(`${BADGE_SIZES.md.height}px`);
    expect(box.borderTopLeftRadius).toBe(`${BADGE_SIZES.md.height / 2}px`);
    expect(screen.getByTestId('badge-content')).toHaveTextContent('5');
  });

  it('moves to whichever corner it was asked for', () => {
    render(
      <>
        <Badge badgeContent={1} position="bottom-left" dataTestId="bl" />
        <Badge badgeContent={1} position="top-left" dataTestId="tl" />
      </>,
    );
    const bl = (chip('bl').parentElement as HTMLElement).style;
    expect(bl.bottom).toBe('0px');
    expect(bl.left).toBe('0px');
    expect((chip('tl').parentElement as HTMLElement).style.top).toBe('0px');
    expect(badgeAnchor('bottom-right')).toEqual({ vertical: 'bottom', horizontal: 'right' });
  });

  it('draws the five chips and their type steps', () => {
    render(
      <>
        <Badge badgeContent={2} size="xs" dataTestId="xs" />
        <Badge badgeContent={2} size="xl" dataTestId="xl" />
      </>,
    );
    expect(chip('xs').style.height).toBe(`${BADGE_SIZES.xs.height}px`);
    expect(chip('xs').style.paddingLeft).toBe(`${BADGE_SIZES.xs.paddingHorizontal}px`);
    expect(chip('xl').style.height).toBe(`${BADGE_SIZES.xl.height}px`);
    const text = screen.getByTestId('xs-content').firstElementChild as HTMLElement;
    expect(text.style.fontSize).toBe(`${BADGE_SIZES.xs.fontSize}px`);
    expect(text.style.fontWeight).toBe('600');
  });

  it('shrinks to a bare dot for the dot variant', () => {
    render(
      <Badge variant="dot" color="success" dataTestId="d">
        <span data-testid="child">x</span>
      </Badge>,
    );
    const dot = chip('d').style;
    expect(dot.width).toBe(`${BADGE_SIZES.md.dotSize}px`);
    expect(dot.height).toBe(`${BADGE_SIZES.md.dotSize}px`);
    expect(dot.backgroundColor).toBe(paint(theme.palette.success.main));
    expect(screen.queryAllByTestId('d-content')).toHaveLength(0);
  });

  it('paints each variant the way the web does', () => {
    render(
      <>
        <Badge badgeContent="a" variant="outline" dataTestId="o" />
        <Badge badgeContent="b" variant="secondary" dataTestId="s" />
        <Badge badgeContent="c" variant="destructive" dataTestId="x" />
        <Badge badgeContent="d" variant="glass" dataTestId="g" />
      </>,
    );
    const main = theme.palette.primary.main;
    expect(chip('o').style.borderTopColor).toBe(paint(main));
    expect(chip('o').style.borderTopWidth).toBe('2px');
    expect(chip('s').style.backgroundColor).toBe(alpha(main, 0.15));
    expect(chip('x').style.backgroundColor).toBe(paint(theme.palette.danger.main));
    expect(chip('g').style.backgroundColor).toBe(alpha(main, 0.1));
    const destructive = screen.getByTestId('x-content').firstElementChild as HTMLElement;
    expect(destructive.style.fontWeight).toBe('700');
    const glass = screen.getByTestId('g-content').firstElementChild as HTMLElement;
    expect(glass.style.textTransform).toBe('uppercase');
  });

  it('paints neutral from the greys and danger from the error slot', () => {
    expect(badgePalette(theme, 'neutral').main).toBe(theme.palette.grey[600]);
    expect(badgePalette(theme, 'danger')).toBe(theme.palette.danger);
    render(<Badge badgeContent="n" color="neutral" dataTestId="n" />);
    expect(chip('n').style.backgroundColor).toBe(paint(theme.palette.grey[600]));
  });

  it('caps a count at max and hides a zero unless asked', () => {
    render(
      <>
        <Badge variant="count" badgeContent={150} max={99} dataTestId="over" />
        <Badge variant="count" badgeContent={0} dataTestId="zero" />
        <Badge variant="count" badgeContent={0} showZero dataTestId="shown" />
      </>,
    );
    expect(screen.getByTestId('over-content')).toHaveTextContent('99+');
    expect(screen.queryAllByTestId('zero-content-wrapper')).toHaveLength(0);
    expect(screen.getByTestId('shown-content')).toHaveTextContent('0');
  });

  it('hides itself when told to be invisible', () => {
    render(<Badge badgeContent={3} invisible dataTestId="i" />);
    expect(screen.queryAllByTestId('i-content-wrapper')).toHaveLength(0);
    expect(screen.getByTestId('i')).toBeInTheDocument();
  });

  it('prefers `content` to MUI\'s `badgeContent`', () => {
    render(<Badge content="NEW" badgeContent="OLD" dataTestId="c" />);
    expect(screen.getByTestId('c-content')).toHaveTextContent('NEW');
  });

  it('carries the live region MUI puts on the chip', () => {
    render(<Badge badgeContent="Alert" aria-label="Error alert" aria-live="assertive" dataTestId="a" />);
    const box = chip('a');
    expect(box).toHaveAttribute('aria-label', 'Error alert');
    expect(box).toHaveAttribute('aria-live', 'assertive');
    expect(box).toHaveAttribute('aria-atomic', 'true');
  });

  it('shows a leading icon and a close button in their own slots', async () => {
    const onClose = vi.fn();
    render(
      <Badge
        badgeContent="Close Me"
        closable
        onClose={onClose}
        icon={<span data-testid="glyph">*</span>}
        dataTestId="b"
      />,
    );
    expect(screen.getByTestId('b-icon')).toContainElement(screen.getByTestId('glyph'));
    const close = screen.getByTestId('b-close');
    expect(close).toHaveAttribute('role', 'button');
    expect(close.querySelector('svg')?.getAttribute('width')).toBe(
      `${BADGE_SIZES.md.closeIconSize}`,
    );
    fireEvent.click(close);
    // MUI lets its `Zoom` finish before telling the caller.
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('has no close button until it is closable', () => {
    render(<Badge badgeContent="x" onClose={() => undefined} dataTestId="b" />);
    expect(screen.queryAllByTestId('b-close')).toHaveLength(0);
  });

  it('glows with the web box-shadow', () => {
    render(<Badge badgeContent="g" glow dataTestId="g" />);
    expect(chip('g').style.boxShadow).toBe(
      `0 0 15px 3px ${alpha(theme.palette.primary.main, 0.5)}`,
    );
  });

  it('rings the chip in the paper colour and tracks its type', () => {
    expect(badgeBoxStyle(theme, { variant: 'default', size: 'md', color: 'primary', glow: false })).toMatchObject(
      { borderWidth: 2, borderColor: theme.palette.background.paper },
    );
    expect(badgeTextStyle(theme, 'default', 'md', 'primary').letterSpacing).toBeCloseTo(12 * 0.025);
  });

  it('honours both spellings of the badge id and reads the provider theme', () => {
    const dark = createUiTheme({ mode: 'dark' });
    render(
      <UiProvider theme={dark}>
        <Badge badgeContent="x" testID="t" />
      </UiProvider>,
    );
    expect(chip('t').style.backgroundColor).toBe(paint(dark.palette.primary.main));
    expect(chip('t').style.borderTopColor).toBe(paint(dark.palette.background.paper));
  });
});
