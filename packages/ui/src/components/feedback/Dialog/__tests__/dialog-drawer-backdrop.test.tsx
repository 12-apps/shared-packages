/**
 * THE DRAWER HONOURS `persistent` AND `glass` LIKE EVERY OTHER VARIANT.
 *
 * The drawer renders MUI's `Drawer` instead of MUI's `Dialog`, and it used to
 * get the caller's raw `onClose` and no backdrop props at all. So a
 * `persistent` drawer still closed on a backdrop click or Escape, `onClose`
 * received MUI's `(event, reason)` where the contract promises no arguments,
 * and `glass` left the drawer's scrim at 0.5 with no blur (FUT-2673).
 *
 * `glass` changes the drawer's BACKDROP only — its paper is unchanged, as it is
 * on the glass and fullscreen variants. jsdom does not compute
 * `backdrop-filter`, so the blur is checked in a browser
 * (`DrawerGlassBackdropIsBlurred` in `Dialog.test.stories.tsx`).
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Dialog, DialogContent } from '../index';

afterEach(cleanup);

const GLASS_SCRIM = 'rgba(0, 0, 0, 0.2)';
const PLAIN_SCRIM = 'rgba(0, 0, 0, 0.5)';

const backdropOf = (): HTMLElement => {
  const backdrop = document.querySelector<HTMLElement>('.MuiBackdrop-root');
  if (!backdrop) throw new Error('no backdrop rendered');
  return backdrop;
};

const paperOf = (): HTMLElement => {
  const paper = document.querySelector<HTMLElement>('.MuiDrawer-paper');
  if (!paper) throw new Error('no drawer paper rendered');
  return paper;
};

describe('Dialog variant="drawer" closing', () => {
  it('does not close on a backdrop click or Escape when persistent', () => {
    const onClose = vi.fn();
    render(
      <Dialog open variant="drawer" persistent onClose={onClose}>
        <DialogContent>body</DialogContent>
      </Dialog>,
    );
    fireEvent.click(backdropOf());
    fireEvent.keyDown(paperOf(), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes once on a backdrop click, with no arguments, when not persistent', () => {
    const onClose = vi.fn();
    render(
      <Dialog open variant="drawer" onClose={onClose}>
        <DialogContent>body</DialogContent>
      </Dialog>,
    );
    fireEvent.click(backdropOf());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose.mock.calls[0]).toEqual([]);
  });

  it('closes once on Escape, with no arguments, when not persistent', () => {
    const onClose = vi.fn();
    render(
      <Dialog open variant="drawer" onClose={onClose}>
        <DialogContent>body</DialogContent>
      </Dialog>,
    );
    fireEvent.keyDown(paperOf(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose.mock.calls[0]).toEqual([]);
  });
});

describe('Dialog variant="drawer" backdrop', () => {
  it('draws the glass scrim when glass is set', () => {
    render(
      <Dialog open variant="drawer" glass>
        <DialogContent>body</DialogContent>
      </Dialog>,
    );
    expect(getComputedStyle(backdropOf()).backgroundColor).toBe(GLASS_SCRIM);
  });

  it("keeps the glass scrim under a caller's slotProps.backdrop, and applies the caller's too", () => {
    render(
      <Dialog open variant="drawer" glass slotProps={{ backdrop: { className: 'caller-backdrop' } }}>
        <DialogContent>body</DialogContent>
      </Dialog>,
    );
    const backdrop = backdropOf();
    expect(backdrop).toHaveClass('caller-backdrop');
    expect(getComputedStyle(backdrop).backgroundColor).toBe(GLASS_SCRIM);
  });

  it("keeps the glass scrim under a caller's BackdropProps, and applies the caller's too", () => {
    render(
      <Dialog open variant="drawer" glass BackdropProps={{ className: 'caller-backdrop' }}>
        <DialogContent>body</DialogContent>
      </Dialog>,
    );
    const backdrop = backdropOf();
    expect(backdrop).toHaveClass('caller-backdrop');
    expect(getComputedStyle(backdrop).backgroundColor).toBe(GLASS_SCRIM);
  });

  it('draws the plain scrim without glass', () => {
    render(
      <Dialog open variant="drawer">
        <DialogContent>body</DialogContent>
      </Dialog>,
    );
    expect(getComputedStyle(backdropOf()).backgroundColor).toBe(PLAIN_SCRIM);
  });

  it.each([false, true])('leaves the paper look alone with glass=%s', (glass) => {
    render(
      <Dialog open variant="drawer" size="sm" glass={glass}>
        <DialogContent>body</DialogContent>
      </Dialog>,
    );
    const style = getComputedStyle(paperOf());
    expect(style.width).toBe('37.5rem');
    expect(style.maxWidth).toBe('100%');
    // jsdom does not expand the shorthand into the four corners.
    expect(style.borderRadius).toBe('16px 0 0 16px');
  });
});
