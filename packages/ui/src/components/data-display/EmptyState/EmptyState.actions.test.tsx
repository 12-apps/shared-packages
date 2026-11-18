import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { EmptyState } from './EmptyState';
import { Button } from '../../form/Button/Button';

describe('EmptyState actions', () => {
  it('draw as the house Button, never MUI uppercase', () => {
    render(
      <EmptyState
        variant="action"
        title="Nada"
        primaryAction={{ label: 'Ver o cardápio', onClick: () => undefined }}
        secondaryAction={{ label: 'Voltar', onClick: () => undefined }}
        dataTestId="es"
      />,
    );
    for (const id of ['es-primary-action', 'es-secondary-action']) {
      expect(screen.getByTestId(id)).toHaveStyle({ textTransform: 'none' });
    }
  });

  it('keep the house Button size, not a caller sx that replaces it', () => {
    render(
      <>
        <Button variant="solid" color="primary" size="md" data-testid="plain">
          Plain
        </Button>
        <EmptyState
          variant="action"
          title="Nada"
          primaryAction={{ label: 'Ver o cardápio', onClick: () => undefined }}
          dataTestId="es"
        />
      </>,
    );
    const plain = getComputedStyle(screen.getByTestId('plain'));
    const action = getComputedStyle(screen.getByTestId('es-primary-action'));
    expect(plain.minHeight).not.toBe('');
    expect(action.minHeight).toBe(plain.minHeight);
    expect(action.fontSize).toBe(plain.fontSize);
    expect(action.paddingLeft).toBe(plain.paddingLeft);
  });
});
