import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { emittedCss } from '../../layout/SettingCard/__tests__/emitted-css';
import { Button } from './Button';

const RING = /:focus-visible[^{]*\{[^}]*outline:[^;]*solid/;

describe('keyboard focus ring on the variants that paint no surface (FUT-5521)', () => {
  it.each(['outline', 'text', 'ghost'] as const)('%s draws a :focus-visible ring', (variant) => {
    render(
      <Button variant={variant} dataTestId="b" ripple={false}>
        Voltar
      </Button>,
    );
    const css = emittedCss(screen.getByTestId('b'));
    expect(css).toMatch(RING);
    expect(css).toMatch(/:focus-visible[^{]*\{[^}]*box-shadow:/);
  });

  it('a neutral outline draws it too', () => {
    render(
      <Button variant="outline" color="neutral" dataTestId="b">
        Voltar
      </Button>,
    );
    expect(emittedCss(screen.getByTestId('b'))).toMatch(RING);
  });

  it('a solid button keeps its own look: no ring of its own', () => {
    render(
      <Button variant="solid" dataTestId="b">
        Voltar
      </Button>,
    );
    expect(emittedCss(screen.getByTestId('b'))).not.toMatch(RING);
  });
});
