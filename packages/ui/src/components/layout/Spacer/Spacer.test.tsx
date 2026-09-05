import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { Spacer } from './Spacer';

/**
 * The web `Spacer` now derives its steps from `Spacer.metrics.ts`, which the
 * native `Spacer` reads too. These pin the emitted values to what the old
 * `switch` over `theme.spacing(…)` produced, so the refactor can be seen to
 * change nothing a browser paints.
 */
describe('Spacer (web)', () => {
  it('honours testID, dataTestId and data-testid', () => {
    render(
      <>
        <Spacer testID="a" />
        <Spacer dataTestId="b" />
        <Spacer {...{ 'data-testid': 'c' }} />
      </>,
    );
    for (const id of ['a', 'b', 'c']) {
      const el = screen.getByTestId(id);
      expect(el).not.toHaveAttribute('testID');
      expect(el).not.toHaveAttribute('dataTestId');
    }
  });

  it('paints the size steps as MUI spacing strings', () => {
    render(
      <>
        <Spacer dataTestId="xs" size="xs" />
        <Spacer dataTestId="md" />
        <Spacer dataTestId="xl" size="xl" />
      </>,
    );
    expect(screen.getByTestId('xs')).toHaveStyle({ width: '4px', height: '4px' });
    expect(screen.getByTestId('md')).toHaveStyle({ width: '16px', height: '16px' });
    expect(screen.getByTestId('xl')).toHaveStyle({ width: '32px', height: '32px' });
  });

  it('fills only the named axis and lets an explicit dimension win', () => {
    render(
      <>
        <Spacer dataTestId="h" direction="horizontal" size="lg" />
        <Spacer dataTestId="w" width="2rem" height={0} />
      </>,
    );
    const horizontal = screen.getByTestId('h');
    expect(horizontal).toHaveStyle({ width: '24px' });
    expect(globalThis.getComputedStyle(horizontal).height).not.toBe('24px');
    expect(screen.getByTestId('w')).toHaveStyle({ width: '2rem', height: '0px' });
  });

  it('is decoration: hidden, unfocusable, and a non-shrinking flex item when asked', () => {
    render(<Spacer dataTestId="f" flex />);
    const spacer = screen.getByTestId('f');
    expect(spacer).toHaveAttribute('aria-hidden', 'true');
    expect(spacer).not.toHaveAttribute('tabindex');
    expect(spacer).toHaveStyle({ flexGrow: '1', flexShrink: '0', pointerEvents: 'none' });
  });
});
