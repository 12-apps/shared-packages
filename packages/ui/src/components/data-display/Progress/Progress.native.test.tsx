import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { labelStyle, trackStyle } from './Progress.look.native';
import {
  CIRCULAR_VIEWBOX,
  PROGRESS_SIZES,
  circularCircumference,
  circularDashOffset,
  progressPalette,
} from './Progress.metrics';
import { Progress } from './Progress.native';
import { UiProvider } from '../../../provider/UiProvider.native';
import { alpha, hexToRgb } from '../../../tokens/color';
import { GREY, createUiTheme } from '../../../tokens/theme';

/**
 * Rendered through react-native-web, so `testID` is `data-testid`, `role`
 * reaches the DOM and the resolved style is what the browser would paint.
 * What is asserted is the NUMBERS — the same ones `Progress.styles.ts` reads.
 *
 * Plain style objects are written inline (`.style`); `borderRadius` reaches the
 * DOM as the four longhands.
 */
const theme = createUiTheme();

/** A hex from the palette, as the DOM normalises it in a resolved style. */
const paint = (color: string): string => (color.startsWith('#') ? hexToRgb(color) : color);

const circle = (testId: string): SVGCircleElement => {
  const element = screen.getByTestId(testId).querySelector('circle');
  if (!element) throw new Error(`no arc under ${testId}`);
  return element as unknown as SVGCircleElement;
};

describe('Progress (native)', () => {
  it('is a progressbar track under the default id, with the bar filled to the value', () => {
    render(<Progress value={40} />);
    const track = screen.getByTestId('progress-linear');
    expect(screen.getByTestId('progress')).toContainElement(track);
    expect(track).toHaveAttribute('role', 'progressbar');
    expect(track).toHaveAttribute('aria-valuenow', '40');
    expect(track).toHaveAttribute('aria-valuemin', '0');
    expect(track).toHaveAttribute('aria-valuemax', '100');

    const bar = track.firstElementChild as HTMLElement;
    expect(bar.style.width).toBe('40%');
    expect(bar.style.backgroundColor).toBe(paint(theme.palette.primary.main));
  });

  it('draws the track at the size\'s height, half-round, over a tenth of the hue', () => {
    render(
      <>
        <Progress value={10} size="xs" dataTestId="xs" />
        <Progress value={10} size="xl" dataTestId="xl" />
      </>,
    );
    const xs = screen.getByTestId('xs-linear').style;
    expect(xs.height).toBe(`${PROGRESS_SIZES.xs.height}px`);
    expect(xs.borderTopLeftRadius).toBe(`${PROGRESS_SIZES.xs.height / 2}px`);
    expect(xs.backgroundColor).toBe(alpha(theme.palette.primary.main, 0.1));
    expect(screen.getByTestId('xl-linear').style.height).toBe(`${PROGRESS_SIZES.xl.height}px`);
    expect(trackStyle(theme, 'md', 'primary')).toMatchObject({ height: 6, borderRadius: 3 });
  });

  it('puts a caller\'s data-testid on the element, not on the wrapper', () => {
    render(<Progress value={20} data-testid="named-bar" />);
    const track = screen.getByTestId('named-bar');
    expect(track).toHaveAttribute('role', 'progressbar');
    // The wrapper keeps the component's own id, as it does on the web.
    expect(screen.getByTestId('progress')).toContainElement(track);
  });

  it('shows the rounded percentage under the bar, a spacing unit down', () => {
    render(<Progress value={75.5} showLabel dataTestId="p" />);
    const label = screen.getByTestId('p-label');
    expect(label).toHaveTextContent('76%');
    // `mt: 1` is one 8px spacing unit on both renderers.
    expect(label.style.marginTop).toBe('8px');
    expect(label.style.fontWeight).toBe('600');
    expect(label.style.fontSize).toBe(`${PROGRESS_SIZES.md.fontSize}px`);
    expect(labelStyle(theme, 'md').lineHeight).toBeCloseTo(14 * 1.66);
  });

  it('prefers a caller\'s label and stays silent without showLabel', () => {
    render(
      <>
        <Progress value={30} showLabel label="Enviando" dataTestId="a" />
        <Progress value={30} dataTestId="b" />
      </>,
    );
    expect(screen.getByTestId('a-label')).toHaveTextContent('Enviando');
    expect(screen.queryAllByTestId('b-label')).toHaveLength(0);
  });

  it('reports no value while indeterminate and sweeps the bar instead', () => {
    render(<Progress dataTestId="i" />);
    const track = screen.getByTestId('i-linear');
    expect(track).toHaveAttribute('role', 'progressbar');
    expect(track).not.toHaveAttribute('aria-valuenow');
    const bar = track.firstElementChild as HTMLElement;
    expect(bar.style.position).toBe('absolute');
    expect(bar.style.width).toBe('35%');
  });

  it('clamps the bar to the track for values outside 0 to 100', () => {
    render(
      <>
        <Progress value={150} dataTestId="over" />
        <Progress value={-25} dataTestId="under" />
        <Progress value={NaN} dataTestId="nan" />
      </>,
    );
    const width = (id: string) =>
      (screen.getByTestId(`${id}-linear`).firstElementChild as HTMLElement).style.width;
    expect(width('over')).toBe('100%');
    expect(width('under')).toBe('0%');
    expect(width('nan')).toBe('0%');
  });

  it('draws the circular arc with MUI\'s dash arithmetic and rotation', () => {
    render(<Progress variant="circular" value={75} showLabel dataTestId="c" />);
    const dial = screen.getByTestId('c-circular');
    expect(dial.style.width).toBe(`${PROGRESS_SIZES.md.circularSize}px`);
    expect(dial).toHaveAttribute('aria-valuenow', '75');

    const svg = dial.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe(`22 22 ${CIRCULAR_VIEWBOX} ${CIRCULAR_VIEWBOX}`);
    const arc = circle('c-circular');
    expect(arc.getAttribute('r')).toBe('20');
    expect(arc.getAttribute('stroke')).toBe(theme.palette.primary.main);
    expect(Number(arc.getAttribute('stroke-dasharray'))).toBeCloseTo(circularCircumference(4));
    expect(Number(arc.getAttribute('stroke-dashoffset'))).toBeCloseTo(circularDashOffset(75, 4));
    // The dial's inner box is what carries MUI's `rotate(-90deg)`.
    expect((svg?.parentElement as HTMLElement).style.transform).toContain('-90deg');
    expect(screen.getByTestId('c-label')).toHaveTextContent('75%');
    expect(screen.getByTestId('c-label').style.color).toBe(theme.palette.text.secondary);
  });

  it('sizes the dial from the scale, or from an exact circularSize', () => {
    render(
      <>
        <Progress variant="circular" value={10} size="sm" dataTestId="s" />
        <Progress variant="circular" value={10} circularSize={90} thickness={6} dataTestId="n" />
      </>,
    );
    expect(screen.getByTestId('s-circular').style.height).toBe(
      `${PROGRESS_SIZES.sm.circularSize}px`,
    );
    expect(screen.getByTestId('n-circular').style.height).toBe('90px');
    expect(circle('n-circular').getAttribute('r')).toBe('19');
  });

  it('fills the asked-for share of the segments and names each one', () => {
    render(<Progress variant="segmented" segments={5} value={60} dataTestId="g" />);
    const container = screen.getByTestId('g-segments-container');
    expect(container.children).toHaveLength(5);
    expect(container.style.gap).toBe('4px');
    const fill = (index: number) => screen.getByTestId(`g-segment-${index}`).style.backgroundColor;
    expect(fill(0)).toBe(paint(theme.palette.primary.main));
    expect(fill(2)).toBe(paint(theme.palette.primary.main));
    expect(fill(3)).toBe(alpha(theme.palette.primary.main, 0.1));
    expect(fill(4)).toBe(alpha(theme.palette.primary.main, 0.1));
  });

  it('lets a segmented caller name the wrapper, as the web does', () => {
    render(<Progress variant="segmented" segments={3} value={100} data-testid="steps" />);
    expect(screen.getByTestId('steps')).toContainElement(
      screen.getByTestId('progress-segments-container'),
    );
  });

  it('glows with the web box-shadow and pulses by fading the bar', () => {
    render(
      <>
        <Progress value={50} glow dataTestId="glow" />
        <Progress value={50} pulse dataTestId="pulse" />
      </>,
    );
    const glowBar = screen.getByTestId('glow-linear').firstElementChild as HTMLElement;
    expect(glowBar.style.boxShadow).toBe(
      `0 0 10px 2px ${alpha(theme.palette.primary.main, 0.4)}`,
    );
    const pulseBar = screen.getByTestId('pulse-linear').firstElementChild as HTMLElement;
    expect(pulseBar.style.opacity).toBe('1');
  });

  it('paints neutral from the greys and danger from the error slot', () => {
    expect(progressPalette(theme, 'neutral')).toMatchObject({ main: GREY[500], dark: GREY[700] });
    expect(progressPalette(theme, 'danger')).toBe(theme.palette.danger);
    render(
      <>
        <Progress value={50} color="neutral" dataTestId="n" />
        <Progress value={50} color="danger" dataTestId="d" />
      </>,
    );
    const fill = (id: string) =>
      (screen.getByTestId(`${id}-linear`).firstElementChild as HTMLElement).style.backgroundColor;
    expect(fill('n')).toBe(paint(GREY[500]));
    expect(fill('d')).toBe(paint(theme.palette.danger.main));
  });

  /**
   * What `ThemeVariations`' "Status state colors" step asserts on the web. That
   * story is `native-skip`ped because it also reads a CSS `animation` off the
   * bar, which only the DOM renderer emits — the colours are not DOM-only, so
   * they are checked here instead of being lost with it.
   */
  it('fills the bar from every colour slot the house vocabulary names', () => {
    const colors = ['primary', 'secondary', 'success', 'warning', 'info', 'danger'] as const;
    render(
      <>
        {colors.map((color) => (
          <Progress key={color} value={50} color={color} dataTestId={color} />
        ))}
      </>,
    );
    for (const color of colors) {
      const fill = (screen.getByTestId(`${color}-linear`).firstElementChild as HTMLElement).style;
      expect(fill.backgroundColor, color).toBe(paint(theme.palette[color].main));
    }
  });

  it('takes the glass hairline and the gradient\'s first stop', () => {
    render(
      <>
        <Progress value={50} variant="glass" dataTestId="glass" />
        <Progress value={50} variant="gradient" dataTestId="grad" />
      </>,
    );
    const glass = (screen.getByTestId('glass-linear').firstElementChild as HTMLElement).style;
    expect(glass.backgroundColor).toBe(alpha(theme.palette.primary.main, 0.8));
    expect(glass.borderTopColor).toBe(alpha(theme.palette.primary.main, 0.3));
    const gradient = (screen.getByTestId('grad-linear').firstElementChild as HTMLElement).style;
    expect(gradient.backgroundColor).toBe(paint(theme.palette.primary.main));
  });

  it('falls back to the defaults for explicitly undefined props', () => {
    render(<Progress value={50} variant={undefined} size={undefined} color={undefined} dataTestId="u" />);
    expect(screen.getByTestId('u-linear').style.height).toBe(`${PROGRESS_SIZES.md.height}px`);
  });

  it('reads the provider theme and passes a View prop and a style through', () => {
    const dark = createUiTheme({ mode: 'dark' });
    render(
      <UiProvider theme={dark}>
        <Progress value={50} showLabel dataTestId="d" style={{ marginTop: 3 }} aria-label="upload" />
      </UiProvider>,
    );
    const bar = screen.getByTestId('d-linear').firstElementChild as HTMLElement;
    expect(bar.style.backgroundColor).toBe(paint(dark.palette.primary.main));
    expect(screen.getByTestId('d-label').style.color).toBe(paint(dark.palette.text.primary));
    expect(screen.getByTestId('d').style.marginTop).toBe('3px');
    expect(screen.getByTestId('d-linear')).toHaveAttribute('aria-label', 'upload');
  });
});
