import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { Skeleton, dimension, skeletonBoxStyle, skeletonTint, textBoxHeight } from './Skeleton.native';
import {
  GLASS_BORDER_ALPHA,
  SHIMMER_ALPHA,
  SKELETON_DEFAULT_DIMENSIONS,
  SKELETON_INTENSITY_OPACITY,
  TEXT_LINE_HEIGHT_EM,
  TEXT_SCALE_Y,
} from './Skeleton.metrics';
import { UiProvider } from '../../../provider/UiProvider.native';
import { alpha } from '../../../tokens/color';
import { createUiTheme } from '../../../tokens/theme';

/**
 * Rendered through react-native-web, so `testID` is `data-testid` and the
 * resolved style is what the browser would paint. What is asserted is the
 * NUMBERS — the same ones `Skeleton.styles.ts` reads — not a snapshot.
 *
 * Plain style objects are written inline (`.style`); `StyleSheet.create` styles
 * become classes and are read through `toHaveStyle`. `borderRadius` reaches the
 * DOM as the four longhands.
 */
const theme = createUiTheme();

/** The 1.2em line box MUI squashes to 60%, at the default 16px body size. */
const TEXT_HEIGHT = 16 * TEXT_LINE_HEIGHT_EM * TEXT_SCALE_Y;

describe('Skeleton (native)', () => {
  it('draws the text variant full width, one squashed line tall, at the theme radius', () => {
    render(<Skeleton dataTestId="s" />);
    const box = screen.getByTestId('s');
    expect(box).toHaveAttribute('aria-hidden', 'true');
    expect(box.style.width).toBe('100%');
    expect(box.style.height).toBe(`${TEXT_HEIGHT}px`);
    expect(box.style.borderTopLeftRadius).toBe(`${theme.radius.md}px`);
    expect(box.style.backgroundColor).toBe('rgba(0, 0, 0, 0.13)');
  });

  it('tints itself with the web intensity alphas over the body ink', () => {
    expect(skeletonTint(theme, 'low')).toBe(`rgba(0, 0, 0, ${SKELETON_INTENSITY_OPACITY.low})`);
    expect(skeletonTint(theme, 'medium')).toBe('rgba(0, 0, 0, 0.13)');
    expect(skeletonTint(theme, 'high')).toBe(`rgba(0, 0, 0, ${SKELETON_INTENSITY_OPACITY.high})`);
    render(
      <>
        <Skeleton dataTestId="low" intensity="low" />
        <Skeleton dataTestId="high" intensity="high" />
      </>,
    );
    expect(screen.getByTestId('low').style.backgroundColor).toBe('rgba(0, 0, 0, 0.11)');
    expect(screen.getByTestId('high').style.backgroundColor).toBe('rgba(0, 0, 0, 0.15)');
  });

  it('gives each variant the web default box and radius', () => {
    render(
      <>
        <Skeleton dataTestId="circular" variant="circular" />
        <Skeleton dataTestId="rectangular" variant="rectangular" />
        <Skeleton dataTestId="wave" variant="wave" />
      </>,
    );
    const circular = screen.getByTestId('circular').style;
    expect(circular.width).toBe(`${SKELETON_DEFAULT_DIMENSIONS.circular.width}px`);
    expect(circular.height).toBe('40px');
    expect(circular.borderTopLeftRadius).toBe(`${theme.radius.full}px`);

    for (const id of ['rectangular', 'wave']) {
      const style = screen.getByTestId(id).style;
      expect(style.width).toBe('100%');
      expect(style.height).toBe('40px');
      expect(style.borderTopLeftRadius).toBe('0px');
    }
  });

  it('lets width, height and borderRadius win over the variant defaults', () => {
    render(<Skeleton dataTestId="s" variant="rectangular" width={500} height={300} borderRadius={16} />);
    const style = screen.getByTestId('s').style;
    expect(style.width).toBe('500px');
    expect(style.height).toBe('300px');
    expect(style.borderTopLeftRadius).toBe('16px');
    expect(style.borderBottomRightRadius).toBe('16px');
  });

  it('squashes an explicit text height the way MUI\'s scale(1, 0.6) does', () => {
    expect(textBoxHeight(theme, undefined)).toBe(TEXT_HEIGHT);
    expect(textBoxHeight(theme, 40)).toBe(40 * TEXT_SCALE_Y);
    expect(textBoxHeight(theme, '80%')).toBe('80%');
    render(<Skeleton dataTestId="s" variant="text" height={40} width="60%" />);
    const style = screen.getByTestId('s').style;
    expect(style.height).toBe('24px');
    expect(style.width).toBe('60%');
  });

  it('takes numbers and percentages as dimensions and nothing else', () => {
    expect(dimension(24)).toBe(24);
    expect(dimension('50%')).toBe('50%');
    expect(dimension(undefined)).toBeUndefined();
    expect(dimension('10rem')).toBeUndefined();
  });

  it('renders nothing at all for a count of zero', () => {
    const { container } = render(<Skeleton dataTestId="s" count={0} />);
    expect(screen.queryAllByTestId('s')).toHaveLength(0);
    expect(container).toBeEmptyDOMElement();
  });

  it('stacks several instances a spacing unit apart and numbers their ids', () => {
    render(<Skeleton dataTestId="m" count={3} spacing={2} />);
    const boxes = [0, 1, 2].map((index) => screen.getByTestId(`m-${index}`));
    expect(screen.queryAllByTestId('m')).toHaveLength(0);
    expect(boxes).toHaveLength(3);
    const stack = boxes[0]?.parentElement?.parentElement as HTMLElement;
    // `spacing={2}` is two 8px units on both renderers.
    expect(stack.style.gap).toBe('16px');
    for (const box of boxes) {
      expect(box.style.width).toBe('100%');
      expect(box).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('leaves the instances unnamed when the caller named nothing', () => {
    render(<Skeleton count={2} />);
    expect(screen.queryAllByTestId(/-\d+$/)).toHaveLength(0);
  });

  it('honours all three spellings of the test id', () => {
    render(
      <>
        <Skeleton testID="a" />
        <Skeleton dataTestId="b" />
        <Skeleton data-testid="c" />
      </>,
    );
    for (const id of ['a', 'b', 'c']) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it('washes and clips a wave, and leaves a still skeleton bare', () => {
    // react-native-web writes `overflow` as its two longhands.
    render(
      <>
        <Skeleton dataTestId="w" variant="wave" />
        <Skeleton dataTestId="still" animation={false} />
      </>,
    );
    const wash = screen.getByTestId('w-wash');
    expect(wash).toHaveStyle({ backgroundColor: theme.palette.action.hover });
    // The wash sits inside a box that is already `aria-hidden`, so it needs none.
    expect(wash).not.toHaveAttribute('aria-hidden');
    expect(screen.getByTestId('w').style.overflowX).toBe('hidden');
    expect(screen.queryAllByTestId('still-wash')).toHaveLength(0);
    expect(screen.getByTestId('still').style.overflowX).toBe('');
  });

  it('washes a shimmer in white and prefers it to the wave, as the web sx does', () => {
    render(<Skeleton dataTestId="s" variant="wave" shimmer />);
    const wash = screen.getByTestId('s-wash');
    expect(wash).toHaveStyle({ backgroundColor: alpha('#fff', SHIMMER_ALPHA) });
    expect(screen.queryAllByTestId('s-wash')).toHaveLength(1);
    expect(screen.getByTestId('s').style.overflowX).toBe('hidden');
  });

  it('paints glassmorphism as the gradient first stop inside a divider hairline', () => {
    render(<Skeleton dataTestId="g" variant="rectangular" glassmorphism />);
    const style = screen.getByTestId('g').style;
    expect(style.backgroundColor).toBe(alpha(theme.palette.background.paper, 0.8));
    expect(style.borderTopWidth).toBe('1px');
    expect(style.borderTopColor).toBe(alpha(theme.palette.divider, GLASS_BORDER_ALPHA));
    expect(skeletonBoxStyle(theme, {
      variant: 'rectangular',
      intensity: 'medium',
      glassmorphism: true,
      clipped: false,
    })).toMatchObject({ boxShadow: `0 8px 32px 0 ${alpha('#000', 0.1)}` });
  });

  it('reads the provider theme', () => {
    const dark = createUiTheme({ mode: 'dark' });
    render(
      <UiProvider theme={dark}>
        <Skeleton dataTestId="d" />
      </UiProvider>,
    );
    expect(skeletonTint(dark, 'medium')).toBe('rgba(255, 255, 255, 0.13)');
    expect(screen.getByTestId('d').style.backgroundColor).toBe('rgba(255, 255, 255, 0.13)');
  });

  it('falls back to the defaults for explicitly undefined props', () => {
    render(
      <Skeleton
        dataTestId="u"
        variant={undefined}
        animation={undefined}
        count={undefined}
        intensity={undefined}
      />,
    );
    const style = screen.getByTestId('u').style;
    expect(style.height).toBe(`${TEXT_HEIGHT}px`);
    expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0.13)');
  });

  it('passes a View prop and a style through to the box', () => {
    render(<Skeleton dataTestId="v" style={{ marginTop: 3 }} aria-label="carregando" />);
    const box = screen.getByTestId('v');
    expect(box.style.marginTop).toBe('3px');
    expect(box).toHaveAttribute('aria-label', 'carregando');
  });
});
