import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { Collapsible } from './Collapsible';

describe('Collapsible id', () => {
  it.each(['default', 'smooth', 'spring'] as const)('puts id on the %s region', (variant) => {
    render(
      <Collapsible open variant={variant} id="r1" dataTestId="c">
        body
      </Collapsible>,
    );
    expect(screen.getByTestId('c')).toHaveAttribute('id', 'r1');
  });
});
