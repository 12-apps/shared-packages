import { ThemeProvider, createTheme } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { FleetMap } from '../FleetMap';
import { FLEET, FLEET_COPY } from '../FleetMap.fixtures';

/**
 * What a HOST's own theme does to this component.
 *
 * The package is re-themed by every consumer, so a value that happens to look
 * right on the default theme is not evidence of anything. This is the assertion
 * that would have caught it: `sx` reads a numeric `borderRadius` as a MULTIPLE
 * of `theme.shape.borderRadius`, so writing `theme.shape.borderRadius / 4`
 * divided the theme value out and let `sx` multiply it back in — 4px on the
 * default theme, 36px on a host at 12.
 */
function radiusAt(shapeRadius: number): string {
  const { unmount } = render(
    <ThemeProvider theme={createTheme({ shape: { borderRadius: shapeRadius } })}>
      <FleetMap units={FLEET} copy={FLEET_COPY} dataTestId={`fleet-${shapeRadius}`} />
    </ThemeProvider>,
  );
  const radius = getComputedStyle(screen.getByTestId(`fleet-${shapeRadius}-ana`)).borderRadius;
  unmount();
  return radius;
}

/** The same reading, for the bars that stand in before any unit lands. */
function skeletonRadiusAt(shapeRadius: number): string {
  const { unmount } = render(
    <ThemeProvider theme={createTheme({ shape: { borderRadius: shapeRadius } })}>
      <FleetMap units={[]} copy={FLEET_COPY} loading dataTestId={`load-${shapeRadius}`} />
    </ThemeProvider>,
  );
  const bar = screen.getByTestId(`load-${shapeRadius}-skeleton`).firstElementChild;
  const radius = getComputedStyle(bar as Element).borderRadius;
  unmount();
  return radius;
}

describe('a roster row under a host theme', () => {
  it('scales with the theme radius rather than squaring it', () => {
    // One step of the theme's own scale, whatever the host set it to.
    expect(radiusAt(4)).toBe('4px');
    expect(radiusAt(12)).toBe('12px');
  });

  it('is matched by the first-load skeleton standing in for it', () => {
    // `Skeleton` forwards its `borderRadius` into `sx` as well, so a literal
    // number there is the same trap one layer down: `4` drew 16px against the
    // rows' 4px, and 48px against 12px. Asserted rather than assumed, because
    // reverting only the skeleton left every other test in this suite green.
    expect(skeletonRadiusAt(4)).toBe('4px');
    expect(skeletonRadiusAt(12)).toBe('12px');
  });
});
