import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { Collapsible } from './Collapsible';
import type { CollapsibleProps } from './Collapsible.types';

/** `id` is a typed prop: this assignment fails `check-types` without it. */
const typed: CollapsibleProps = { open: true, id: 'typed', children: null };

describe('Collapsible id', () => {
  it('declares id on the props', () => {
    expect(typed.id).toBe('typed');
  });

  it.each(['default', 'smooth', 'spring'] as const)('puts id on the %s region', (variant) => {
    render(
      <Collapsible open variant={variant} id="r1" dataTestId="c">
        body
      </Collapsible>,
    );
    expect(screen.getByTestId('c')).toHaveAttribute('id', 'r1');
  });
});
