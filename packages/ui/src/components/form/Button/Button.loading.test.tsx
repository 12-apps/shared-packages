import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { Button } from './Button';

describe('Button (web) — loading keeps the name (FUT-3646)', () => {
  // FUT-3646: the spinner used to REPLACE the label, so a loading button had no
  // accessible name at all — a screen reader heard "button, dimmed".
  it('keeps its accessible name while loading, and says it is busy', () => {
    const { rerender } = render(<Button dataTestId="b">Salvar</Button>);
    expect(screen.getByRole('button', { name: 'Salvar' })).not.toHaveAttribute('aria-busy');
    rerender(
      <Button dataTestId="b" loading>
        Salvar
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Salvar' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
    expect(screen.getByTestId('b-loading')).toBeInTheDocument();
    // Transparent, not hidden: `visibility` or `display` would drop the name again.
    const label = screen.getByText('Salvar');
    expect(label).toHaveStyle({ opacity: '0' });
    expect(label).not.toHaveStyle({ visibility: 'hidden' });
  });

  it('lets an explicit aria-label name a loading button', () => {
    render(
      <Button loading aria-label="Salvando pedido">
        Salvar
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Salvando pedido' })).toHaveAttribute('aria-busy', 'true');
  });
});
