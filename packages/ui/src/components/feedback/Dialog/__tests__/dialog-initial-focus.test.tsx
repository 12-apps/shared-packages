/**
 * WHERE INITIAL FOCUS LANDS ON OPEN (FUT-2696).
 *
 * MUI's `FocusTrap` focuses `.MuiDialog-container` when nothing inside the
 * dialog already has focus — the `role="presentation"` wrapper the Transition
 * clones its ref onto, which sits OUTSIDE the `role="dialog"` paper. These
 * assert the fix: the paper's first tabbable descendant, or the paper itself
 * (`tabIndex={-1}`) when it holds nothing focusable, and a caller's own
 * `autoFocus` still wins either way. See `Dialog.focus.ts`.
 *
 * `transitionDuration={0}` throughout: `focusDialogOnEntered` runs off
 * `TransitionProps.onEntered`/`SlideProps.onEntered`, which only fires once
 * the enter transition completes — zeroing it keeps these tests off the
 * default ~225ms `theme.transitions.duration.enteringScreen`.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Dialog, DialogActions, DialogContent, DialogHeader } from '../index';

afterEach(cleanup);

/**
 * The drawer's `Slide` skips its OWN enter transition on the render that
 * mounts it already open (`Drawer.js`: `appear: mounted.current`, false on
 * that first render — "assume the Drawer will always be rendered in user
 * space"), so `onEntered` — what `focusDialogOnEntered` hooks — never fires
 * for a drawer that starts open. A real caller always opens a drawer from
 * closed, so the drawer cases below render closed and then open it, exactly
 * like that.
 */

describe('Dialog initial focus (default variant)', () => {
  it('focuses the first tabbable element inside the [role="dialog"] paper', async () => {
    render(
      <Dialog open transitionDuration={0}>
        <DialogContent>
          <button type="button">First</button>
          <button type="button">Second</button>
        </DialogContent>
      </Dialog>,
    );

    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(screen.getByText('First')).toHaveFocus());
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    // Not MUI's own container fallback.
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.querySelector('.MuiDialog-container'));
    });
  });

  it('falls back to the paper itself, given tabIndex={-1}, when nothing inside is focusable', async () => {
    render(
      <Dialog open transitionDuration={0}>
        <DialogContent>Nothing focusable in here.</DialogContent>
      </Dialog>,
    );

    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(dialog).toHaveFocus());
    expect(dialog).toHaveAttribute('tabindex', '-1');
  });

  it("lets a caller's autoFocus element keep the focus it already has", async () => {
    render(
      <Dialog open transitionDuration={0}>
        <DialogContent>
          <button type="button">Not first</button>
          <input aria-label="caller-autofocus" autoFocus />
        </DialogContent>
      </Dialog>,
    );

    const dialog = screen.getByRole('dialog');
    // React applies `autoFocus` synchronously on mount, ahead of the enter
    // transition this fix hooks into — assert it holds from the start, then
    // keeps holding once that transition has had its turn.
    await waitFor(() => expect(screen.getByLabelText('caller-autofocus')).toHaveFocus());
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await waitFor(() => expect(screen.getByLabelText('caller-autofocus')).toHaveFocus());
  });

  it("does not shift the paper's box when it falls back to focusing it", async () => {
    const { container } = render(
      <Dialog open transitionDuration={0} size="md">
        <DialogContent>Nothing focusable in here.</DialogContent>
      </Dialog>,
    );
    void container;
    const dialog = screen.getByRole('dialog');
    const before = dialog.getBoundingClientRect();
    await waitFor(() => expect(dialog).toHaveFocus());
    const after = dialog.getBoundingClientRect();
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    expect(getComputedStyle(dialog).outline).toMatch(/^(none|0px|$)/);
  });
});

describe('Dialog initial focus (drawer variant)', () => {
  it('focuses the first tabbable element inside the drawer paper', async () => {
    const { rerender } = render(
      <Dialog open={false} variant="drawer" transitionDuration={0}>
        <DialogHeader title="Drawer" />
        <DialogContent>
          <button type="button">First drawer action</button>
        </DialogContent>
        <DialogActions>
          <button type="button">Close</button>
        </DialogActions>
      </Dialog>,
    );
    rerender(
      <Dialog open variant="drawer" transitionDuration={0}>
        <DialogHeader title="Drawer" />
        <DialogContent>
          <button type="button">First drawer action</button>
        </DialogContent>
        <DialogActions>
          <button type="button">Close</button>
        </DialogActions>
      </Dialog>,
    );

    const paper = document.querySelector<HTMLElement>('.MuiDrawer-paper');
    if (!paper) throw new Error('no drawer paper rendered');
    await waitFor(() => expect(screen.getByText('First drawer action')).toHaveFocus());
    await waitFor(() => expect(paper.contains(document.activeElement)).toBe(true));
  });

  it('falls back to the drawer paper itself when nothing inside is focusable', async () => {
    const { rerender } = render(
      <Dialog open={false} variant="drawer" transitionDuration={0}>
        <DialogContent>Nothing focusable in here.</DialogContent>
      </Dialog>,
    );
    rerender(
      <Dialog open variant="drawer" transitionDuration={0}>
        <DialogContent>Nothing focusable in here.</DialogContent>
      </Dialog>,
    );

    const paper = document.querySelector<HTMLElement>('.MuiDrawer-paper');
    if (!paper) throw new Error('no drawer paper rendered');
    await waitFor(() => expect(paper).toHaveFocus());
    expect(paper).toHaveAttribute('tabindex', '-1');
  });
});
