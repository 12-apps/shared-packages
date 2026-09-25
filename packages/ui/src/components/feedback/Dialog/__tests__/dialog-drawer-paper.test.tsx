/**
 * THE DRAWER'S LOOK LIVES ON THE DRAWER'S OWN PAPER — and a caller's paper props
 * add to it rather than replace it.
 *
 * The look used to sit on an absolutely positioned Box inside MUI's `Drawer`,
 * which left the paper 0px wide and clipped the whole panel (FUT-2592). On the
 * paper it is reached through `PaperProps`, which is also a prop a caller may
 * pass: spread after ours, a caller's `className` alone would have dropped the
 * width, the height and the radius with it.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Dialog, DialogContent } from '../index';

afterEach(cleanup);

const paperOf = (): HTMLElement => {
  const paper = document.querySelector<HTMLElement>('.MuiDrawer-paper');
  if (!paper) throw new Error('no drawer paper rendered');
  return paper;
};

describe('Dialog variant="drawer" paper', () => {
  it('carries the variant look: its width and rounded leading corners', () => {
    render(
      <Dialog open variant="drawer" size="sm">
        <DialogContent>body</DialogContent>
      </Dialog>,
    );
    const style = getComputedStyle(paperOf());
    expect(style.width).toBe('600px');
    expect(style.maxWidth).toBe('100%');
    // jsdom does not expand the shorthand into the four corners.
    expect(style.borderRadius).toBe('16px 0 0 16px');
  });

  it("keeps that look when the caller passes its own PaperProps, and applies the caller's too", () => {
    render(
      <Dialog
        open
        variant="drawer"
        size="sm"
        PaperProps={{ className: 'caller-paper', sx: { letterSpacing: '1px' } }}
      >
        <DialogContent>body</DialogContent>
      </Dialog>,
    );
    const paper = paperOf();
    const style = getComputedStyle(paper);
    expect(paper).toHaveClass('caller-paper');
    expect(style.letterSpacing).toBe('1px');
    expect(style.width).toBe('600px');
    expect(style.borderRadius).toBe('16px 0 0 16px');
  });

  it('lets raw children taller than the panel scroll with the paper', () => {
    render(
      <Dialog open variant="drawer" size="sm">
        <div>raw body</div>
      </Dialog>,
    );
    expect(getComputedStyle(paperOf()).overflowY).toBe('auto');
  });
});
