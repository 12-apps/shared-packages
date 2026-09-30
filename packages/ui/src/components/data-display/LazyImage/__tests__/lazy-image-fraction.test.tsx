import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { LazyImage } from '../LazyImage';
import type { LazyImageProps } from '../LazyImage.types';

// FUT-2666: a width of 1 or less is a fraction, as in `sx`. The container took
// it (`0.5` → `50%` of its parent) while everything drawn inside read the same
// number as px, so the image was half a pixel wide in a half-width box.
const theme = createTheme();

function renderImage(props: Partial<LazyImageProps> = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <LazyImage src="/photo.png" alt="Foto" width={0.5} height={200} lazy={false} data-testid="half" {...props} />
    </ThemeProvider>,
  );
}

const widthOf = (testId: string) => globalThis.getComputedStyle(screen.getByTestId(testId)).width;

describe('LazyImage fractional width (FUT-2666)', () => {
  it('gives the fraction to the container and fills it with the image and the skeleton', () => {
    renderImage();
    expect(widthOf('half')).toBe('50%');
    expect(widthOf('half-img')).toBe('100%');
    expect(widthOf('half-skeleton')).toBe('100%');
  });

  it('fills the container with a node fallback', () => {
    renderImage({ fallback: <span>sem foto</span> });
    fireEvent.error(screen.getByTestId('half-img'));
    expect(widthOf('half-fallback')).toBe('100%');
  });

  it('fills the container with a string fallback', () => {
    renderImage({ fallback: '/fallback.png' });
    fireEvent.error(screen.getByTestId('half-img'));
    expect(widthOf('half-fallback')).toBe('100%');
  });

  it('keeps a fractional height on the container only', () => {
    renderImage({ width: 200, height: 0.5 });
    expect(globalThis.getComputedStyle(screen.getByTestId('half')).height).toBe('50%');
    expect(globalThis.getComputedStyle(screen.getByTestId('half-img')).height).toBe('100%');
  });

  it('keeps a px width as it was', () => {
    renderImage({ width: 56 });
    expect(widthOf('half')).toBe('3.5rem');
    expect(widthOf('half-img')).toBe('3.5rem');
  });

  it('does not read a negative width as a fraction', () => {
    renderImage({ width: -5 });
    expect(widthOf('half')).not.toBe('100%');
    expect(widthOf('half-img')).not.toBe('100%');
  });

  it('passes a string width through untouched', () => {
    renderImage({ width: '40%' });
    expect(widthOf('half')).toBe('40%');
    expect(widthOf('half-img')).toBe('40%');
  });
});
