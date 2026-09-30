/**
 * Which button is the primary one, and where it sits.
 *
 * `emphasis="cancel"` exists for the question whose confirm is the loss —
 * "discard what you wrote?" — so the filled button must be the one that keeps
 * the work, in the primary slot, while the confirm steps down to the neutral
 * outline — primary and neutral, whatever the variant. The default must stay
 * exactly what every existing dialog already draws.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AlertDialog } from '../AlertDialog';
import type { AlertDialogProps } from '../AlertDialog.types';

afterEach(cleanup);

const cancelButton = (): HTMLElement => screen.getByTestId('discard-cancel-button');
const confirmButton = (): HTMLElement => screen.getByTestId('discard-confirm-button');
const actionOrder = (): (string | null)[] =>
  Array.from(screen.getByTestId('discard-actions').children).map((child) =>
    child.getAttribute('data-testid'),
  );

function renderDialog(props: Partial<AlertDialogProps> = {}): void {
  render(
    <AlertDialog
      open
      variant="destructive"
      title="Descartar este pedido?"
      confirmText="Descartar"
      cancelText="Continuar anotando"
      data-testid="discard"
      {...props}
    />,
  );
}

describe('AlertDialog emphasis', () => {
  it('fills the confirm and puts it last by default', () => {
    renderDialog();

    expect(confirmButton()).toHaveClass('MuiButton-contained', 'MuiButton-colorError');
    expect(cancelButton()).toHaveClass('MuiButton-outlined', 'MuiButton-colorInherit');
    expect(actionOrder()).toEqual(['discard-cancel-button', 'discard-confirm-button']);
  });

  it('fills the cancel, puts it last and draws the destructive confirm neutral', () => {
    renderDialog({ emphasis: 'cancel' });

    expect(cancelButton()).toHaveClass('MuiButton-contained', 'MuiButton-colorPrimary');
    expect(confirmButton()).toHaveClass('MuiButton-outlined', 'MuiButton-colorInherit');
    expect(confirmButton()).not.toHaveClass('MuiButton-colorError');
    expect(actionOrder()).toEqual(['discard-confirm-button', 'discard-cancel-button']);
  });

  it('steps a default-variant confirm down to the same neutral outline', () => {
    renderDialog({ emphasis: 'cancel', variant: 'default' });

    expect(confirmButton()).toHaveClass('MuiButton-outlined', 'MuiButton-colorInherit');
  });

  it('keeps each callback on its own button when the emphasis moves', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderDialog({ emphasis: 'cancel', onConfirm, onCancel });

    fireEvent.click(cancelButton());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('still focuses the button initialFocus names, wherever it sits', async () => {
    renderDialog({ emphasis: 'cancel', initialFocus: 'cancel' });

    // MUI's focus trap moves focus after mount, so wait for it to land.
    await waitFor(() => expect(cancelButton()).toHaveFocus());
  });

  it('focuses the emphasised cancel when initialFocus is not given', async () => {
    renderDialog({ emphasis: 'cancel' });

    await waitFor(() => expect(cancelButton()).toHaveFocus());
  });

  it('keeps the confirm filled when the cancel it would defer to is hidden', () => {
    renderDialog({ emphasis: 'cancel', showCancel: false });

    // The whole row, so "no cancel" is read from what IS there — and a dialog
    // with no cancel still has a primary.
    expect(actionOrder()).toEqual(['discard-confirm-button']);
    expect(confirmButton()).toHaveClass('MuiButton-contained', 'MuiButton-colorError');
  });

  it('wraps whole buttons instead of breaking a label, without MUI spacing', () => {
    renderDialog({ emphasis: 'cancel' });

    const actions = screen.getByTestId('discard-actions');
    expect(getComputedStyle(actions).flexWrap).toBe('wrap-reverse');
    // MUI's spacing is a left margin on every button after the first, which
    // would indent a button that wrapped onto a line of its own.
    expect(actions).not.toHaveClass('MuiDialogActions-spacing');
  });

  it('grows the buttons to share the row only when cancel is emphasised', () => {
    renderDialog({ emphasis: 'cancel' });
    expect(getComputedStyle(cancelButton()).flexGrow).toBe('1');
    expect(getComputedStyle(confirmButton()).flexGrow).toBe('1');
    cleanup();

    // The default keeps every existing footer as it was: natural widths.
    renderDialog();
    expect(getComputedStyle(cancelButton()).flexGrow).not.toBe('1');
    expect(getComputedStyle(confirmButton()).flexGrow).not.toBe('1');
  });
});
