import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { Heading } from './Heading';
import { HEADING_GRADIENT_ANGLE } from './Heading.metrics';

/**
 * The web `Heading` now reads its weights, defaults, ranks and gradient stops
 * from `Heading.metrics.ts`, which the native `Heading` reads too. These pin
 * the emitted values to what the inline tables produced. The scale and the
 * gradient-per-colour behaviour are pinned in `__tests__/`.
 */
describe('Heading (web)', () => {
  it('honours testID, dataTestId and data-testid', () => {
    render(
      <>
        <Heading testID="a">a</Heading>
        <Heading dataTestId="b">b</Heading>
        <Heading {...{ 'data-testid': 'c' }}>c</Heading>
      </>,
    );
    for (const id of ['a', 'b', 'c']) {
      const el = screen.getByTestId(id);
      expect(el).not.toHaveAttribute('testID');
      expect(el).not.toHaveAttribute('dataTestId');
    }
  });

  it('renders the tag of the rank: display is an h1, the default and an unknown level an h2', () => {
    render(
      <>
        <Heading level="display" dataTestId="hero">x</Heading>
        <Heading level="h5" dataTestId="five">x</Heading>
        <Heading dataTestId="default">x</Heading>
        <Heading {...{ level: 1 as unknown as 'h1' }} dataTestId="legacy">x</Heading>
      </>,
    );
    expect(screen.getByTestId('hero').tagName).toBe('H1');
    expect(screen.getByTestId('five').tagName).toBe('H5');
    expect(screen.getByTestId('default').tagName).toBe('H2');
    expect(screen.getByTestId('legacy').tagName).toBe('H2');
  });

  it('weighs from the shared table: bold by default, the step weight for normal, bold for a stranger', () => {
    render(
      <>
        <Heading dataTestId="bold">x</Heading>
        <Heading weight="normal" level="display" dataTestId="normal-display">x</Heading>
        <Heading weight="normal" level="h4" dataTestId="normal-h4">x</Heading>
        <Heading weight="light" dataTestId="light">x</Heading>
        <Heading {...{ weight: 'black' as unknown as 'bold' }} dataTestId="stranger">x</Heading>
      </>,
    );
    expect(screen.getByTestId('bold')).toHaveStyle({ fontWeight: '700', margin: '0px' });
    expect(screen.getByTestId('normal-display')).toHaveStyle({ fontWeight: '800' });
    expect(screen.getByTestId('normal-h4')).toHaveStyle({ fontWeight: '600' });
    expect(screen.getByTestId('light')).toHaveStyle({ fontWeight: '300' });
    expect(screen.getByTestId('stranger')).toHaveStyle({ fontWeight: '700' });
  });

  it('paints the gradient corner to corner from the shared angle', () => {
    render(
      <Heading gradient color="primary" dataTestId="g">
        x
      </Heading>,
    );
    const background = globalThis.getComputedStyle(screen.getByTestId('g')).background;
    expect(background).toContain(`linear-gradient(${HEADING_GRADIENT_ANGLE}deg`);
    expect(background).toContain('0%');
    expect(background).toContain('100%');
  });
});
