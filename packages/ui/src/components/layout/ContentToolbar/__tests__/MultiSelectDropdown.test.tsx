import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { MultiSelectDropdown } from '../MultiSelectDropdown';

const MANY_OPTIONS = [
  { value: 'bebidas', label: 'Bebidas' },
  { value: 'sobremesas', label: 'Sobremesas' },
  { value: 'lanches', label: 'Lanches' },
  { value: 'saladas', label: 'Saladas' },
  { value: 'massas', label: 'Massas' },
  { value: 'carnes', label: 'Carnes' },
  { value: 'peixes', label: 'Peixes' },
  { value: 'vegano', label: 'Vegano' },
  { value: 'infantil', label: 'Infantil' },
];

function open(): void {
  fireEvent.click(screen.getByTestId('cat'));
}

describe('MultiSelectDropdown search (FUT-169)', () => {
  it('auto-shows a search box for long lists and filters options case-insensitively', async () => {
    render(
      <MultiSelectDropdown
        label="Categoria"
        options={MANY_OPTIONS}
        selected={new Set<string>()}
        onToggle={vi.fn()}
        onClear={vi.fn()}
        searchPlaceholder="Buscar…"
        noResultsLabel="Nenhum resultado"
        data-testid="cat"
      />,
    );
    open();

    const search = await screen.findByTestId('cat-search');
    expect(screen.getByText('Lanches')).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'SOBRE' } });

    await waitFor(() => expect(screen.queryByText('Lanches')).not.toBeInTheDocument());
    expect(screen.getByText('Sobremesas')).toBeInTheDocument();
  });

  it('shows the empty state when nothing matches', async () => {
    render(
      <MultiSelectDropdown
        label="Categoria"
        options={MANY_OPTIONS}
        selected={new Set<string>()}
        onToggle={vi.fn()}
        onClear={vi.fn()}
        noResultsLabel="Nenhum resultado"
        data-testid="cat"
      />,
    );
    open();

    fireEvent.change(await screen.findByTestId('cat-search'), { target: { value: 'zzz' } });

    expect(await screen.findByTestId('cat-no-results')).toHaveTextContent('Nenhum resultado');
  });

  it('does NOT render a search box for short lists', async () => {
    render(
      <MultiSelectDropdown
        label="Ativo"
        options={[
          { value: 'sim', label: 'Sim' },
          { value: 'nao', label: 'Não' },
        ]}
        selected={new Set<string>()}
        onToggle={vi.fn()}
        onClear={vi.fn()}
        data-testid="cat"
      />,
    );
    open();

    // Presence evidence first (menu open), then assert the search box was never
    // rendered — wrapped in waitFor per the anti-flake rule.
    expect(await screen.findByText('Sim')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('cat-search')).not.toBeInTheDocument());
  });

  it('toggles a filtered option and keeps the menu open (search still visible)', async () => {
    const onToggle = vi.fn();
    render(
      <MultiSelectDropdown
        label="Categoria"
        options={MANY_OPTIONS}
        selected={new Set<string>()}
        onToggle={onToggle}
        onClear={vi.fn()}
        data-testid="cat"
      />,
    );
    open();

    const search = await screen.findByTestId('cat-search');
    fireEvent.change(search, { target: { value: 'peix' } });
    fireEvent.click(await screen.findByText('Peixes'));

    expect(onToggle).toHaveBeenCalledWith('peixes', true);
    // Multi-select: the menu stays open, so the search box is still mounted.
    expect(screen.getByTestId('cat-search')).toBeInTheDocument();
  });
});
