import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button';

describe('Button (web)', () => {
  it('defaults its test id to `button` and derives the children ids from it', () => {
    render(
      <>
        <Button loading>a</Button>
        <Button dataTestId="save" icon={<span>+</span>}>
          b
        </Button>
        <Button testID="go">c</Button>
      </>,
    );
    expect(screen.getByTestId('button')).toBeInTheDocument();
    expect(screen.getByTestId('button-loading')).toBeInTheDocument();
    expect(screen.getByTestId('save-icon')).toBeInTheDocument();
    expect(screen.getByTestId('go')).not.toHaveAttribute('testID');
  });

  it('pads and types each size from the shared metrics', () => {
    render(
      <>
        <Button size="xs" dataTestId="xs">x</Button>
        <Button size="xl" dataTestId="xl">x</Button>
      </>,
    );
    expect(screen.getByTestId('xs')).toHaveStyle({ padding: '2px 8px', fontSize: '0.75rem' });
    expect(screen.getByTestId('xl')).toHaveStyle({ padding: '12px 24px', fontSize: '1.25rem' });
  });

  it('is square when it carries only an icon', () => {
    render(<Button dataTestId="close" icon={<span>x</span>} />);
    const style = window.getComputedStyle(screen.getByTestId('close'));
    expect(style.padding).toBe('7px');
    expect(style.minWidth).toMatch(/^0(px)?$/);
  });

  it('fires onClick and is a real disabled button while loading', () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <Button dataTestId="b" onClick={onClick}>
        x
      </Button>,
    );
    fireEvent.click(screen.getByTestId('b'));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(
      <Button dataTestId="b" onClick={onClick} loading>
        x
      </Button>,
    );
    expect(screen.getByTestId('b')).toBeDisabled();
  });
});
