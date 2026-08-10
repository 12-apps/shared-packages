// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { createWebReportBuilder } from '../create-report-builder';
import type {
  ReportEntityFields,
  SavedReportSummary,
  SavedReportView,
} from '../custom-reports-api';
import { ReportActionsMenu, ReportViewCanvas } from '../report-view';
import type { ReportRender } from '../reports-api';
import type { ReportBuilderTransport } from '../transport';

/**
 * Plan entry 6 (`refactor(reports): split view mode from edit mode`) is marked
 * ALREADY DONE, with the acceptance "no save/cancel controls exist in view
 * mode". A status line rots the moment someone edits the file; these cases are
 * the version of that status that cannot.
 *
 * The criterion is a NEGATIVE, and a negative passes trivially against a
 * component that silently rendered nothing. So every sweep here is paired with
 * a positive control in the SAME test — the ⋮ trigger, the canvas, the period
 * toggle — and the last describe block renders the EDIT route through the same
 * transport to show that "Salvar relatório" is found when it is there. Without
 * that pair the file would still be green with the whole surface deleted.
 *
 * The split is asserted where it is actually declared: entry 6's status cites
 * `create-report-builder.tsx:69-77`, so the screen-level cases mount the real
 * routed surface at `/:reportId` and `/:reportId/edit` rather than hand-picking
 * two components. Same tenant, same transport, same report id — only the URL
 * differs, which is precisely the claim.
 */

/** Every string that would mean edit-mode chrome leaked into the viewer. */
const SAVE_OR_CANCEL = [
  'Salvar relatório',
  'Salvar',
  'Salvando…',
  'Descartar',
  'Cancelar',
] as const;

/**
 * Word-boundary, accent- and case-insensitive. Loose enough that `Salvar` also
 * catches `Salvar relatório`, tight enough that it cannot fire on a substring
 * inside an unrelated word.
 */
const SAVE_OR_CANCEL_RE = /(^|[^\p{L}])(salvar|salvando|descartar|cancelar)([^\p{L}]|$)/iu;

const TENANT = 'acme';
const REPORT_ID = 'rel-1';

const RENDER: ReportRender = {
  kind: 'table',
  columns: [
    { key: 'method', label: 'Forma de pagamento', format: 'text' },
    { key: 'revenueCents', label: 'Receita', format: 'brl' },
  ],
  rows: [{ method: 'PIX', revenueCents: 123456 }],
};

const SUMMARY: SavedReportSummary = {
  id: REPORT_ID,
  name: 'Receita por forma de pagamento',
  description: null,
  type: 'dashboard',
  entity: 'orders',
  entities: ['orders'],
  blockCount: 2,
  status: 'published',
  visibility: 'tenant',
  ownedByMe: true,
  updatedAt: '2026-02-01T12:00:00.000Z',
};

const VIEW: SavedReportView = {
  id: REPORT_ID,
  name: 'Receita por forma de pagamento',
  description: 'Pedidos pagos no período.',
  status: 'published',
  visibility: 'tenant',
  visibilityRoles: [],
  range: {
    preset: '30d',
    from: '2026-01-02T03:00:00.000Z',
    toExclusive: '2026-02-01T03:00:00.000Z',
  },
  type: 'dashboard',
  spec: {
    kind: 'dashboard',
    blocks: [
      {
        id: 'bloco-1',
        title: 'Receita por forma',
        span: 6,
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
      title: 'Receita por forma',
      span: 6,
      sentence: 'soma de Receita por Forma de pagamento',
      status: 'ok',
      render: RENDER,
    },
  ],
};

const ENTITY: ReportEntityFields = {
  entity: 'orders',
  label: 'Pedidos',
  fields: [
    { field: 'method', label: 'Forma de pagamento', type: 'string', role: 'dimension' },
    { field: 'revenueCents', label: 'Receita', type: 'money', role: 'measure' },
  ],
};

/**
 * The whole backend, in memory. `ReportBuilderTransport` is this package's only
 * I/O seam, so answering these four paths substitutes the entire server — no
 * global `fetch` stub, and nothing here can reach the network.
 */
function stubTransport(): ReportBuilderTransport {
  const read = <T,>(url: string): Promise<T> => {
    if (url.includes('/reports/fields')) {
      return Promise.resolve({ entities: [ENTITY] } as T);
    }
    if (url.includes(`/reports/custom/${REPORT_ID}`)) {
      return Promise.resolve(VIEW as unknown as T);
    }
    if (url.includes('/reports/custom')) {
      return Promise.resolve({ reports: [SUMMARY] } as T);
    }
    return Promise.reject(new Error(`unexpected read: ${url}`));
  };
  return {
    get: read,
    getRaw: read,
    // The editor dry-runs each block through this; the viewer never calls it.
    send: <T,>() =>
      Promise.resolve({
        ok: true as const,
        data: { range: VIEW.range, render: RENDER } as unknown as T,
      }),
  };
}

/** The routed surface as a host mounts it, opened at one of its own URLs. */
function renderSurfaceAt(url: string): void {
  const { page: Surface } = createWebReportBuilder({
    tenantSlug: TENANT,
    transport: stubTransport(),
    standalone: true,
    initialPath: url,
  });
  render(<Surface />);
}

/** The accessible name a screen reader would resolve, without jest-dom. */
function accessibleName(element: HTMLElement): string {
  const label = element.getAttribute('aria-label');
  if (label !== null && label.trim() !== '') return label.trim();
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Everything currently on screen that a person could press. */
function pressableNames(): string[] {
  return [
    ...screen.queryAllByRole('button'),
    ...screen.queryAllByRole('menuitem'),
    ...screen.queryAllByRole('link'),
  ].map(accessibleName);
}

/** jsdom has no `matchMedia`, so there is nothing here to preserve — but the
 * restore below keeps the stub from outliving this file. */
const realMatchMedia = window.matchMedia;

/**
 * `useMediaQuery` reads `window.matchMedia`, which jsdom does not implement.
 * Answering "no" to every query keeps the surface on one layout branch instead
 * of inheriting whatever a missing global happens to do.
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

describe('entry 6 — view mode renders no save or cancel control', () => {
  it('offers the ⋮ menu and the canvas, and nothing that saves or cancels', () => {
    render(
      <MemoryRouter>
        <ReportViewCanvas view={VIEW} />
        <ReportActionsMenu tenantSlug={TENANT} view={VIEW} onChanged={() => undefined} />
      </MemoryRouter>,
    );

    // Positive control. Without these two the sweep below proves nothing: an
    // empty render has no save button either.
    expect(screen.getByRole('button', { name: 'Ações do relatório' })).toBeTruthy();
    expect(screen.getByTestId('report-grid')).toBeTruthy();

    const offending = pressableNames().filter((name) => SAVE_OR_CANCEL_RE.test(name));
    expect(offending).toEqual([]);
    // Loose text as well as controls: a "Descartar alterações" label that is
    // not a button is still edit-mode chrome, and no role query would see it.
    expect(SAVE_OR_CANCEL_RE.test(document.body.textContent ?? '')).toBe(false);
  });

  it.each(SAVE_OR_CANCEL)('renders no control named %s', (copy) => {
    render(
      <MemoryRouter>
        <ReportViewCanvas view={VIEW} />
        <ReportActionsMenu tenantSlug={TENANT} view={VIEW} onChanged={() => undefined} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: 'Ações do relatório' })).toBeTruthy();
    // `queryAll…` + `toEqual([])` rather than `queryBy…` + `toBeNull()`: the
    // failure message then names what it found instead of saying "not null".
    expect(screen.queryAllByRole('button', { name: copy })).toEqual([]);
    expect(screen.queryAllByRole('menuitem', { name: copy })).toEqual([]);
  });

  it('keeps the ⋮ menu itself to Editar and Arquivar', async () => {
    render(
      <MemoryRouter>
        <ReportViewCanvas view={VIEW} />
        <ReportActionsMenu tenantSlug={TENANT} view={VIEW} onChanged={() => undefined} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ações do relatório' }));

    // The first item is the way INTO edit mode — the split's other half: the
    // viewer does not edit, it navigates.
    const items = (await screen.findAllByRole('menuitem')).map(accessibleName);
    expect(items[0]).toBe('Editar');
    expect(items).toEqual(['Editar', 'Arquivar']);
    expect(items.filter((name) => SAVE_OR_CANCEL_RE.test(name))).toEqual([]);
  });
});

describe('entry 6 — the /:reportId screen carries the viewer chrome only', () => {
  it('shows title, period and export, and no save or cancel', async () => {
    renderSurfaceAt(`/${TENANT}/reports/${REPORT_ID}`);

    // Positive control: the whole view-mode toolbar, resolved through the
    // router and the transport rather than assumed.
    expect(await screen.findByTestId('report-title')).toBeTruthy();
    expect(screen.getByTestId('report-range')).toBeTruthy();
    expect(screen.getByTestId('report-export-pdf')).toBeTruthy();
    expect(screen.getByTestId('report-actions')).toBeTruthy();
    expect(screen.getByTestId('report-grid')).toBeTruthy();

    // No edit-mode chrome anywhere on the screen — not as a control, and not
    // as loose text either, which is what catches a label that is not a button.
    expect(pressableNames().filter((name) => SAVE_OR_CANCEL_RE.test(name))).toEqual([]);
    expect(SAVE_OR_CANCEL_RE.test(document.body.textContent ?? '')).toBe(false);
  });

  it.each(SAVE_OR_CANCEL)('renders no control named %s', async (copy) => {
    renderSurfaceAt(`/${TENANT}/reports/${REPORT_ID}`);

    expect(await screen.findByTestId('report-actions')).toBeTruthy();
    expect(screen.queryAllByRole('button', { name: copy })).toEqual([]);
  });
});

/**
 * The other side of the split. These are not a bonus: they are what makes the
 * assertions above falsifiable — the same query, the same copy and the same
 * transport DO find a save control one URL along, so a viewer that silently
 * failed to render could not pass the negative by accident.
 */
describe('entry 6 — /:reportId/edit is where the save controls live', () => {
  it('renders Salvar and Descartar in edit mode', async () => {
    renderSurfaceAt(`/${TENANT}/reports/${REPORT_ID}/edit`);

    expect(await screen.findByTestId('report-editor-save')).toBeTruthy();
    // The header renames these (GAP 8): the save carries its ⌘S hint and the
    // discard says what it discards. Both are still matched by the sweep above,
    // which is the point of asserting them by their exact rendered names here.
    expect(screen.getByRole('button', { name: 'Salvar ⌘S' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeTruthy();
  });

  it('does not render the viewer ⋮ menu', async () => {
    renderSurfaceAt(`/${TENANT}/reports/${REPORT_ID}/edit`);

    await screen.findByTestId('report-editor-save');
    expect(screen.queryAllByRole('button', { name: 'Ações do relatório' })).toEqual([]);
  });
});
