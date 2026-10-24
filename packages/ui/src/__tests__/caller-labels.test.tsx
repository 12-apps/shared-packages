/**
 * Every word the layout, navigation, utility and typography components used to
 * hard-code in English is now the caller's to replace, and the English one is
 * still what a caller that names nothing gets.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FilterTrigger, ViewSelector } from '../components/layout/ContentToolbar';
import { Dashboard } from '../components/layout/Dashboard';
import { CommandPalette } from '../components/navigation/CommandPalette';
import { NavigationMenu } from '../components/navigation/NavigationMenu';
import { Code } from '../components/typography/Code';
import { WorkflowStep } from '../components/utility/WorkflowStep';
import { EN_US_COMMAND_PALETTE_COPY } from '../en-US.navigation';
import { PT_BR_UI_LABELS } from '../pt-BR.labels';
import { PT_BR_COMMAND_PALETTE_COPY } from '../pt-BR.navigation';

afterEach(cleanup);

describe('ViewSelector labels', () => {
  const props = {
    cardSizeLabel: 'Tamanho',
    viewMode: 'grid' as const,
    onViewModeChange: vi.fn(),
    zoom: [50],
    onZoomChange: vi.fn(),
  };

  it('names the trigger and both options with the caller labels', () => {
    render(<ViewSelector {...props} gridViewLabel="Grade" listViewLabel="Lista" />);
    fireEvent.click(screen.getByRole('button', { name: 'Grade' }));
    expect(screen.getByTestId('view-mode-list')).toHaveTextContent('Lista');
  });

  it('keeps "Grid View" / "List View" when no labels are given', () => {
    render(<ViewSelector {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Grid View' }));
    expect(screen.getByTestId('view-mode-list')).toHaveTextContent('List View');
  });
});

describe('FilterTrigger labels', () => {
  it('names the toggle with the caller labels, open and closed', () => {
    const { rerender } = render(
      <FilterTrigger open={false} onOpenChange={vi.fn()} openFiltersLabel="Abrir filtros" closeFiltersLabel="Fechar filtros" />,
    );
    expect(screen.getByTestId('toggle-filters-btn')).toHaveAccessibleName('Abrir filtros');
    rerender(
      <FilterTrigger open onOpenChange={vi.fn()} openFiltersLabel="Abrir filtros" closeFiltersLabel="Fechar filtros" />,
    );
    expect(screen.getByTestId('toggle-filters-btn')).toHaveAccessibleName('Fechar filtros');
  });

  it('keeps "Open filters" / "Close filters" when no labels are given', () => {
    const { rerender } = render(<FilterTrigger open={false} onOpenChange={vi.fn()} />);
    expect(screen.getByTestId('toggle-filters-btn')).toHaveAccessibleName('Open filters');
    rerender(<FilterTrigger open onOpenChange={vi.fn()} />);
    expect(screen.getByTestId('toggle-filters-btn')).toHaveAccessibleName('Close filters');
  });
});

describe('Dashboard.Breadcrumb ariaLabel', () => {
  const items = [{ label: 'Início', href: '/' }, { label: 'Produtos' }];

  it('names the trail with the caller label', () => {
    render(
      <Dashboard>
        <Dashboard.Breadcrumb items={items} ariaLabel={PT_BR_UI_LABELS.dashboard.breadcrumb} />
      </Dashboard>,
    );
    expect(screen.getByRole('navigation', { name: 'Trilha de navegação' })).toBeInTheDocument();
  });

  it('keeps "breadcrumb" when no label is given', () => {
    render(
      <Dashboard>
        <Dashboard.Breadcrumb items={items} />
      </Dashboard>,
    );
    expect(screen.getByRole('navigation', { name: 'breadcrumb' })).toBeInTheDocument();
  });
});

describe('NavigationMenu collapseLabel', () => {
  const items = [{ id: 'a', label: 'Pedidos' }];

  it('prints the caller label on the collapse control', () => {
    render(<NavigationMenu items={items} variant="vertical" collapsible collapseLabel="Recolher" />);
    expect(screen.getByText('Recolher')).toBeInTheDocument();
  });

  it('keeps "Collapse" when no label is given', () => {
    render(<NavigationMenu items={items} variant="vertical" collapsible />);
    expect(screen.getByText('Collapse')).toBeInTheDocument();
  });

  it('names the expanded control by its visible text alone', () => {
    render(<NavigationMenu items={items} variant="vertical" collapsible />);
    expect(screen.getByRole('button', { name: 'Collapse' })).not.toHaveAttribute('aria-label');
  });

  it('names the icon-only control "Expand" when collapsed and no label is given', () => {
    render(<NavigationMenu items={items} variant="vertical" collapsible collapsed />);
    expect(screen.getByRole('button', { name: 'Expand' })).toBeInTheDocument();
  });

  it('names the icon-only control with the pt-BR labels when collapsed', () => {
    const { collapse, expand } = PT_BR_UI_LABELS.navigationMenu;
    render(
      <NavigationMenu items={items} variant="vertical" collapsible collapsed collapseLabel={collapse} expandLabel={expand} />,
    );
    expect(screen.getByRole('button', { name: 'Expandir' })).toBeInTheDocument();
  });

  it('names each collapsed item by its own label', () => {
    const rows = [
      { id: 'a', label: 'Pedidos', href: '#pedidos' },
      { id: 'b', label: 'Estoque', children: [{ id: 'b1', label: 'Itens', href: '#itens' }] },
    ];
    render(<NavigationMenu items={rows} variant="vertical" collapsible collapsed />);
    expect(screen.getByRole('link', { name: 'Pedidos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Estoque' })).toBeInTheDocument();
  });

  it('adds no aria-label to an expanded item, whose text already names it', () => {
    render(<NavigationMenu items={[{ id: 'a', label: 'Pedidos', href: '#pedidos' }]} variant="vertical" />);
    expect(screen.getByRole('link', { name: 'Pedidos' })).not.toHaveAttribute('aria-label');
  });
});

describe('CommandPalette optional copy keys', () => {
  // Two groups, so the group headers render: one named, one left to `general`.
  const commands = [
    { id: 'a', label: 'Abrir pedidos', action: vi.fn() },
    { id: 'b', label: 'Abrir caixa', category: 'Caixa', action: vi.fn() },
  ];

  it('reads the placeholder, group, count and empty state from the caller pack', () => {
    render(
      <CommandPalette
        open
        onClose={vi.fn()}
        commands={commands}
        copy={{
          ...EN_US_COMMAND_PALETTE_COPY,
          placeholder: 'Digite um comando',
          general: 'Geral',
          commandCount: (count) => `${count} comandos`,
          noCommandsFound: (query) => `Nada para "${query}"`,
        }}
      />,
    );
    const search = screen.getByPlaceholderText('Digite um comando');
    expect(screen.getByText('Geral')).toBeInTheDocument();
    expect(screen.getByText('2 comandos')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'zzzzzz' } });
    expect(screen.getByText('Nada para "zzzzzz"')).toBeInTheDocument();
  });

  it('keeps the English wording for a pack written before the keys existed', () => {
    const { execute, navigate, close, recent, tryAnotherTerm } = EN_US_COMMAND_PALETTE_COPY;
    render(
      <CommandPalette
        open
        onClose={vi.fn()}
        commands={commands}
        copy={{ execute, navigate, close, recent, tryAnotherTerm }}
      />,
    );
    expect(screen.getByPlaceholderText('Type a command or search...')).toBeInTheDocument();
    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.getByText('2 commands')).toBeInTheDocument();
  });

  it('counts one command in the singular with the pt-BR pack', () => {
    const one = [{ id: 'a', label: 'Abrir pedidos', action: vi.fn() }];
    render(<CommandPalette open onClose={vi.fn()} commands={one} copy={PT_BR_COMMAND_PALETTE_COPY} />);
    expect(screen.getByText('1 comando')).toBeInTheDocument();
  });

  it('counts several commands in the plural with the pt-BR pack', () => {
    render(<CommandPalette open onClose={vi.fn()} commands={commands} copy={PT_BR_COMMAND_PALETTE_COPY} />);
    expect(screen.getByText('2 comandos')).toBeInTheDocument();
  });

  it('keeps the English count byte for byte', () => {
    expect([0, 1, 2].map(EN_US_COMMAND_PALETTE_COPY.commandCount)).toEqual(['0 commands', '1 commands', '2 commands']);
  });
});

describe('WorkflowStep labels', () => {
  const steps = [
    { id: 'a', title: 'Carrinho', status: 'current' as const },
    { id: 'b', title: 'Entrega', status: 'pending' as const },
  ];

  it('names the indicators and the progressbar value with the caller labels', () => {
    render(<WorkflowStep steps={steps} currentStep={0} labels={PT_BR_UI_LABELS.workflowStep} data-testid="wf" />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuetext', 'Etapa 1 de 2: Carrinho');
    expect(screen.getByTestId('wf-indicator-1')).toHaveAttribute('aria-label', 'Etapa 2: Entrega');
  });

  it('keeps the English wording when no labels are given', () => {
    render(<WorkflowStep steps={steps} currentStep={0} data-testid="wf" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Step 1 of 2: Carrinho');
    expect(screen.getByTestId('wf-indicator-1')).toHaveAttribute('aria-label', 'Step 2: Entrega');
  });
});

describe('Code copy button labels', () => {
  it('titles the copy button with the caller label', () => {
    const { container } = render(
      <Code variant="block" copyable copyLabel="Copiar código" copiedLabel="Copiado!">
        npm i
      </Code>,
    );
    expect(within(container).getByRole('button', { name: 'Copiar código' })).toBeInTheDocument();
  });

  it('keeps "Copy code" when no label is given', () => {
    const { container } = render(
      <Code variant="block" copyable>
        npm i
      </Code>,
    );
    expect(within(container).getByRole('button', { name: 'Copy code' })).toBeInTheDocument();
  });
});
