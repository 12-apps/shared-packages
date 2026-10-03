/**
 * A tap outside a sheet closes it.
 *
 * The visible veil sits UNDER the drawer's modal root, which covers the whole
 * viewport; with no backdrop of its own, a tap there landed on the bare root
 * and no sheet ever closed on an outside tap. The drawer's backdrop now catches
 * the tap (invisibly) and the sheet routes it through `closeOnOverlayClick`
 * and `persistent`.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Sheet } from '../Sheet';

afterEach(cleanup);

function tapOutside(): void {
  fireEvent.click(screen.getByTestId('s-click-catcher'));
}

describe('a tap outside the sheet', () => {
  it('closes it', () => {
    const onOpenChange = vi.fn();
    render(
      <Sheet open position="bottom" onOpenChange={onOpenChange} dataTestId="s">
        <p>body</p>
      </Sheet>,
    );
    tapOutside();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('is ignored with closeOnOverlayClick off', () => {
    const onOpenChange = vi.fn();
    render(
      <Sheet open position="bottom" closeOnOverlayClick={false} onOpenChange={onOpenChange} dataTestId="s">
        <p>body</p>
      </Sheet>,
    );
    tapOutside();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('is ignored on a persistent sheet', () => {
    const onOpenChange = vi.fn();
    render(
      <Sheet open persistent position="bottom" onOpenChange={onOpenChange} dataTestId="s">
        <p>body</p>
      </Sheet>,
    );
    tapOutside();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('never closes from a tap inside the panel', () => {
    const onOpenChange = vi.fn();
    render(
      <Sheet open position="bottom" onOpenChange={onOpenChange} dataTestId="s">
        <button type="button">inside</button>
      </Sheet>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'inside' }));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('closes a plain (non-swipeable) drawer too', () => {
    const onOpenChange = vi.fn();
    render(
      <Sheet open position="right" swipeable={false} onOpenChange={onOpenChange} dataTestId="s">
        <p>body</p>
      </Sheet>,
    );
    tapOutside();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes on Escape once, and not at all with closeOnEscape off', () => {
    const closes = vi.fn();
    const view = render(
      <Sheet open position="bottom" onOpenChange={closes} dataTestId="s">
        <p>body</p>
      </Sheet>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closes).toHaveBeenCalledTimes(1);
    view.unmount();

    const kept = vi.fn();
    render(
      <Sheet open position="bottom" closeOnEscape={false} onOpenChange={kept} dataTestId="s">
        <button type="button">inside</button>
      </Sheet>,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'inside' }), { key: 'Escape' });
    expect(kept).not.toHaveBeenCalled();
  });
});
