/**
 * The safety contract, asserted at the surface an operator actually touches.
 *
 * Every case here is a way the guard could fail OPEN — the write leaving before
 * anyone confirmed it, or leaving twice. A confirmation that merely renders is
 * worth nothing; what matters is that nothing happens until the confirm button
 * is pressed, and that it then happens exactly once.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Button } from '../../../form/Button';
import { PT_BR_CONFIRM_ACTION_COPY } from '../../../../pt-BR';
import { ConfirmAction, withConfirmation } from '../index';

afterEach(cleanup);

const OPTIONS = {
  title: 'Excluir a categoria?',
  description: 'Ela vai para a lixeira e pode ser restaurada de lá.',
  confirmText: 'Excluir',
  errorText: 'Não foi possível excluir.',
  copy: PT_BR_CONFIRM_ACTION_COPY,
};

/** The dialog's buttons, by the test ids `AlertDialog` derives from ours. */
const confirmButton = (): HTMLElement => screen.getByTestId('confirm-action-confirm-button');
const cancelButton = (): HTMLElement => screen.getByTestId('confirm-action-cancel-button');
const trigger = (): HTMLElement => screen.getByRole('button', { name: 'Excluir' });

function renderConfirmAction(
  onConfirm: () => void | Promise<unknown>,
  options: Record<string, unknown> = {},
): void {
  render(
    <ConfirmAction {...OPTIONS} {...options} onConfirm={onConfirm}>
      {(request) => (
        <button type="button" onClick={request}>
          Excluir
        </button>
      )}
    </ConfirmAction>,
  );
}

describe('ConfirmAction', () => {
  it('opens the popup without running the action', () => {
    const onConfirm = vi.fn();
    renderConfirmAction(onConfirm);

    fireEvent.click(trigger());

    expect(screen.getByText('Excluir a categoria?')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  /**
   * The dismiss button's word comes from the COPY the caller was made to
   * supply — not from `AlertDialog`'s own default, which is English.
   *
   * This is the regression the required-copy sweep itself introduced: the
   * component's `cancelText = 'Cancelar'` default was deleted and the word
   * moved into `ConfirmActionCopy`, where nothing read it. A pt-BR host that
   * dutifully passed the pack still got `Cancel` in every confirmation that
   * named no `cancelText` of its own — which is most of them, including both
   * CardKit hooks.
   */
  it('takes the dismiss button from the copy it was given', () => {
    renderConfirmAction(vi.fn());

    fireEvent.click(trigger());

    expect(cancelButton()).toHaveTextContent(PT_BR_CONFIRM_ACTION_COPY.cancel);
  });

  /** An explicit `cancelText` still wins — the copy is the fallback, not a lock. */
  it('lets a call site override the dismiss button', () => {
    renderConfirmAction(vi.fn(), { cancelText: 'Manter o insumo' });

    fireEvent.click(trigger());

    expect(cancelButton()).toHaveTextContent('Manter o insumo');
  });

  it('runs nothing when the operator cancels', async () => {
    const onConfirm = vi.fn();
    renderConfirmAction(onConfirm);

    fireEvent.click(trigger());
    fireEvent.click(cancelButton());

    expect(onConfirm).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByText('Excluir a categoria?')).not.toBeInTheDocument();
    });
  });

  it('runs the action once the operator confirms', async () => {
    const onConfirm = vi.fn();
    renderConfirmAction(onConfirm);

    fireEvent.click(trigger());
    fireEvent.click(confirmButton());

    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByText('Excluir a categoria?')).not.toBeInTheDocument();
    });
  });

  it('sends one write when the confirm button is double-clicked', () => {
    // The write is held open so both clicks land inside the in-flight window —
    // the exact race a bare onClick would turn into two DELETEs. The resolver
    // lives on a container because the flakiness gate forbids reassigning a
    // closed-over binding from inside a stub.
    const inFlight: { resolve: () => void } = { resolve: () => undefined };
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          inFlight.resolve = resolve;
        }),
    );
    renderConfirmAction(onConfirm);

    fireEvent.click(trigger());
    fireEvent.click(confirmButton());
    fireEvent.click(confirmButton());

    expect(onConfirm).toHaveBeenCalledTimes(1);
    inFlight.resolve();
  });

  it('disables the confirm while the write is in flight', async () => {
    const inFlight: { resolve: () => void } = { resolve: () => undefined };
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          inFlight.resolve = resolve;
        }),
    );
    renderConfirmAction(onConfirm);

    fireEvent.click(trigger());
    fireEvent.click(confirmButton());

    await waitFor(() => {
      expect(confirmButton()).toBeDisabled();
    });
    inFlight.resolve();
  });

  it('keeps the popup open, carrying the error, when the action fails', async () => {
    // The server's sentence is the one the operator can act on, so a rejection
    // carrying a message beats the generic fallback.
    const onConfirm = vi.fn(() =>
      Promise.reject(new Error('Esta categoria ainda tem produtos vinculados.')),
    );
    renderConfirmAction(onConfirm);

    fireEvent.click(trigger());
    fireEvent.click(confirmButton());

    await waitFor(() => {
      expect(screen.getByTestId('confirm-action-error')).toHaveTextContent(
        'Esta categoria ainda tem produtos vinculados.',
      );
    });
    expect(screen.getByText('Excluir a categoria?')).toBeInTheDocument();
  });

  it('falls back to the configured wording when the rejection says nothing', async () => {
    const onConfirm = vi.fn(() => Promise.reject(new Error('')));
    renderConfirmAction(onConfirm, { errorText: 'Não foi possível excluir a categoria.' });

    fireEvent.click(trigger());
    fireEvent.click(confirmButton());

    await waitFor(() => {
      expect(screen.getByTestId('confirm-action-error')).toHaveTextContent(
        'Não foi possível excluir a categoria.',
      );
    });
  });

  it('recovers from a failure: a second confirm can still run', async () => {
    // `busy` must be released on the failure path too, or the popup is left
    // holding an error it can never be retried out of.
    const attempts = { count: 0 };
    const onConfirm = vi.fn(() => {
      attempts.count += 1;
      return attempts.count === 1 ? Promise.reject(new Error('rede')) : Promise.resolve();
    });
    renderConfirmAction(onConfirm);

    fireEvent.click(trigger());
    fireEvent.click(confirmButton());
    await waitFor(() => {
      expect(screen.getByTestId('confirm-action-error')).toBeInTheDocument();
    });

    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(screen.queryByText('Excluir a categoria?')).not.toBeInTheDocument();
    });
  });

  it('announces as an alertdialog named by its title and described by its body', () => {
    // `alertdialog`, not `dialog`: this interrupts what the operator was doing
    // and will not go away until answered, which is what makes a screen reader
    // read the message out on open instead of just the dialog's name. MUI
    // hardcodes role="dialog", so the override has to keep working.
    renderConfirmAction(vi.fn());
    fireEvent.click(trigger());

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAccessibleName('Excluir a categoria?');
    expect(dialog).toHaveAccessibleDescription(
      /Ela vai para a lixeira e pode ser restaurada de lá./,
    );
  });

  it('opens with focus on Cancel, so a stray Enter cannot delete', async () => {
    renderConfirmAction(vi.fn());

    fireEvent.click(trigger());

    await waitFor(() => {
      expect(cancelButton()).toHaveFocus();
    });
  });

  it('holds the confirm disabled until the exact text is typed', async () => {
    const onConfirm = vi.fn();
    renderConfirmAction(onConfirm, { typeToConfirm: 'Bebidas' });

    fireEvent.click(trigger());
    const field = screen.getByTestId('confirm-action-type-to-confirm');
    expect(confirmButton()).toBeDisabled();

    fireEvent.change(field, { target: { value: 'Bebida' } });
    expect(confirmButton()).toBeDisabled();

    fireEvent.change(field, { target: { value: 'Bebidas' } });
    expect(confirmButton()).toBeEnabled();

    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByText('Excluir a categoria?')).not.toBeInTheDocument();
    });
  });

  it('starts each open from an empty type-to-confirm field', async () => {
    renderConfirmAction(vi.fn(), { typeToConfirm: 'Bebidas' });

    fireEvent.click(trigger());
    fireEvent.change(screen.getByTestId('confirm-action-type-to-confirm'), {
      target: { value: 'Bebidas' },
    });
    fireEvent.click(cancelButton());
    await waitFor(() => {
      expect(screen.queryByText('Excluir a categoria?')).not.toBeInTheDocument();
    });

    fireEvent.click(trigger());
    expect(screen.getByTestId('confirm-action-type-to-confirm')).toHaveValue('');
    expect(confirmButton()).toBeDisabled();
  });
});

describe('withConfirmation', () => {
  const ConfirmButton = withConfirmation(Button, {
    errorText: 'Não foi possível excluir.',
    copy: PT_BR_CONFIRM_ACTION_COPY,
  });

  it("guards the wrapped component's own onClick", async () => {
    const onClick = vi.fn();
    render(
      <ConfirmButton onClick={onClick} confirm={OPTIONS}>
        Excluir
      </ConfirmButton>,
    );

    fireEvent.click(trigger());
    expect(onClick).not.toHaveBeenCalled();

    fireEvent.click(confirmButton());
    expect(onClick).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByText('Excluir a categoria?')).not.toBeInTheDocument();
    });
  });

  it('falls through to the plain component when confirm is false', () => {
    const onClick = vi.fn();
    render(
      <ConfirmButton onClick={onClick} confirm={false}>
        Excluir
      </ConfirmButton>,
    );

    fireEvent.click(trigger());

    expect(onClick).toHaveBeenCalledTimes(1);
    // A COUNT rather than an absence assertion: the popup was never rendered
    // here, so there is no prior presence to wait for — which is exactly the
    // distinction the flakiness rule exists to enforce.
    expect(screen.queryAllByTestId('confirm-action')).toHaveLength(0);
  });

  it('does not leak its own confirm prop onto the DOM node', () => {
    render(
      <ConfirmButton onClick={vi.fn()} confirm={OPTIONS}>
        Excluir
      </ConfirmButton>,
    );

    expect(trigger()).not.toHaveAttribute('confirm');
  });
});
