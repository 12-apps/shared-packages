/**
 * `<Dashboard.Actions>` is the plural of `<Dashboard.Action>`, and the two
 * things worth pinning are the ones a thin wrapper is most likely to lose: the
 * header still ranks it into the header slot, and the test ids come from the
 * Dashboard's OWN prefix rather than the component's default.
 */
import AddIcon from '@mui/icons-material/Add';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Dashboard } from '../Dashboard';

const MORE = 'Mais ações';

const NEW = { id: 'new-thing', text: 'Novo', icon: <AddIcon fontSize="small" /> };

describe('Dashboard.Actions', () => {
  it('renders the declared actions inside the header row', () => {
    render(
      <Dashboard>
        <Dashboard.Header title="Produtos">
          <Dashboard.Spacer />
          <Dashboard.Actions moreLabel={MORE} actions={[NEW]} />
        </Dashboard.Header>
      </Dashboard>,
    );

    const header = screen.getByTestId('dashboard-header');
    expect(header.contains(screen.getByTestId('new-thing'))).toBe(true);
  });

  it('takes its overflow ids from the Dashboard prefix, not the component default', () => {
    render(
      <Dashboard testIdPrefix="produtos">
        <Dashboard.Header title="Produtos">
          <Dashboard.Actions
            moreLabel={MORE}
            actions={[NEW, { id: 'export', text: 'Exportar', icon: <AddIcon fontSize="small" /> }]}
          />
        </Dashboard.Header>
      </Dashboard>,
    );

    expect(screen.getByTestId('produtos-actions-more-trigger')).toBeTruthy();
    // The standalone default would have been `header-actions-…`; one page must
    // not answer to two names for the same control.
    expect(screen.queryAllByTestId('header-actions-more-trigger')).toEqual([]);
  });

  it('renders nothing when every action is gated away, and no empty row', () => {
    render(
      <Dashboard>
        <Dashboard.Header title="Produtos">
          <Dashboard.Actions moreLabel={MORE} actions={[{ ...NEW, visible: false }]} />
        </Dashboard.Header>
      </Dashboard>,
    );

    expect(screen.queryAllByTestId('new-thing')).toEqual([]);
    expect(screen.queryAllByRole('button', { name: MORE })).toEqual([]);
  });

  it('runs an overflowed action picked from the menu', async () => {
    const onExport = vi.fn();
    render(
      <Dashboard>
        <Dashboard.Header title="Produtos">
          <Dashboard.Actions
            moreLabel={MORE}
            actions={[NEW, { id: 'export', text: 'Exportar', icon: <AddIcon fontSize="small" />, onClick: onExport }]}
          />
        </Dashboard.Header>
      </Dashboard>,
    );

    fireEvent.click(screen.getByRole('button', { name: MORE }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Exportar' }));

    expect(onExport).toHaveBeenCalledTimes(1);
  });
});
