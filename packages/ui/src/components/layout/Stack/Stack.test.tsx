import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { Stack } from './Stack';
import { Text } from '../../typography/Text/Text';

describe('Stack (web)', () => {
  it('is a flex column with no gap by default', () => {
    render(<Stack dataTestId="s" />);
    expect(screen.getByTestId('s')).toHaveStyle({ display: 'flex', flexDirection: 'column', gap: '0px' });
  });

  it('lays out a row on the spacing scale', () => {
    render(<Stack direction="row" gap={2} align="center" dataTestId="r" />);
    expect(screen.getByTestId('r')).toHaveStyle({ flexDirection: 'row', gap: '16px', alignItems: 'center' });
  });

  it('puts the divider between children, never outside them', () => {
    render(
      <Stack dataTestId="d" divider={<Text dataTestId="div">|</Text>}>
        <Text>a</Text>
        <Text>b</Text>
        <Text>c</Text>
      </Stack>,
    );
    const stack = screen.getByTestId('d');
    expect(screen.getAllByTestId('div')).toHaveLength(2);
    expect(stack.firstElementChild).toHaveTextContent('a');
    expect(stack.lastElementChild).toHaveTextContent('c');
  });
});
