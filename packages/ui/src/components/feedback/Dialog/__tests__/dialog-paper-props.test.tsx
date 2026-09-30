/**
 * A CALLER'S PAPER PROPS ADD TO THE DIALOG'S PAPER LOOK — on every branch, by
 * every spelling MUI takes them in.
 *
 * The default, glass and fullscreen variants draw on MUI's Dialog paper, which a
 * caller reaches through `PaperProps` or `slotProps.paper` too. Spread after
 * ours, either one replaced the paper props whole: the radius, the max width,
 * the variant background and the paper's test id went with it (FUT-2613;
 * `AppHeaderDetails` lost all of them). FUT-2592 fixed `PaperProps` on the
 * drawer only — see `dialog-drawer-paper.test.tsx`.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Dialog, DialogContent } from '../index';

afterEach(cleanup);

const CALLER_PAPER = { className: 'caller-paper', sx: { letterSpacing: '1px' } } as const;

const dialogPaperOf = (): HTMLElement => {
  const paper = document.querySelector<HTMLElement>('.MuiDialog-paper');
  if (!paper) throw new Error('no dialog paper rendered');
  return paper;
};

/** The `md`/`lg` look of the default variant, which MUI's own paper does not draw. */
const expectDefaultLook = (paper: HTMLElement): void => {
  const style = getComputedStyle(paper);
  expect(style.maxWidth).toBe('50rem');
  expect(style.borderRadius).toBe('16px');
};

describe('Dialog paper props (default variant)', () => {
  it("keeps the variant look and the test id under a caller's PaperProps", () => {
    render(
      <Dialog open size="md" borderRadius="lg" PaperProps={CALLER_PAPER}>
        <DialogContent>body</DialogContent>
      </Dialog>,
    );
    const paper = dialogPaperOf();
    expect(paper).toHaveClass('caller-paper');
    expect(getComputedStyle(paper).letterSpacing).toBe('1px');
    expectDefaultLook(paper);
    expect(paper).toHaveAttribute('data-testid', 'dialog');
  });

  it("keeps the variant look and the test id under a caller's slotProps.paper", () => {
    render(
      <Dialog open size="md" borderRadius="lg" slotProps={{ paper: CALLER_PAPER }}>
        <DialogContent>body</DialogContent>
      </Dialog>,
    );
    const paper = dialogPaperOf();
    expect(paper).toHaveClass('caller-paper');
    expect(getComputedStyle(paper).letterSpacing).toBe('1px');
    expectDefaultLook(paper);
    expect(paper).toHaveAttribute('data-testid', 'dialog');
  });

  it("lets a caller's paper props name the paper's test id", () => {
    render(
      <Dialog open PaperProps={{ 'data-testid': 'mine' } as Record<string, string>}>
        <DialogContent>body</DialogContent>
      </Dialog>,
    );
    expect(screen.getByTestId('mine')).toHaveClass('MuiDialog-paper');
  });

  it('keeps the dialog test id when a caller sets the paper one to undefined', () => {
    render(
      <Dialog open PaperProps={{ 'data-testid': undefined } as Record<string, undefined>}>
        <DialogContent>body</DialogContent>
      </Dialog>,
    );
    expect(dialogPaperOf()).toHaveAttribute('data-testid', 'dialog');
  });

  it('calls a function slotProps.paper and merges what it returns', () => {
    render(
      <Dialog open size="md" borderRadius="lg" slotProps={{ paper: () => ({ className: 'caller-paper' }) }}>
        <DialogContent>body</DialogContent>
      </Dialog>,
    );
    const paper = dialogPaperOf();
    expect(paper).toHaveClass('caller-paper');
    expectDefaultLook(paper);
  });

  it('merges slotProps.paper over PaperProps when a caller passes both', () => {
    render(
      <Dialog
        open
        PaperProps={{ className: 'legacy-paper', sx: { letterSpacing: '1px' } }}
        slotProps={{ paper: { sx: { letterSpacing: '2px' } } }}
      >
        <DialogContent>body</DialogContent>
      </Dialog>,
    );
    const paper = dialogPaperOf();
    expect(paper).toHaveClass('legacy-paper');
    expect(getComputedStyle(paper).letterSpacing).toBe('2px');
    expectDefaultLook(paper);
  });
});

describe('Dialog paper props (drawer variant)', () => {
  it("keeps the drawer width under a caller's slotProps.paper, with no test id on the paper", () => {
    render(
      <Dialog open variant="drawer" size="sm" slotProps={{ paper: { className: 'caller-paper' } }}>
        <DialogContent>body</DialogContent>
      </Dialog>,
    );
    const paper = document.querySelector<HTMLElement>('.MuiDrawer-paper');
    if (!paper) throw new Error('no drawer paper rendered');
    expect(paper).toHaveClass('caller-paper');
    expect(getComputedStyle(paper).width).toBe('37.5rem');
    expect(paper).not.toHaveAttribute('data-testid');
    expect(screen.getByTestId('dialog')).toHaveClass('MuiDrawer-root');
  });
});
