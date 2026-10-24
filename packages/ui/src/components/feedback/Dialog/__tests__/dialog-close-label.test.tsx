/**
 * The close button's accessible name is the caller's (FUT-3860).
 *
 * It was the literal "close" with no prop to replace it, so a pt-BR screen
 * announced an English word on every dialog.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Dialog, DialogHeader } from '../index';

afterEach(cleanup);

describe('Dialog close label (web)', () => {
  it('names the button with the caller label', () => {
    render(
      <Dialog open title="T" closeLabel="Fechar" onClose={vi.fn()} dataTestId="d">
        body
      </Dialog>,
    );
    expect(screen.getByRole('button', { name: 'Fechar' })).toBe(screen.getByTestId('d-close'));
  });

  it('defaults to "close", as it always read', () => {
    render(
      <Dialog open title="T" onClose={vi.fn()} dataTestId="d">
        body
      </Dialog>,
    );
    expect(screen.getByTestId('d-close')).toHaveAccessibleName('close');
  });

  it('reaches the button through a standalone DialogHeader', () => {
    render(<DialogHeader title="T" closeLabel="Fechar" onClose={vi.fn()} dataTestId="h" />);
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeInTheDocument();
  });
});
