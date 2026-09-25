import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { LazyImage } from '../LazyImage';

// FUT-2656: `borderRadius` is documented as px. The image drew it that way,
// but the clipping container, the skeleton and the node fallback handed the
// number to MUI's `sx`, which multiplies it by `shape.borderRadius` (4) — so
// `borderRadius={8}` clipped the image to 32px corners, a circle on a thumb.
const theme = createTheme();

function renderImage(fallback?: React.ReactNode) {
  return render(
    <ThemeProvider theme={theme}>
      <LazyImage
        src="/photo.png"
        alt="Foto"
        width={56}
        height={56}
        borderRadius={8}
        lazy={false}
        fallback={fallback}
        data-testid="thumb"
      />
    </ThemeProvider>,
  );
}

const radiusOf = (testId: string) => globalThis.getComputedStyle(screen.getByTestId(testId)).borderRadius;

describe('LazyImage borderRadius (FUT-2656)', () => {
  it('rounds the clipping container exactly as much as the image', () => {
    renderImage();
    const imageRadius = radiusOf('thumb-img');
    expect(imageRadius).toBe('0.5rem');
    expect(radiusOf('thumb')).toBe(imageRadius);
  });

  it('rounds the loading skeleton exactly as much as the image', () => {
    renderImage();
    expect(radiusOf('thumb-skeleton')).toBe(radiusOf('thumb-img'));
  });

  it('rounds the node fallback exactly as much as the image would be', () => {
    renderImage(<span>sem foto</span>);
    fireEvent.error(screen.getByTestId('thumb-img'));
    expect(radiusOf('thumb-fallback')).toBe('0.5rem');
  });

  it('passes a string radius through untouched', () => {
    render(
      <ThemeProvider theme={theme}>
        <LazyImage src="/photo.png" alt="Foto" width={56} height={56} borderRadius="50%" lazy={false} data-testid="round" />
      </ThemeProvider>,
    );
    expect(radiusOf('round')).toBe('50%');
    expect(radiusOf('round-img')).toBe('50%');
  });
});
