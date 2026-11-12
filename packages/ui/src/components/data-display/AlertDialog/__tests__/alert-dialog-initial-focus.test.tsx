/**
 * Where focus lands when the dialog opens: on the safe answer.
 *
 * `autoFocus` on a button only runs when the button first mounts. Under React's
 * StrictMode (every dev server) the dialog's tree is mounted, torn down and
 * mounted again, and the focus trap's cleanup then hands focus back to the
 * opener while the remounted button is never autofocused: focus ended on the
 * dialog's container and Enter did nothing. The footer now focuses its button
 * in an effect, which StrictMode runs again.
 */
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { AlertDialog } from '../AlertDialog';
import type { AlertDialogProps } from '../AlertDialog.types';

afterEach(cleanup);

function Opener(props: Partial<AlertDialogProps>): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" data-testid="opener" onClick={() => setOpen(true)}>
        open
      </button>
      <AlertDialog
        open={open}
        title="Descartar?"
        confirmText="Descartar"
        cancelText="Continuar"
        data-testid="d"
        onClose={() => setOpen(false)}
        {...props}
      />
    </>
  );
}

async function openIn(strict: boolean, props: Partial<AlertDialogProps>): Promise<void> {
  const tree = <Opener {...props} />;
  render(strict ? <React.StrictMode>{tree}</React.StrictMode> : tree);
  screen.getByTestId('opener').focus();
  screen.getByTestId('opener').click();
  await screen.findByTestId('d-actions');
}

describe.each([
  ['plain React', false],
  ['StrictMode', true],
])('AlertDialog initial focus, %s', (_name, strict) => {
  it('focuses the emphasised cancel when emphasis is cancel', async () => {
    await openIn(strict, { emphasis: 'cancel' });

    expect(screen.getByTestId('d-cancel-button')).toHaveFocus();
  });

  it('focuses the confirm by default', async () => {
    await openIn(strict, {});

    expect(screen.getByTestId('d-confirm-button')).toHaveFocus();
  });

  it('lets initialFocus override the emphasis', async () => {
    await openIn(strict, { emphasis: 'cancel', initialFocus: 'confirm' });

    expect(screen.getByTestId('d-confirm-button')).toHaveFocus();
  });
});
