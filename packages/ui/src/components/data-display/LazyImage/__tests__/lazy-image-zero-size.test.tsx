import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { LazyImage } from '../LazyImage';
import type { LazyImageProps } from '../LazyImage.types';
import { fieldHeight } from '../../../../tokens/field-height';

// FUT-2669: a size of `0` fell through `||` to a default on the container and
// the skeleton (`auto`, `100%`, and a dead `200` px height) while the image read
// it as `0rem`. Only an unset or empty size takes a default now.
const theme = createTheme();
const ZERO = theme.typography.pxToRem(0);
// FUT-2805: the skeleton's own unset-axis default, now that it is no longer
// the plain `'100%'`/`'auto'` this file used to characterize (see below).
const FIELD_HEIGHT = fieldHeight(theme);

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

  // FUT-2805: neither axis is set here (an empty width falls back to unset,
  // same as never passing it — see `emptyToUnset`), so the skeleton's OWN
  // default is no longer the plain `'100%'` this test used to characterize:
  // both dimensions now take the theme's field height (a square), which is
  // what fixes FUT-2774 #5's collapse-to-0 for the very same case. The
  // container itself is untouched (still `'auto'`) — no error/fallback state
  // is in play, so it still has real in-flow content (the skeleton) to size
  // itself from, same as before this ticket.
  it('falls back on an empty width as on an unset one', () => {
    renderImage({ width: '' });
    expect(styleOf('pic').width).toBe('auto');
    expect(styleOf('pic-skeleton').width).toBe(FIELD_HEIGHT);
    expect(styleOf('pic-skeleton').height).toBe(FIELD_HEIGHT);
  });

  it('keeps an unset width at auto on the container, and at the field height on the skeleton (FUT-2805)', () => {
    renderImage({});
    expect(styleOf('pic').width).toBe('auto');
    expect(styleOf('pic-skeleton').width).toBe(FIELD_HEIGHT);
    expect(styleOf('pic-skeleton').height).toBe(FIELD_HEIGHT);
  });

  // FUT-2805: `width` IS set here, so the skeleton's unset height now BORROWS
  // it (a square placeholder) rather than defaulting to the literal `'auto'`
  // this test used to characterize. The container and the real image are
  // untouched — `metrics`' own `height` default stays the literal `'auto'`
  // (FUT-2774 #4's `emptyToUnset`/`orDefault`), which is exactly what lets a
  // caller like `brand-link.tsx` size the real image naturally.
  it('borrows the width for an unset height on the skeleton; the container and image stay auto (FUT-2805)', () => {
    renderImage({ width: 100 });
    expect(styleOf('pic').height).toBe('auto');
    expect(styleOf('pic-skeleton').height).toBe(styleOf('pic-skeleton').width);
    expect(styleOf('pic-skeleton').height).not.toBe('auto');
    expect(styleOf('pic-img').height).toBe('auto');
  });

  it('falls back on an empty height the same way as an unset one, for the skeleton (FUT-2805)', () => {
    renderImage({ width: 100, height: '' });
    expect(styleOf('pic').height).toBe('auto');
    expect(styleOf('pic-skeleton').height).toBe(styleOf('pic-skeleton').width);
    expect(styleOf('pic-skeleton').height).not.toBe('auto');
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
