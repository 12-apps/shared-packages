/**
 * The words the widened literal-copy gate found written into components
 * (FUT-3860) are now the caller's to replace. What a caller that names
 * nothing gets is unchanged, byte for byte: English stays English, and the
 * two defaults that were Portuguese (`FilterTrigger`'s label, `AppHeader`'s
 * disclosure) stay Portuguese, read from the pt-BR pack.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DataViewsCopyProvider } from '../components/data-display/DataViews';
import { DeleteViewDialog } from '../components/data-display/DataViews/DeleteViewDialog';
import type { SavedViewSummary } from '../components/data-display/DataViews/data-views-types';
import { LoadingState } from '../components/data-display/LoadingState';
import { FilterTrigger } from '../components/layout/ContentToolbar';
import { SettingsLayout } from '../components/layout/SettingsLayout';
import { InfiniteScroll } from '../components/utility/InfiniteScroll';
import { EN_US_DATA_VIEWS_COPY } from '../en-US.data-display';
import { EN_US_UI_LABELS } from '../en-US.labels';
import { PT_BR_DATA_VIEWS_COPY } from '../pt-BR.data-display';
import { PT_BR_UI_LABELS } from '../pt-BR.labels';
import { SocialLoginContainer } from '../social-login-button';

afterEach(cleanup);

describe('the en-US labels a caller that names nothing gets', () => {
  it('are the English the components rendered before, byte for byte', () => {
    expect(EN_US_UI_LABELS.alertDialog).toEqual({ cancel: 'Cancel', confirm: 'Confirm' });
    expect(EN_US_UI_LABELS.emptyState).toEqual({ refresh: 'Refresh', create: 'Create New' });
    expect(EN_US_UI_LABELS.loadingState).toEqual({ skeleton: 'Loading content', spinner: 'Loading' });
    expect(EN_US_UI_LABELS.command).toEqual({
      placeholder: 'Type a command or search...',
      empty: 'No results found',
      loading: 'Loading...',
    });
    expect(EN_US_UI_LABELS.settingsLayout).toEqual({
      navigation: 'Settings',
      searchPlaceholder: 'Search settings',
      emptySearch: 'No settings match your search.',
      back: 'Back',
    });
    expect(EN_US_UI_LABELS.breadcrumbs.navigation).toBe('breadcrumb navigation');
    expect(EN_US_UI_LABELS.animatedIcon.name('heart')).toBe('Animated heart icon');
    expect(EN_US_UI_LABELS.socialLogin).toEqual({ title: 'Sign in to continue', divider: 'or' });
  });

  it('keep the two Portuguese defaults Portuguese in the pt-BR pack', () => {
    expect(PT_BR_UI_LABELS.contentToolbar.filters).toBe('Filtros');
    expect(PT_BR_UI_LABELS.appHeader.disclose('Future Drink')).toBe('Detalhes de Future Drink');
  });
});

describe('FilterTrigger label', () => {
  it('prints the caller label', () => {
    render(<FilterTrigger open={false} onOpenChange={vi.fn()} label={EN_US_UI_LABELS.contentToolbar.filters} />);
    expect(screen.getByTestId('toggle-filters-btn')).toHaveTextContent('Filters');
  });

  it('keeps "Filtros" when no label is given', () => {
    render(<FilterTrigger open={false} onOpenChange={vi.fn()} />);
    expect(screen.getByTestId('toggle-filters-btn')).toHaveTextContent('Filtros');
  });
});

describe('LoadingState labels', () => {
  it('names the spinner with the caller label', () => {
    render(<LoadingState variant="spinner" labels={PT_BR_UI_LABELS.loadingState} />);
    expect(screen.getByRole('status')).toHaveAccessibleName(PT_BR_UI_LABELS.loadingState.spinner);
  });

  it('keeps "Loading" when no label is given', () => {
    render(<LoadingState variant="spinner" />);
    expect(screen.getByRole('status')).toHaveAccessibleName('Loading');
  });
});

describe('SettingsLayout navigationLabel', () => {
  const groups = [{ id: 'g', label: 'Loja', items: [{ id: 'a', label: 'Geral' }] }];

  it('names the navigation with the caller label when the title is not text', () => {
    render(
      <SettingsLayout title={<span>Configuração</span>} groups={groups} navigationLabel="Configurações">
        <p>painel</p>
      </SettingsLayout>,
    );
    expect(screen.getByTestId('settings-rail')).toHaveAccessibleName('Configurações');
  });

  it('keeps "Settings" when no label is given', () => {
    render(
      <SettingsLayout title={<span>Configuração</span>} groups={groups}>
        <p>painel</p>
      </SettingsLayout>,
    );
    expect(screen.getByTestId('settings-rail')).toHaveAccessibleName('Settings');
  });

  it('lets a plain-string title name it, whatever the label says', () => {
    render(
      <SettingsLayout title="Configuração" groups={groups} navigationLabel="Configurações">
        <p>painel</p>
      </SettingsLayout>,
    );
    expect(screen.getByTestId('settings-rail')).toHaveAccessibleName('Configuração');
  });
});

describe('InfiniteScroll errorText', () => {
  const props = { loadingText: 'Carregando', endText: 'Fim', hasMore: true, loading: false, loadMore: vi.fn() };

  it('reads the caller sentence when the error carries no message', () => {
    render(
      <InfiniteScroll {...props} error={new Error('')} errorText={PT_BR_UI_LABELS.infiniteScroll.loadFailed}>
        <p>linhas</p>
      </InfiniteScroll>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(PT_BR_UI_LABELS.infiniteScroll.loadFailed);
  });

  it('keeps the English sentence when none is given', () => {
    render(
      <InfiniteScroll {...props} error={new Error('')}>
        <p>rows</p>
      </InfiniteScroll>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('An error occurred while loading more items');
  });
});

describe('SocialLoginContainer defaults', () => {
  it('keeps "Sign in to continue" and "or" when the caller names neither', () => {
    render(
      <SocialLoginContainer showDivider>
        <span />
      </SocialLoginContainer>,
    );
    expect(screen.getByText('Sign in to continue')).toBeInTheDocument();
    expect(screen.getByText('or')).toBeInTheDocument();
  });

  it('prints the caller words from the pt-BR pack', () => {
    render(
      <SocialLoginContainer
        showDivider
        title={PT_BR_UI_LABELS.socialLogin.title}
        dividerText={PT_BR_UI_LABELS.socialLogin.divider}
      >
        <span />
      </SocialLoginContainer>,
    );
    expect(screen.getByText('Entre para continuar')).toBeInTheDocument();
    expect(screen.getByText('ou')).toBeInTheDocument();
  });
});

describe("DeleteViewDialog's noun for the rows", () => {
  const view: SavedViewSummary = {
    id: 'v1',
    name: 'Atrasados',
    description: null,
    state: {} as SavedViewSummary['state'],
    shared: false,
    pinned: false,
    isDefault: false,
    isOwner: true,
  };

  it('reads the pack fallback when the table names no noun', () => {
    render(
      <DataViewsCopyProvider copy={EN_US_DATA_VIEWS_COPY}>
        <DeleteViewDialog view={view} onClose={vi.fn()} onConfirm={vi.fn()} />
      </DataViewsCopyProvider>,
    );
    expect(screen.getByText(/^The records are not affected/)).toBeInTheDocument();
  });

  it('keeps "Os registros" with the pt-BR pack, as it always read', () => {
    render(
      <DataViewsCopyProvider copy={PT_BR_DATA_VIEWS_COPY}>
        <DeleteViewDialog view={view} onClose={vi.fn()} onConfirm={vi.fn()} />
      </DataViewsCopyProvider>,
    );
    expect(screen.getByText(/^Os registros/)).toBeInTheDocument();
  });
});
