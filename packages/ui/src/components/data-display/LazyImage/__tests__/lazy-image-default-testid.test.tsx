import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { LazyImage } from '../LazyImage';

// FUT-2774 #3: no `LAZY_IMAGE_DEFAULTS` entry covered `data-testid`, so a
// caller that omitted it got the literal string "undefined" baked into every
// derived id (`${testId}-skeleton`, `-img`, …) — and every such instance on a
// page collided on the same ids.
const theme = createTheme();

function renderImage(fallback?: React.ReactNode) {
  return render(
    <ThemeProvider theme={theme}>
      <LazyImage src="/photo.png" alt="Foto" lazy={false} fallback={fallback} />
    </ThemeProvider>,
  );
}

describe('LazyImage default data-testid (FUT-2774 #3)', () => {
  it('derives its ids off a real default rather than "undefined"', () => {
    renderImage();
    expect(screen.getByTestId('lazy-image-img')).toBeInTheDocument();
    expect(screen.getByTestId('lazy-image-skeleton')).toBeInTheDocument();
  });

  it('renders no "undefined"-prefixed test id anywhere in the tree', () => {
    const { container } = renderImage(<span>sem foto</span>);
    fireEvent.error(screen.getByTestId('lazy-image-img'));

    const ids = Array.from(container.querySelectorAll('[data-testid]')).map((el) =>
      el.getAttribute('data-testid'),
    );
    expect(ids.some((id) => id?.startsWith('undefined'))).toBe(false);
  });

  it('still lets an explicit data-testid win', async () => {
    render(
      <ThemeProvider theme={theme}>
        <LazyImage src="/photo.png" alt="Foto" lazy={false} data-testid="thumb" />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('thumb-img')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('lazy-image-img')).not.toBeInTheDocument());
  });
});
