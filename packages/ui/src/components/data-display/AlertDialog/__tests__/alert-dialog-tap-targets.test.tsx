/**
 * Every control of the dialog is a 40px tap target (FUT-3269).
 *
 * MUI's medium button draws 37px and the small IconButton 34px — short of the
 * 40px floor the kit's own `Button` keeps, and flagged on a phone by the
 * consumer's quality run. The floor is in rem, so it grows with the reader's
 * font size like the rest of the dialog.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AlertDialog } from '../AlertDialog';

afterEach(cleanup);

function renderDialog(emphasis?: 'cancel'): void {
  render(
    <AlertDialog
      open
      variant="destructive"
      title="Cancelar o pedido?"
      confirmText="Cancelar pedido"
      cancelText="Voltar"
      data-testid="tap"
      {...(emphasis ? { emphasis } : {})}
    />,
  );
}

describe('AlertDialog tap targets', () => {
  it('gives both actions a 40px floor', () => {
    renderDialog();
    expect(getComputedStyle(screen.getByTestId('tap-cancel-button')).minHeight).toBe('2.5rem');
    expect(getComputedStyle(screen.getByTestId('tap-confirm-button')).minHeight).toBe('2.5rem');
  });

  it('keeps the floor when the actions fill the row (emphasis="cancel")', () => {
    renderDialog('cancel');
    expect(getComputedStyle(screen.getByTestId('tap-cancel-button')).minHeight).toBe('2.5rem');
    expect(getComputedStyle(screen.getByTestId('tap-confirm-button')).minHeight).toBe('2.5rem');
  });

  it('draws the close button 40px square', () => {
    renderDialog();
    const close = getComputedStyle(screen.getByTestId('tap-close-button'));
    expect(close.width).toBe('2.5rem');
    expect(close.height).toBe('2.5rem');
  });
});
