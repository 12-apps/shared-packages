/**
 * THE RETRY BUTTON'S TAP FLOOR (FUT-1310).
 *
 * MUI's medium outlined button is 37px tall, under the 40px floor a finger
 * needs below `sm`. The component states a `minHeight` so the floor does not
 * depend on MUI's padding. The case asserts the declaration rather than a
 * measured box, because jsdom does no layout.
 */
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ErrorState } from './ErrorState';
import { RETRY_MIN_HEIGHT } from './ErrorState.metrics';

describe('ErrorState retry button', () => {
  it('declares a minHeight of at least the 40px tap floor', () => {
    render(<ErrorState message="Falhou" onRetry={vi.fn()} />);
    expect(RETRY_MIN_HEIGHT).toBeGreaterThanOrEqual(40);
    expect(screen.getByTestId('error-state-retry-button')).toHaveStyle({
      minHeight: `${RETRY_MIN_HEIGHT / 16}rem`,
    });
  });
});
