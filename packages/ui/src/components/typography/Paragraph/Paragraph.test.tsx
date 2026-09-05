import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { Paragraph } from './Paragraph';

/**
 * The web `Paragraph` now derives its rem strings from `Paragraph.metrics.ts`,
 * which the native `Paragraph` reads too. These pin the emitted values to what
 * the inline table produced, so the refactor can be seen to change nothing.
 */
describe('Paragraph (web)', () => {
  it('honours testID, dataTestId and data-testid, and renders a <p>', () => {
    render(
      <>
        <Paragraph testID="a">a</Paragraph>
        <Paragraph dataTestId="b">b</Paragraph>
        <Paragraph {...{ 'data-testid': 'c' }}>c</Paragraph>
      </>,
    );
    for (const id of ['a', 'b', 'c']) {
      const el = screen.getByTestId(id);
      expect(el.tagName).toBe('P');
      expect(el).not.toHaveAttribute('testID');
      expect(el).not.toHaveAttribute('dataTestId');
    }
  });

  it('paints the paragraph scale from the shared metrics', () => {
    render(
      <>
        <Paragraph size="xs" dataTestId="xs">x</Paragraph>
        <Paragraph dataTestId="md">x</Paragraph>
        <Paragraph size="xl" dataTestId="xl">x</Paragraph>
      </>,
    );
    expect(screen.getByTestId('xs')).toHaveStyle({ fontSize: '0.75rem', lineHeight: '1.4' });
    expect(screen.getByTestId('md')).toHaveStyle({ fontSize: '1rem', lineHeight: '1.6', marginBottom: '1em', fontWeight: '400' });
    expect(screen.getByTestId('xl')).toHaveStyle({ fontSize: '1.25rem', lineHeight: '1.7' });
  });

  it('steps lead up and small down only at the default size', () => {
    render(
      <>
        <Paragraph variant="lead" dataTestId="lead">x</Paragraph>
        <Paragraph variant="lead" size="sm" dataTestId="lead-sm">x</Paragraph>
        <Paragraph variant="small" dataTestId="small">x</Paragraph>
        <Paragraph variant="small" size="xl" dataTestId="small-xl">x</Paragraph>
        <Paragraph variant="muted" dataTestId="muted">x</Paragraph>
      </>,
    );
    expect(screen.getByTestId('lead')).toHaveStyle({ fontSize: '1.125rem', lineHeight: '1.7', letterSpacing: '0.01em' });
    expect(screen.getByTestId('lead-sm')).toHaveStyle({ fontSize: '0.875rem' });
    expect(screen.getByTestId('small')).toHaveStyle({ fontSize: '0.875rem', lineHeight: '1.5' });
    expect(screen.getByTestId('small-xl')).toHaveStyle({ fontSize: '1.25rem' });
    expect(screen.getByTestId('muted')).toHaveStyle({ opacity: '0.8' });
  });
});
