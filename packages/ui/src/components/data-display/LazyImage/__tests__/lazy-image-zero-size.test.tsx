import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { LazyImage } from '../LazyImage';
import type { LazyImageProps } from '../LazyImage.types';

// FUT-2669: a size of `0` fell through `||` to a default on the container and
// the skeleton (`auto`, `100%`, and a dead `200` px height) while the image read
// it as `0rem`. Only an unset or empty size takes a default now.
const theme = createTheme();
const ZERO = theme.typography.pxToRem(0);

function renderImage(props: Partial<LazyImageProps>) {
  return render(
    <ThemeProvider theme={theme}>
      <LazyImage src="/photo.png" alt="Foto" lazy={false} data-testid="pic" {...props} />
    </ThemeProvider>,
  );
}

const styleOf = (testId: string) => globalThis.getComputedStyle(screen.getByTestId(testId));

describe('LazyImage zero and empty sizes (FUT-2669)', () => {
  it('reads a width of 0 as 0 on the container, the skeleton and the image', () => {
    renderImage({ width: 0 });
    expect(styleOf('pic').width).toBe(ZERO);
    expect(styleOf('pic-skeleton').width).toBe(ZERO);
    expect(styleOf('pic-img').width).toBe(ZERO);
  });

  it('reads a height of 0 as 0 on the container, the skeleton and the image', () => {
    renderImage({ width: 100, height: 0 });
    expect(styleOf('pic').height).toBe(ZERO);
    expect(styleOf('pic-skeleton').height).toBe(ZERO);
    expect(styleOf('pic-img').height).toBe(ZERO);
  });

  it('falls back on an empty width as on an unset one', () => {
    renderImage({ width: '' });
    expect(styleOf('pic').width).toBe('auto');
    expect(styleOf('pic-skeleton').width).toBe('100%');
  });

  it('keeps an unset width at auto on the container and 100% on the skeleton', () => {
    renderImage({});
    expect(styleOf('pic').width).toBe('auto');
    expect(styleOf('pic-skeleton').width).toBe('100%');
  });

  it('keeps an unset height at auto on all three', () => {
    renderImage({ width: 100 });
    expect(styleOf('pic').height).toBe('auto');
    expect(styleOf('pic-skeleton').height).toBe('auto');
    expect(styleOf('pic-img').height).toBe('auto');
  });

  it('falls back on an empty height to auto on all three', () => {
    renderImage({ width: 100, height: '' });
    expect(styleOf('pic').height).toBe('auto');
    expect(styleOf('pic-skeleton').height).toBe('auto');
    expect(styleOf('pic-img').height).toBe('auto');
  });

  // FUT-2774 #4: `metrics` (the real `<img>`) and `ErrorFallback`'s ReactNode
  // branch read width/height unguarded — an explicit empty string reached
  // `sx` as `''`, which reads as `0%` (this same FUT-2669 bug, missed on two
  // more elements). `emptyToUnset` normalizes it to "as if unset" instead.
  it('treats an empty width on the image as unset (no explicit style width), not 0%', () => {
    renderImage({ width: '' });
    expect(styleOf('pic-img').width).toBe('');
  });

  it('treats an empty height on the image as auto, not 0%', () => {
    renderImage({ width: 100, height: '' });
    expect(styleOf('pic-img').height).toBe('auto');
  });

  it('treats an empty width on a ReactNode fallback as unset, not 0%', () => {
    renderImage({ width: '', fallback: <span>sem foto</span> });
    fireEvent.error(screen.getByTestId('pic-img'));
    // `sx.width` is omitted (as it would be if `width` were never passed at
    // all), so `FallbackContainer`'s OWN base CSS (`width: '100%'`, filling
    // its absolutely-positioned parent) governs — not `''`, which `sx` would
    // have read as `0%`.
    expect(styleOf('pic-fallback').width).toBe('100%');
  });

  it('treats an empty height on a ReactNode fallback as auto, not 0%', () => {
    renderImage({ width: 100, height: '', fallback: <span>sem foto</span> });
    fireEvent.error(screen.getByTestId('pic-img'));
    expect(styleOf('pic-fallback').height).toBe('auto');
  });
});
