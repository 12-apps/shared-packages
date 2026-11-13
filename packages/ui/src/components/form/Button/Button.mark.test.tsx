import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { Button } from './Button';
import type { ButtonProps } from './Button.types';

/**
 * FUT-4880: `ghost` renders as MUI `contained` and `customVariant` never
 * reaches the DOM, so a host could not tell a ghost button from a solid one.
 * `data-variant` is the stable, documented mark (Button.md, "Host-facing
 * selectors").
 */
const VARIANTS = ['solid', 'outline', 'ghost', 'text', 'glass', 'gradient'] as const;

describe('Button data-variant mark (FUT-4880)', () => {
  it.each(VARIANTS)('marks a %s button with its own variant', (variant) => {
    render(<Button variant={variant} dataTestId="b">x</Button>);
    expect(screen.getByTestId('b')).toHaveAttribute('data-variant', variant);
  });

  it('tells a ghost button from a solid one, which MUI renders with the same classes', () => {
    render(
      <>
        <Button variant="ghost" dataTestId="g">x</Button>
        <Button variant="solid" dataTestId="s">x</Button>
      </>,
    );
    expect(screen.getByTestId('g').className).toMatch(/MuiButton-contained\b/u);
    expect(screen.getByTestId('g').matches('button[data-variant="ghost"]')).toBe(true);
    expect(screen.getByTestId('s').matches('button[data-variant="ghost"]')).toBe(false);
  });

  it('names the default variant too, and marks a disabled and a loading button', () => {
    render(
      <>
        <Button dataTestId="d">x</Button>
        <Button variant="ghost" disabled dataTestId="off">x</Button>
        <Button variant="ghost" loading dataTestId="busy">x</Button>
      </>,
    );
    expect(screen.getByTestId('d')).toHaveAttribute('data-variant', 'solid');
    expect(screen.getByTestId('off')).toHaveAttribute('data-variant', 'ghost');
    expect(screen.getByTestId('busy')).toHaveAttribute('data-variant', 'ghost');
  });

  it('marks the element a Button renders as, an anchor included', () => {
    render(
      <Button variant="ghost" href="/orders" dataTestId="link">go</Button>,
    );
    expect(screen.getByTestId('link').tagName).toBe('A');
    expect(screen.getByTestId('link')).toHaveAttribute('data-variant', 'ghost');
  });

  it('lets a host-supplied data-variant win, and adds no prop to the public API', () => {
    const props: ButtonProps = { variant: 'ghost', 'data-variant': 'mine' } as ButtonProps;
    render(<Button {...props} dataTestId="b">x</Button>);
    expect(screen.getByTestId('b')).toHaveAttribute('data-variant', 'mine');
  });
});
