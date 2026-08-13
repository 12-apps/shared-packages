// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWebEntityLifecycle } from '../create-web-entity-lifecycle';
import type { LifecycleResult, LifecycleTransport } from '../transport';

/**
 * The web factory over a fake transport (12-17): the screens are proven for
 * real in the harness (published tarball, real socket, real Postgres); what
 * this suite pins is the CONTRACT between the factory and its transport —
 * which paths the bound client hits, and that the ported test ids and pt-BR
 * copy survived the move.
 */

afterEach(cleanup);

interface Call {
  path: string;
  method: string;
  body?: unknown;
}

function fakeTransport(
  reads: Record<string, unknown>,
  writeResult: LifecycleResult<unknown> = { ok: true, data: undefined },
): { transport: LifecycleTransport; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    transport: {
      async get<T>(url: string): Promise<T> {
        calls.push({ path: url, method: 'GET' });
        const hit = Object.entries(reads).find(([key]) => url.startsWith(key));
        if (!hit) throw new Error(`Unexpected GET ${url}`);
        return { data: hit[1] } as T;
      },
      async send<T>(url: string, method: string, body?: unknown): Promise<LifecycleResult<T>> {
        calls.push({ path: url, method, body });
        return writeResult as LifecycleResult<T>;
      },
    },
  };
}

describe('createWebEntityLifecycle', () => {
  it('renders the Lixeira tab with the ported entry card and test ids', async () => {
    const { transport } = fakeTransport({
      '/api/admin/loja/recycle-bin': {
        entries: [
          {
            id: 'bin-1',
            entityType: 'product',
            entityId: 'p1',
            label: 'Coca Lata',
            deletedBy: 'u1',
            deletedByName: 'Ana',
            deletedAt: new Date('2026-08-01T12:00:00Z').toISOString(),
            status: 'DELETED',
            children: [{ id: 'bin-2', entityType: 'product', label: 'Variação 350ml' }],
          },
        ],
      },
    });
    const { page: Page } = createWebEntityLifecycle({ apiBase: '/api/admin/loja', transport });
    render(<Page />);

    await waitFor(() => expect(screen.getByTestId('recycle-bin-list')).toBeTruthy());
    expect(screen.getByTestId('recycle-bin-entry-bin-1').textContent).toContain('Coca Lata');
    expect(screen.getByTestId('recycle-bin-entry-bin-1').textContent).toContain('Produto');
    expect(screen.getByTestId('recycle-bin-entry-bin-1').textContent).toContain(
      'Inclui: Variação 350ml',
    );
    expect(screen.getByTestId('recycle-bin-restore-bin-1')).toBeTruthy();
    expect(screen.getByTestId('recycle-bin-purge-bin-1')).toBeTruthy();
  });

  it('switches to Aprovações and renders the per-status empty copy', async () => {
    const { transport } = fakeTransport({ '/api/admin/loja/approvals': { requests: [] } });
    const { ApprovalsScreen } = createWebEntityLifecycle({
      apiBase: '/api/admin/loja',
      transport,
    });
    render(<ApprovalsScreen />);

    await waitFor(() => expect(screen.getByTestId('approvals-empty')).toBeTruthy());
    expect(screen.getByTestId('approvals-status-filter')).toBeTruthy();
    expect(screen.getByTestId('approvals-empty').textContent).toContain(
      'Nenhuma solicitação pendente.',
    );
  });

  it('publishes a draft through the bound client and reports the outcome', async () => {
    const { transport, calls } = fakeTransport(
      {},
      { ok: true, data: { applied: true, entityId: 'p1', requestId: null } },
    );
    const { DraftBanner } = createWebEntityLifecycle({ apiBase: '/api/admin/loja', transport });
    const onPublished = vi.fn();
    render(
      <DraftBanner
        slug="products"
        draft={{
          id: 'd1',
          entityId: 'p1',
          data: { name: 'Rascunho' },
          status: 'OPEN',
          updatedAt: new Date('2026-08-01T12:00:00Z').toISOString(),
        }}
        onLoad={() => undefined}
        onPublished={onPublished}
        onDiscarded={() => undefined}
        testIdPrefix="product-draft"
      />,
    );

    expect(screen.getByTestId('product-draft-banner')).toBeTruthy();
    fireEvent.click(screen.getByTestId('product-draft-publish'));

    await waitFor(() => expect(onPublished).toHaveBeenCalledWith(true));
    expect(calls).toEqual([
      { path: '/api/admin/loja/products/drafts/d1/publish', method: 'POST', body: undefined },
    ]);
  });
});
