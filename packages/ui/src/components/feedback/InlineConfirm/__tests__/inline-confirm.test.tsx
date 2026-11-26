/**
 * InlineConfirm's contract, at the surface a reader touches: drawn in place
 * (no portal, no dialog), nothing runs before the verb, one write per
 * confirmation, a failure kept open with its sentence, focus starting on the
 * safe button and handed back on cancel, and Escape backing out.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InlineConfirm } from '../index';

afterEach(cleanup);

const WORDS = {
  title: 'Remover Joaquim da fila?',
  description: 'Sai do 2º lugar e quem está atrás sobe.',
  irreversibleNote: 'Não dá para desfazer.',
  confirmText: 'Remover da fila',
  cancelText: 'Manter',
  errorText: 'Não foi possível remover.',
};

/** A row with its trigger, as a list draws it. */
function Row({ onConfirm, onCancel = () => undefined }: { onConfirm: () => void | Promise<unknown>; onCancel?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <ul>
      <li data-testid="row">
        <span>Joaquim Prado</span>
        {/* Focused on mount, as a trigger is when the reader taps it. */}
        <button type="button" autoFocus onClick={() => setOpen(true)}>
          Abrir
        </button>
        <InlineConfirm
          {...WORDS}
          open={open}
          onConfirm={onConfirm}
          onCancel={() => {
            onCancel();
            setOpen(false);
          }}
        />
      </li>
    </ul>
  );
}

const confirmButton = (): HTMLElement => screen.getByTestId('inline-confirm-confirm');
const cancelButton = (): HTMLElement => screen.getByTestId('inline-confirm-cancel');

describe('InlineConfirm', () => {
  it('renders nothing while closed', async () => {
    render(<Row onConfirm={vi.fn()} />);

    expect(screen.getByTestId('row')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('inline-confirm')).toBeNull());
  });

  it('draws in place, inside the row, with the question, the body, the note apart and both buttons', async () => {
    render(<Row onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));

    const group = screen.getByRole('group', { name: WORDS.title });
    expect(screen.getByTestId('row')).toContainElement(group);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(group).toHaveTextContent(WORDS.description);
    expect(screen.getByTestId('inline-confirm-irreversible')).toHaveTextContent(WORDS.irreversibleNote);
    expect(confirmButton()).toHaveTextContent(WORDS.confirmText);
    expect(cancelButton()).toHaveTextContent(WORDS.cancelText);
  });

  it('runs nothing on opening, and focuses the safe button', async () => {
    const onConfirm = vi.fn();
    render(<Row onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));

    expect(onConfirm).not.toHaveBeenCalled();
    await waitFor(() => expect(cancelButton()).toHaveFocus());
  });

  it('keeps the cancel first in the tab order', () => {
    render(<Row onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));

    const buttons = Array.from(screen.getByRole('group', { name: WORDS.title }).querySelectorAll('button'));
    expect(buttons.map((button) => button.textContent)).toEqual([WORDS.cancelText, WORDS.confirmText]);
  });

  it('cancel backs out and hands focus back to the trigger', async () => {
    const onCancel = vi.fn();
    render(<Row onConfirm={vi.fn()} onCancel={onCancel} />);
    const trigger = screen.getByRole('button', { name: 'Abrir' });
    await waitFor(() => expect(trigger).toHaveFocus());
    fireEvent.click(trigger);

    fireEvent.click(cancelButton());

    expect(onCancel).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('Escape backs out like the cancel', async () => {
    const onCancel = vi.fn();
    render(<Row onConfirm={vi.fn()} onCancel={onCancel} />);
    const trigger = screen.getByRole('button', { name: 'Abrir' });
    await waitFor(() => expect(trigger).toHaveFocus());
    fireEvent.click(trigger);

    fireEvent.keyDown(cancelButton(), { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('sends one write per confirmation, however often the verb is pressed', async () => {
    // A write that never answers: the confirmation stays pending for the whole case.
    const onConfirm = vi.fn(() => new Promise<void>(() => undefined));
    render(<Row onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));

    fireEvent.click(confirmButton());
    fireEvent.click(confirmButton());

    fireEvent.click(confirmButton());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });

  it('keeps a failure open, with the rejection\'s own sentence, and lets the reader try again', async () => {
    const onConfirm = vi.fn().mockRejectedValueOnce(new Error('Esse cliente já saiu da fila.')).mockResolvedValueOnce(undefined);
    render(<Row onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));

    fireEvent.click(confirmButton());

    expect(await screen.findByTestId('inline-confirm-error')).toHaveTextContent('Esse cliente já saiu da fila.');
    fireEvent.click(confirmButton());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2));
  });

  it('falls back to errorText for a rejection with no message', async () => {
    render(<Row onConfirm={() => Promise.reject(new Error(''))} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));

    fireEvent.click(confirmButton());

    expect(await screen.findByTestId('inline-confirm-error')).toHaveTextContent(WORDS.errorText);
  });

  it('ignores Escape and the cancel while the write is out', async () => {
    const onCancel = vi.fn();
    render(<Row onCancel={onCancel} onConfirm={() => new Promise<void>(() => undefined)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    fireEvent.click(confirmButton());

    fireEvent.keyDown(confirmButton(), { key: 'Escape' });

    expect(onCancel).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('inline-confirm')).toBeInTheDocument());
  });
});
