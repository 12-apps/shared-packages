/**
 * Which button is the primary one, and where it sits.
 *
 * `emphasis="cancel"` exists for the question whose confirm is the loss —
 * "discard what you wrote?" — so the filled button must be the one that keeps
 * the work, in the primary slot, while the confirm steps down to the neutral
 * outline — primary and neutral, whatever the variant. The default must stay
 * exactly what every existing dialog already draws.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

  it('still focuses the button initialFocus names, wherever it sits', () => {
    renderDialog({ emphasis: 'cancel', initialFocus: 'cancel' });

    expect(cancelButton()).toHaveFocus();
  });

  it('renders the confirm alone, as an outline, when the cancel is hidden', () => {
    renderDialog({ emphasis: 'cancel', showCancel: false });

    expect(screen.queryByTestId('discard-cancel-button')).toBeNull();
    expect(actionOrder()).toEqual(['discard-confirm-button']);
  });

  it('wraps whole buttons instead of breaking a label', () => {
    renderDialog({ emphasis: 'cancel' });

    const actions = getComputedStyle(screen.getByTestId('discard-actions'));
    expect(actions.flexWrap).toBe('wrap-reverse');
    // MUI's per-button left margin would indent a button that wrapped alone.
    expect(getComputedStyle(confirmButton()).marginLeft).not.toBe('8px');
  });
});
