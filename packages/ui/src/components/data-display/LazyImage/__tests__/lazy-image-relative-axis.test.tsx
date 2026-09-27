import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { LazyImage } from '../LazyImage';
import type { LazyImageProps } from '../LazyImage.types';

// FUT-2805 follow-up (adversarial review of 1b0425ef): `placeholderAxis`
// borrowed a RELATIVE set axis (a fraction in (0,1], or a `%` string) onto
// the unset one literally — `width="100%"` alone produced a skeleton with
// `height: 100%` too. A percentage height against an auto-height containing
// block computes to `auto` per CSS (10.5) — the SAME collapse this ticket
// exists to fix, unfixed for this input shape. `width={0.5}` alone is the
// same bug through the numeric-fraction path (`isFraction`). The
// ReactNode-fallback CONTAINER (`ImageContainer` itself, not just the
// fallback's own inner box) has the identical problem, since it is what
// `placeholderAxis` sizes there (see `containerAxisFor`).
//
// The fix: a RELATIVE single axis keeps its own value and squares up through
// `aspectRatio: '1 / 1'` instead of an emitted percentage on the other axis
// (verified empirically in real Chromium against a minimal repro — a
// percentage on the OTHER axis re-collapses regardless of which axis it is,
// contrary to a plausible-sounding "borrowing height as width is harmless"
// intuition: shrink-to-fit width treats an unresolvable percentage child
// exactly like auto-height does).
const theme = createTheme();

function renderImage(props: Partial<LazyImageProps>) {
  return render(
    <ThemeProvider theme={theme}>
      <LazyImage src="/photo.png" alt="Foto" lazy={false} data-testid="pic" {...props} />
    </ThemeProvider>,
  );
}

const styleOf = (testId: string) => globalThis.getComputedStyle(screen.getByTestId(testId));

describe('LazyImage relative single-axis placeholder sizing (FUT-2805 follow-up)', () => {
  it('squares a percentage-string width via aspectRatio, not a percentage height, on the skeleton', () => {
    renderImage({ width: '100%' });
    const skeleton = styleOf('pic-skeleton');
    expect(skeleton.width).toBe('100%');
    expect(skeleton.height).toBe('auto');
    expect(skeleton.aspectRatio).toBe('1/1');
  });

  it('squares a numeric fraction width via aspectRatio, not a percentage height, on the skeleton', () => {
    renderImage({ width: 0.5 });
    const skeleton = styleOf('pic-skeleton');
    expect(skeleton.width).toBe('100%');
    expect(skeleton.height).toBe('auto');
    expect(skeleton.aspectRatio).toBe('1/1');
  });

  it('squares a percentage-string height via aspectRatio, not a percentage width, on the skeleton', () => {
    renderImage({ height: '50%' });
    const skeleton = styleOf('pic-skeleton');
    expect(skeleton.height).toBe('50%');
    expect(skeleton.width).toBe('auto');
    expect(skeleton.aspectRatio).toBe('1/1');
  });

  it('squares a numeric fraction height via aspectRatio, not a percentage width, on the skeleton', () => {
    renderImage({ height: 0.5 });
    const skeleton = styleOf('pic-skeleton');
    expect(skeleton.height).toBe('100%');
    expect(skeleton.width).toBe('auto');
    expect(skeleton.aspectRatio).toBe('1/1');
  });

  // The ReactNode-fallback CONTAINER's own box, not just the fallback's
  // content — `ImageContainer` is what `containerAxisFor` sizes here, and it
  // is the one thing that can fix its own collapse (see its doc comment).
  it('squares the ReactNode-fallback CONTAINER itself for a relative width-only caller', () => {
    renderImage({ width: '100%', fallback: <span>sem foto</span> });
    fireEvent.error(screen.getByTestId('pic-img'));
    const container = styleOf('pic');
    expect(container.width).toBe('100%');
    expect(container.height).toBe('auto');
    expect(container.aspectRatio).toBe('1/1');
  });

  it('squares the ReactNode-fallback CONTAINER itself for a relative height-only caller', () => {
    renderImage({ height: 0.5, fallback: <span>sem foto</span> });
    fireEvent.error(screen.getByTestId('pic-img'));
    const container = styleOf('pic');
    // The CONTAINER resolves through `sxLength` (a fraction is a percentage
    // OF ITS OWN PARENT), unlike the skeleton's `innerLength` (a fraction
    // always fills its container, `'100%'`) — `0.5` here is `'50%'`.
    expect(container.height).toBe('50%');
    expect(container.width).toBe('auto');
    expect(container.aspectRatio).toBe('1/1');
  });

  // Both axes set stays exactly as today, even when one of them is relative:
  // this is a caller decision, not something to "fix".
  it('leaves a relative width alone when height is ALSO set (no aspectRatio)', () => {
    renderImage({ width: '100%', height: 200 });
    const skeleton = styleOf('pic-skeleton');
    expect(skeleton.width).toBe('100%');
    expect(skeleton.height).toBe('12.5rem');
    expect(skeleton.aspectRatio).toBe('');
  });
});
