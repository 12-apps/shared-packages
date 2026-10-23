/**
 * FUT-3905: the typed word matches whatever its case. A phone capitalises the
 * first letter ("Confirmar"), and the owner wants the pause, not a spelling
 * test — so the gate opens on any case and stays shut on any other word.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PT_BR_CONFIRM_ACTION_COPY } from '../../../../pt-BR';
import { ConfirmAction } from '../index';
import { typedMatches } from '../ConfirmAction.parts';

afterEach(cleanup);

function openWith(word: string): void {
  render(
    <ConfirmAction
      title="Cancelar o pedido?"
      description="O pedido sai da fila."
      confirmText="Cancelar pedido"
      errorText="Não foi possível cancelar."
      copy={PT_BR_CONFIRM_ACTION_COPY}
      typeToConfirm={word}
      onConfirm={vi.fn()}
    >
      {(request) => (
        <button type="button" onClick={request}>
          Abrir
        </button>
      )}
    </ConfirmAction>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
}

const confirmButton = (): HTMLElement => screen.getByTestId('confirm-action-confirm-button');
const field = (): HTMLElement => screen.getByTestId('confirm-action-type-to-confirm');

describe('typedMatches', () => {
  it('ignores case and surrounding whitespace', () => {
    for (const typed of ['confirmar', 'Confirmar', 'CONFIRMAR', '  Confirmar ']) {
      expect(typedMatches(typed, 'confirmar')).toBe(true);
    }
  });

  it('still refuses another word', () => {
    for (const typed of ['confirma', 'confirmar x', '', 'confirmação']) {
      expect(typedMatches(typed, 'confirmar')).toBe(false);
    }
  });
});

describe('ConfirmAction type-to-confirm, on a phone', () => {
  it('opens on the capital C a phone types', () => {
    openWith('confirmar');
    expect(confirmButton()).toBeDisabled();
    fireEvent.change(field(), { target: { value: 'Confirmar' } });
    expect(confirmButton()).toBeEnabled();
  });

  it('asks the phone not to capitalise or correct the word', () => {
    openWith('confirmar');
    expect(field()).toHaveAttribute('autocapitalize', 'none');
    expect(field()).toHaveAttribute('autocorrect', 'off');
    expect(field()).toHaveAttribute('spellcheck', 'false');
  });
});
