import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { LazyImage } from '../LazyImage';

// FUT-2774 #5: three overrides were read with `||`, which treats a legitimate
// falsy value (`false`, `0`) the same as "nothing was passed" — the same class
// of bug FUT-2669 fixed for `width`/`height` via `orDefault`, missed here for
// the skeleton and the spinner. `skeletonProps.variant` was not read at all.
const theme = createTheme();
const ZERO = theme.typography.pxToRem(0);

function renderImage(props: React.ComponentProps<typeof LazyImage>['skeletonProps'] | undefined) {
  return render(
    <ThemeProvider theme={theme}>
      <LazyImage src="/photo.png" alt="Foto" lazy={false} data-testid="pic" skeletonProps={props} />
    </ThemeProvider>,
  );
}

describe('LazyImage skeletonProps overrides (FUT-2774 #5)', () => {
  it('keeps the default pulse animation when skeletonProps is unset', () => {
    renderImage(undefined);
    expect(screen.getByTestId('pic-skeleton')).toHaveClass('MuiSkeleton-pulse');
  });

  it('turns the animation off with skeletonProps.animation={false}', () => {
    renderImage({ animation: false });
    expect(screen.getByTestId('pic-skeleton')).not.toHaveClass('MuiSkeleton-pulse');
  });

  it('keeps the default rectangular variant when skeletonProps is unset', () => {
    renderImage(undefined);
    expect(screen.getByTestId('pic-skeleton')).toHaveClass('MuiSkeleton-rectangular');
  });

  it('reaches the rendered Skeleton with skeletonProps.variant="circular"', () => {
    renderImage({ variant: 'circular' });
    expect(screen.getByTestId('pic-skeleton')).toHaveClass('MuiSkeleton-circular');
    expect(screen.getByTestId('pic-skeleton')).not.toHaveClass('MuiSkeleton-rectangular');
  });
});

describe('LazyImage spinnerProps overrides (FUT-2774 #5)', () => {
  function renderSpinner(props?: React.ComponentProps<typeof LazyImage>['spinnerProps']) {
    return render(
      <ThemeProvider theme={theme}>
        <LazyImage
          src="/photo.png"
          alt="Foto"
          lazy={false}
          loadingState="spinner"
          data-testid="pic"
          spinnerProps={props}
        />
      </ThemeProvider>,
    );
  }

  it('falls back to the 40px/4 default when spinnerProps is unset', () => {
    renderSpinner(undefined);
    const spinner = screen.getByTestId('pic-spinner');
    expect(globalThis.getComputedStyle(spinner).width).not.toBe(ZERO);
    expect(spinner.querySelector('circle')).toHaveAttribute('stroke-width', '4');
  });

  it('keeps spinnerProps.size={0} instead of reading it as unset', () => {
    renderSpinner({ size: 0 });
    expect(globalThis.getComputedStyle(screen.getByTestId('pic-spinner')).width).toBe(ZERO);
  });

  it('keeps spinnerProps.thickness={0} instead of reading it as unset', () => {
    renderSpinner({ thickness: 0 });
    expect(screen.getByTestId('pic-spinner').querySelector('circle')).toHaveAttribute('stroke-width', '0');
  });
});
