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

  /**
   * 12-74. The pixels were always right; the CLASS was not. Every button, xs
   * through xl, rendered `MuiButton-sizeMedium`, because our size went to `sx`
   * and MUI's `size` prop was never passed. So the DOM named a size the button
   * was not, a test could not read it, and devtools lied.
   */
  it('names its size in the rendered class, not just in its padding', () => {
    render(
      <>
        <Button size="xs" dataTestId="xs">x</Button>
        <Button size="sm" dataTestId="sm">x</Button>
        <Button size="md" dataTestId="md">x</Button>
        <Button size="lg" dataTestId="lg">x</Button>
        <Button size="xl" dataTestId="xl">x</Button>
      </>,
    );
    // Five of ours onto three of MUI's, and the padding above still proves the
    // five are drawn apart.
    expect(screen.getByTestId('xs').className).toMatch(/MuiButton-sizeSmall/u);
    expect(screen.getByTestId('sm').className).toMatch(/MuiButton-sizeSmall/u);
    expect(screen.getByTestId('md').className).toMatch(/MuiButton-sizeMedium/u);
    expect(screen.getByTestId('lg').className).toMatch(/MuiButton-sizeLarge/u);
    expect(screen.getByTestId('xl').className).toMatch(/MuiButton-sizeLarge/u);
  });

  /**
   * The half of 12-74 that must NOT change. MUI writes 18/20/22 onto the icon
   * slot off its own `size`, so forwarding `size` would have moved any glyph
   * that takes its size by inheritance — a design decision arriving as a side
   * effect of a class-name fix. `BUTTON_ICON_GLYPH_SIZE` pins the slot to what
   * shipped before; the element read below is that slot, which is what the
   * glyph inherits from.
   */
  it('holds the icon slot still across every size', () => {
    render(
      <>
        <Button size="xs" dataTestId="xs" icon={<span>+</span>}>x</Button>
        <Button size="xl" dataTestId="xl" icon={<span>+</span>}>x</Button>
      </>,
    );
    // The SLOT, not the glyph inside it: jsdom's `getComputedStyle` does not
    // resolve an inherited `font-size`, so the child reads back empty whatever
    // the slot says. The slot is the element MUI writes its 18/20/22 onto and
    // the one the glyph inherits from, so pinning it is the mechanism; that the
    // glyph then follows was measured in a browser (see `Button.metrics.ts`).
    for (const id of ['xs', 'xl']) {
      expect(window.getComputedStyle(screen.getByTestId(`${id}-icon`)).fontSize).toBe('20px');
    }
  });

  /**
   * 12-70. `component` used to be a bare `React.ElementType`, which accepted
   * the component and threw its props away — so a router `Link`'s `to`
   * typechecked nowhere even though it reached the DOM intact. A host wanting a
   * navigation painted as a button had to pick between a type assertion and
   * losing the `href`.
   *
   * The runtime half is asserted here; the TYPE half is asserted by this file
   * compiling at all, since `to` below exists only on `Destination`.
   */
  it('renders as the component it is given, with that component\'s own props', () => {
    // Shaped like a router `Link`: it reads `to`, and passes everything else it
    // was handed straight to the anchor — which is how the button's own
    // `data-testid`, `className` and handlers survive the swap.
    interface DestinationProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
      to: string;
    }
    const Destination = React.forwardRef<HTMLAnchorElement, DestinationProps>(
      ({ to, children, ...rest }, ref) => (
        <a {...rest} ref={ref} href={to} data-kind="destination">
          {children}
        </a>
      ),
    );
    Destination.displayName = 'Destination';

    render(
      <Button component={Destination} to="/account/compras/42" dataTestId="track">
        Acompanhar pedido
      </Button>,
    );

    const el = screen.getByTestId('track');
    expect(el.tagName).toBe('A');
    expect(el).toHaveAttribute('href', '/account/compras/42');
    expect(el).toHaveAttribute('data-kind', 'destination');
    // Still the design system's button, not a bare anchor.
    expect(el.className).toMatch(/MuiButton-root/u);
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
