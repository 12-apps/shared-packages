// @vitest-environment jsdom
import { PT_BR_REPORT_ENGINE_COPY } from '../../pt-BR';
import { PT_BR_BLANK_BLOCK_TEMPLATE_COPY } from '../../server/pt-BR';
import { PT_BR_REPORT_SCREENS_COPY } from '../pt-BR';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { createWebReportBuilder } from '../create-report-builder';
import { TEST_SURFACE } from './surface-fixture';
import type {
  ReportEntityFields,
  SavedReportSummary,
  SavedReportView,
} from '../custom-reports-api';
import type { ReportRender } from '../reports-api';
import type { ReportBuilderTransport } from '../transport';

/**
 * Autosaving a NEW report must not take the author's panel away.
 *
 * A report that has never been saved is created by autosave, and `afterCreate`
 * then navigates `/reports/new` → `/reports/:id/edit` so the URL names the row.
 * That is a different ROUTE, so the editor page unmounts and remounts — and
 * `useCanvasSelection` is state inside it. `selectedId` returns to null and
 * `everOpened` to false, which is not "the panel shows its empty state": the
 * canvas renders no panel AT ALL, and the block the author was configuring
 * loses its selection ring.
 *
 * The author sees the editor they were typing into vanish, mid-edit, at a
 * moment they did not choose — the autosave timer picked it.
 *
 * The host's reports e2e is where this surfaced: it opens `/reports/new`,
 * configures a block, and clicks a width segment. The click lands in the window
 * the create-navigate opens, so the control is gone by the time Playwright
 * retries — 5 runs out of 5 locally, intermittent on CI depending on when the
 * POST returns.
 */
const TENANT = 'acme';
const CREATED_ID = 'rel-novo';

const RANGE = {
  preset: '30d' as const,
  from: '2026-01-02T03:00:00.000Z',
  toExclusive: '2026-02-01T03:00:00.000Z',
};

const RENDER: ReportRender = {
  kind: 'table',
  columns: [{ key: 'method', label: 'Forma de pagamento', format: 'text' }],
  rows: [{ method: 'PIX' }],
};

const ENTITY: ReportEntityFields = {
  entity: 'orders',
  label: 'Pedidos',
  fields: [
    { field: 'method', label: 'Forma de pagamento', type: 'string', role: 'dimension' },
    { field: 'revenueCents', label: 'Receita', type: 'money', role: 'measure' },
  ],
};

const SUMMARY: SavedReportSummary = {
  id: CREATED_ID,
  name: 'Relatório novo',
  description: null,
  type: 'dashboard',
  entity: 'orders',
  entities: ['orders'],
  blockCount: 1,
  status: 'draft',
  visibility: 'private',
  ownedByMe: true,
  updatedAt: '2026-02-01T12:00:00.000Z',
};

const CREATED_VIEW: SavedReportView = {
  id: CREATED_ID,
  name: 'Relatório novo',
  description: null,
  status: 'draft',
  visibility: 'private',
  visibilityRoles: [],
  range: RANGE,
  type: 'dashboard',
  spec: {
    kind: 'dashboard',
    blocks: [
      {
        id: 'bloco-1',
        title: 'Pedidos',
        span: 12,
        spec: {
          entity: 'orders',
          dimensions: [{ field: 'method' }],
          measures: [{ field: 'revenueCents', aggregation: 'sum' }],
          filters: [],
          sort: [],
          presentation: { kind: 'table' },
        },
      },
    ],
  },
  blocks: [
    {
      id: 'bloco-1',
      title: 'Pedidos',
      span: 12,
      sentence: 'soma de Receita por Forma de pagamento',
      status: 'ok' as const,
      render: RENDER,
    },
  ],
};

interface SentCall {
  url: string;
  method: string;
}

/** Reads too: the create-navigate is only observable once the new row is fetched. */
interface Traffic {
  calls: SentCall[];
  reads: string[];
}

function stubTransport(sent: Traffic): ReportBuilderTransport {
  const read = <T,>(url: string): Promise<T> => {
    sent.reads.push(url);
    if (url.includes('/reports/fields')) return Promise.resolve({ entities: [ENTITY] } as T);
    if (url.includes(`/reports/custom/${CREATED_ID}`)) {
      return Promise.resolve(CREATED_VIEW as unknown as T);
    }
    if (url.includes('/reports/custom')) return Promise.resolve({ reports: [SUMMARY] } as T);
    if (url.includes('/roles')) return Promise.resolve({ roles: [] } as T);
    return Promise.reject(new Error(`unexpected read: ${url}`));
  };
  return {
    get: read,
    getRaw: read,
    send: <T,>(url: string, method: string) => {
      sent.calls.push({ url, method });
      if (url.includes('/reports/run')) {
        return Promise.resolve({
          ok: true as const,
          data: { range: RANGE, render: RENDER } as unknown as T,
        });
      }
      return Promise.resolve({ ok: true as const, data: { id: CREATED_ID } as unknown as T });
    },
  };
}

const realMatchMedia = window.matchMedia;

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  window.matchMedia = realMatchMedia;
});

describe('autosave creating a new report', () => {
  it('leaves the block editor panel open on the block being configured', async () => {
    const sent: Traffic = { calls: [], reads: [] };
    const { page: Surface } = createWebReportBuilder({
      surface: TEST_SURFACE,
      copy: {
        engine: PT_BR_REPORT_ENGINE_COPY,
        blankTemplate: PT_BR_BLANK_BLOCK_TEMPLATE_COPY,
        screens: PT_BR_REPORT_SCREENS_COPY,
      },
      tenantSlug: TENANT,
      transport: stubTransport(sent),
      standalone: true,
      initialPath: `/${TENANT}/reports/new`,
    });
    render(<Surface />);
    await screen.findByTestId('report-editor-save');

    fireEvent.click(await screen.findByTestId('block-template-picker-blank'));
    await waitFor(() => {
      expect(screen.queryByTestId('block-template-picker')).toBeNull();
    });
    // A name is what makes the document valid enough for autosave to create it.
    fireEvent.change(screen.getByTestId('report-editor-name'), {
      target: { value: 'Relatório novo' },
    });

    // The author opens the block's editor and is working in it.
    fireEvent.click(screen.getByTestId('report-block-bloco-1-edit'));
    await screen.findByTestId('report-block-bloco-1-editor-content');

    // Autosave creates the report and points the URL at it. Waiting on the POST
    // alone is NOT enough: `afterCreate` navigates after the response resolves,
    // so an assertion racing it reads the pre-navigate DOM and passes whatever
    // the panel does next. The new row being FETCHED is the route change having
    // actually happened.
    await waitFor(
      () => {
        // NOT any POST: the run endpoint is one too, and waiting on it would
        // assert the panel before the create has happened at all.
        expect(
          sent.calls.some(
            (call) => call.method === 'POST' && !call.url.includes('/reports/run'),
          ),
        ).toBe(true);
      },
      { timeout: 5000 },
    );
    await waitFor(
      () => {
        expect(sent.reads.some((url) => url.includes(`/reports/custom/${CREATED_ID}`))).toBe(true);
      },
      { timeout: 5000 },
    );

    // The panel must still be there. Asserting the CONTENT rather than the
    // drawer: a remount takes `everOpened` with it, so the failure is no panel
    // at all rather than a panel showing its empty state.
    await waitFor(() => {
      expect(screen.queryByTestId('report-block-bloco-1-editor-content')).toBeTruthy();
    });
    // And on THIS block, not the panel's empty state. Before the fix there was
    // no panel at all — the remount took `everOpened` with it — so asserting
    // only "no empty state" would have passed against nothing.
    expect(screen.queryAllByText('Selecione um bloco para editar')).toEqual([]);
  });
});
