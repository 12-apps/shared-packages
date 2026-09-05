import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { Text } from './Text';

/** The shared contract's test-id spellings reach the DOM as `data-testid` and nothing else. */
describe('Text (web)', () => {
  it('honours testID, dataTestId and data-testid', () => {
    render(
      <>
        <Text testID="a">a</Text>
        <Text dataTestId="b">b</Text>
        <Text {...{ 'data-testid': 'c' }}>c</Text>
      </>,
    );
    for (const id of ['a', 'b', 'c']) {
      const el = screen.getByTestId(id);
      expect(el).not.toHaveAttribute('testID');
      expect(el).not.toHaveAttribute('dataTestId');
    }
  });

  it('paints the body scale from the shared metrics', () => {
    render(
      <>
        <Text size="xs" dataTestId="xs">x</Text>
        <Text size="xl" dataTestId="xl">x</Text>
        <Text variant="heading" dataTestId="h">x</Text>
      </>,
    );
    expect(screen.getByTestId('xs')).toHaveStyle({ fontSize: '0.75rem' });
    expect(screen.getByTestId('xl')).toHaveStyle({ fontSize: '1.25rem' });
    expect(screen.getByTestId('h')).toHaveStyle({ fontWeight: '600' });
  });

  it('renders the element `as` asks for', () => {
    render(<Text as="p" dataTestId="p">x</Text>);
    expect(screen.getByTestId('p').tagName).toBe('P');
  });
});
