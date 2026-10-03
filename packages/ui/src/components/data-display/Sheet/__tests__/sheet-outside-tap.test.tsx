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
  fireEvent.click(screen.getByTestId('sheet-click-catcher'));
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
});
