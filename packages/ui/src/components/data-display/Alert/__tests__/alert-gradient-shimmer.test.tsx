/**
 * THE GRADIENT ALERT'S SHIMMER CROSSES THE ALERT, AT ANY WIDTH (FUT-4874).
 *
 * The `::before` used to start at `left: -1000px` and travel a fixed 1000px of
 * `background-position`, so it never reached an alert narrower than about
 * 1000px and left a hard vertical edge across a 1280px one. Its travel is now
 * the alert's own width: it sits at `left: 0`, is as wide as the alert, and is
 * translated from -100% to 100% of ITSELF, which is the alert's width whatever
 * that is. Nothing in its geometry is a length.
 *
 * jsdom lays nothing out, so this holds the geometry as what the sheet emits;
 * the browser pass (the sweep across 390 and 1280 at four frames, no seam,
 * words above it) is in the delivery report.
 */
import { describe, expect, it } from 'vitest';

import { createTheme } from '../../../../mui/styles';
import { muiThemeOptionsFrom } from '../../../../provider/mui-bridge';
import { sheen } from '../../../../tokens/ink';
import { createUiTheme } from '../../../../tokens/theme';
import { GRADIENT, seconds } from '../Alert.metrics';
import { alertVariantStyles, getColorFromTheme, shimmerAnimation } from '../Alert.styles';

const MODES = ['light', 'dark'] as const;

describe.each(MODES)('the gradient alert shimmer in %s mode', (mode) => {
  const theme = createTheme(muiThemeOptionsFrom(createUiTheme({ mode })));
  const root = alertVariantStyles(theme, 'gradient', getColorFromTheme(theme, 'info')) as Record<string, unknown>;
  const shimmer = root['&::before'] as Record<string, unknown>;

  it('is as wide as the alert and starts at its left edge, with no length in its geometry', () => {
    expect(shimmer.left).toBe(0);
    expect(shimmer.width).toBe('100%');
    expect(shimmer.top).toBe(0);
    expect(shimmer.height).toBe('100%');
    expect(JSON.stringify([shimmer.left, shimmer.width])).not.toMatch(/px|rem|em\b/u);
    expect(GRADIENT).not.toHaveProperty('shimmerTravel');
  });

  it('travels from one of its own widths to the left to one to the right', () => {
    const frames = shimmerAnimation().styles;
    expect(frames).toMatch(/0%\s*\{\s*transform:\s*translateX\(-100%\);?\s*\}/u);
    expect(frames).toMatch(/100%\s*\{\s*transform:\s*translateX\(100%\);?\s*\}/u);
    expect(frames).not.toMatch(/px|background-position/u);
  });

  it('keeps the period, the alpha and the band: transparent at both ends, so no seam', () => {
    expect(String(shimmer.animation)).toContain(` ${seconds(GRADIENT.shimmerMs)} infinite`);
    expect(String(shimmer.animation)).toContain(shimmerAnimation().name);
    expect(shimmer.background).toBe(
      `linear-gradient(90deg, transparent, ${sheen(theme, GRADIENT.shimmerAlpha)}, transparent)`,
    );
    expect(GRADIENT.shimmerAlpha).toBe(0.2);
    expect(GRADIENT.shimmerMs).toBe(3000);
  });

  it('stays behind the words (FUT-4516) and is off under prefers-reduced-motion', () => {
    expect(root.isolation).toBe('isolate');
    expect(shimmer.zIndex).toBe(-1);
    expect(shimmer['@media (prefers-reduced-motion: reduce)']).toEqual({ display: 'none' });
  });
});
