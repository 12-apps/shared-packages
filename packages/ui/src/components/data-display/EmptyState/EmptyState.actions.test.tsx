import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { EmptyState } from './EmptyState';

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
});
