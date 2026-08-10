// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { createWebReportBuilder } from '../create-report-builder';
import type {
  ReportEntityFields,
  SavedReportSummary,
  SavedReportView,
} from '../custom-reports-api';
import type { ReportRender } from '../reports-api';
import type { ReportBuilderTransport } from '../transport';

/**
 * Leaving the editor with work in progress (FUT-755).
 *
 * The warning is deliberately NOT "you will lose your changes" — that would be
 * false. Edits are autosaved, so what leaving costs is not the work but the
 * AUDIENCE: on a published report the store keeps reading the old version, and
 * on a draft nobody can read it at all. Two different facts, two sentences.
 *
 * The case that carries the most weight here is the negative one. A
 * confirmation that fires when nothing is pending is one people learn to click
 * through, which costs you the times it mattered — so "clean editor leaves
 * silently" is asserted first and with a positive control.
 */

const TENANT = 'acme';
const REPORT_ID = 'rel-1';

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
  id: REPORT_ID,
  name: 'Painel da loja',
  description: null,
  type: 'dashboard',
  entity: 'orders',
  entities: ['orders'],
  blockCount: 1,
  status: 'published',
  visibility: 'tenant',
  ownedByMe: true,
  updatedAt: '2026-02-01T12:00:00.000Z',
};

/** A saved report in the lifecycle asked for — published, or a private draft. */
function savedView(status: 'published' | 'draft'): SavedReportView {
  const block = {
    id: 'bloco-1',
    title: 'Bloco 1',
    span: 6,
    spec: {
      entity: 'orders',
      dimensions: [{ field: 'method' }],
      measures: [{ field: 'revenueCents', aggregation: 'sum' as const }],
      filters: [],
      sort: [],
      presentation: { kind: 'table' as const },
    },
  };
  return {
    id: REPORT_ID,
    name: 'Painel da loja',
    description: null,
    status,
    visibility: status === 'published' ? 'tenant' : 'private',
    visibilityRoles: [],
    defaultRange: '30d',
    range: RANGE,
    type: 'dashboard',
    spec: { kind: 'dashboard', blocks: [block] },
    blocks: [
      {
        id: block.id,
        title: block.title,
        span: block.span,
        sentence: 'soma de Receita por Forma de pagamento',
        status: 'ok' as const,
        render: RENDER,
      },
    ],
  };
}

function stubTransport(view: SavedReportView): ReportBuilderTransport {
  const read = <T,>(url: string): Promise<T> => {
    if (url.includes('/reports/fields')) return Promise.resolve({ entities: [ENTITY] } as T);
    if (url.includes(`/reports/custom/${REPORT_ID}`)) return Promise.resolve(view as unknown as T);
    if (url.includes('/reports/custom')) return Promise.resolve({ reports: [SUMMARY] } as T);
    if (url.includes('/roles')) return Promise.resolve({ roles: [] } as T);
    return Promise.reject(new Error(`unexpected read: ${url}`));
  };
  return {
    get: read,
    getRaw: read,
    send: <T,>() =>
      Promise.resolve({
        ok: true as const,
        data: { range: RANGE, render: RENDER } as unknown as T,
      }),
  };
}

const realMatchMedia = window.matchMedia;

/**
 * `useMediaQuery` reads `window.matchMedia`, which jsdom does not implement.
 * Answering "no" to every query pins the docked tier. Installed per test with
 * a restore, so the mutation cannot leak into another suite.
 */
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

async function openEditor(status: 'published' | 'draft' = 'published'): Promise<void> {
  const { page: Surface } = createWebReportBuilder({
    tenantSlug: TENANT,
    transport: stubTransport(savedView(status)),
    standalone: true,
    initialPath: `/${TENANT}/reports/${REPORT_ID}/edit`,
  });
  render(<Surface />);
  await screen.findByTestId('report-editor-save');
}

function prompt(): HTMLElement | null {
  return screen.queryByTestId('report-editor-exit-confirm');
}

describe('leaving the editor', () => {
  it('is not interrupted when nothing is pending', async () => {
    await openEditor();

    fireEvent.click(screen.getByTestId('report-editor-back'));

    // The positive control is the navigation itself: we LEFT. Asserting only
    // "no dialog" would pass against a click that did nothing at all, which is
    // the other way this could be broken.
    await waitFor(() => {
      expect(screen.queryByTestId('report-editor-save')).toBeNull();
    });
    expect(prompt()).toBeNull();
  });

  it('stops you when there are changes the readers have not seen', async () => {
    await openEditor('published');

    fireEvent.change(screen.getByTestId('report-editor-name'), {
      target: { value: 'Painel da loja — revisado' },
    });
    fireEvent.click(screen.getByTestId('report-editor-back'));

    const dialog = await screen.findByTestId('report-editor-exit-confirm');
    // The published report's audience keeps reading the old version. Naming
    // the fact rather than matching the whole sentence, so rewording the copy
    // does not fail the test that guards its MEANING.
    expect(dialog.textContent).toContain('versão publicada');
  });

  it('says something different for a report nobody can read yet', async () => {
    await openEditor('draft');

    fireEvent.change(screen.getByTestId('report-editor-name'), {
      target: { value: 'Rascunho renomeado' },
    });
    fireEvent.click(screen.getByTestId('report-editor-back'));

    const dialog = await screen.findByTestId('report-editor-exit-confirm');
    // A draft has no readers at all, so "continua vendo a versão publicada"
    // would be nonsense. This is the assertion that stops the two states being
    // collapsed into one convenient string.
    expect(dialog.textContent).toContain('Ninguém mais vê');
    expect(dialog.textContent).not.toContain('continua vendo');
  });
});
