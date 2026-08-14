// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { createWebReportBuilder } from '../create-report-builder';
import { TEST_SURFACE } from './surface-fixture';
import type { BlockTemplateGroup } from '../../server/block-templates';
import type {
  ReportEntityFields,
  SavedReportSummary,
  SavedReportView,
} from '../custom-reports-api';
import type { ReportRender } from '../reports-api';
import type { ReportBuilderTransport } from '../transport';

/**
 * `plan.md` entry 22 — "new report goes straight to the editor with the picker
 * open" — and the trap that makes it more than a one-line change.
 *
 * The picker's `useState(false)` meant `/new` landed on a bare canvas and the
 * author had to find the dashed strip. Opening it "when the canvas has no
 * blocks" would have been the obvious fix and the wrong one: a SAVED report
 * whose blocks were all deleted also has none, and it would have reopened the
 * picker on every visit with no way to refuse. So the signal is the ROUTE, and
 * the case that pins it is `zero blocks + a saved id`.
 *
 * Every negative here is paired with a positive control in the same test — the
 * editor's save control, or the canvas — because "the picker is not open"
 * passes trivially against a page that failed to render at all.
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

/**
 * A host's own block templates — the picker's whole content, from config.
 *
 * Deliberately in a vocabulary this repo's hosts do not use: if these render,
 * the picker is showing what it was given rather than what it used to ship.
 */
const HOST_TEMPLATES: BlockTemplateGroup[] = [
  {
    id: 'fleet',
    title: 'Frota',
    templates: [
      {
        id: 'trips-per-day',
        title: 'Viagens por dia',
        description: 'Quantas viagens saíram a cada dia',
        spec: null,
      },
    ],
  },
  {
    id: 'maintenance',
    title: 'Manutenção',
    templates: [
      {
        id: 'downtime',
        title: 'Parado por oficina',
        description: 'Horas paradas em cada oficina',
        spec: null,
      },
    ],
  },
];

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

/** A saved dashboard with `blockCount` blocks — zero is the interesting one. */
function savedView(blockCount: number): SavedReportView {
  const blocks = Array.from({ length: blockCount }, (_unused, index) => ({
    id: `bloco-${index + 1}`,
    title: `Bloco ${index + 1}`,
    span: 6,
    spec: {
      entity: 'orders',
      dimensions: [{ field: 'method' }],
      measures: [{ field: 'revenueCents', aggregation: 'sum' as const }],
      filters: [],
      sort: [],
      presentation: { kind: 'table' as const },
    },
  }));
  return {
    id: REPORT_ID,
    name: 'Painel da loja',
    description: 'Salvo, e possivelmente sem nenhum bloco.',
    status: 'published',
    visibility: 'tenant',
    visibilityRoles: [],
    defaultRange: '30d',
    range: RANGE,
    type: 'dashboard',
    spec: { kind: 'dashboard', blocks },
    blocks: blocks.map((block) => ({
      id: block.id,
      title: block.title,
      span: block.span,
      sentence: 'soma de Receita por Forma de pagamento',
      status: 'ok' as const,
      render: RENDER,
    })),
  };
}

/**
 * The whole backend, in memory. A FUNCTION, not a shared const: a transport
 * reused across tests is a test-order dependency waiting to happen.
 */
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

/** Mount the routed surface at a path and wait for the editor to be up. */
async function openEditor(path: string, view: SavedReportView = savedView(1)): Promise<void> {
  const { page: Surface } = createWebReportBuilder({
    surface: { ...TEST_SURFACE, blockTemplates: HOST_TEMPLATES },
    tenantSlug: TENANT,
    transport: stubTransport(view),
    standalone: true,
    initialPath: path,
  });
  render(<Surface />);
  // The positive control every case in this file leans on: the editor is
  // genuinely on screen, so a missing picker means "closed", not "blank page".
  await screen.findByTestId('report-editor-save');
}

function picker(): HTMLElement | null {
  return screen.queryByTestId('block-template-picker');
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

describe('the picker on arrival', () => {
  it('opens itself on /new', async () => {
    await openEditor(`/${TENANT}/reports/new`);
    expect(picker()).toBeTruthy();
    expect(screen.getByTestId('block-template-picker-subtitle').textContent).toContain(
      'Comece de um modelo pronto',
    );
  });

  it('stays shut on /:reportId/edit', async () => {
    await openEditor(`/${TENANT}/reports/${REPORT_ID}/edit`);
    // Paired with a control that the editor really rendered the saved report.
    expect(screen.getByTestId('report-editor-grid')).toBeTruthy();
    expect(picker()).toBeNull();
  });

  it('stays shut on a SAVED report whose blocks were all deleted', async () => {
    // The trap: zero blocks is not the same fact as "this report is new".
    await openEditor(`/${TENANT}/reports/${REPORT_ID}/edit`, savedView(0));
    expect(screen.getByTestId('report-editor-add-block')).toBeTruthy();
    expect(picker()).toBeNull();
  });
});

describe('dismissing the picker on a new report', () => {
  it('leaves an empty editor that can still add a block', async () => {
    await openEditor(`/${TENANT}/reports/new`);
    fireEvent.click(screen.getByTestId('block-template-picker-cancel'));
    await waitFor(() => {
      expect(picker()).toBeNull();
    });

    // Not a dead end: the canvas's own affordance is there and works.
    const add = screen.getByTestId('report-editor-add-block');
    expect(add.hasAttribute('disabled')).toBe(false);
    fireEvent.click(add);
    await waitFor(() => {
      expect(picker()).toBeTruthy();
    });
  });
});

describe('what the picker offers', () => {
  /**
   * The groups are the HOST's, and these two cases are what that means.
   *
   * They used to assert `vendas` / `movimento` / `pagamentos-e-perdas` — the
   * three groups future-pay's `block-templates.ts` shipped from inside this
   * package, rendered to every consumer that mounted the editor. The picker's
   * contract is not those words; it is "your groups, in your order, then the
   * blank one". So the fixture declares two groups of its own and the cases
   * check that they arrive, alongside the blank group this package does own.
   */
  it('renders the groups the host declared, and appends the blank one', async () => {
    await openEditor(`/${TENANT}/reports/new`);
    for (const group of ['fleet', 'maintenance', 'em-branco']) {
      expect(screen.getByTestId(`block-template-picker-group-${group}`)).toBeTruthy();
    }
  });

  it('names each group in the words the HOST gave it', async () => {
    await openEditor(`/${TENANT}/reports/new`);
    for (const heading of ['Frota', 'Manutenção', 'Do zero']) {
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    }
  });

  it('offers the blank template, and it produces a block', async () => {
    await openEditor(`/${TENANT}/reports/new`);
    const blank = screen.getByTestId('block-template-picker-blank');
    // Its glyph is the PLUS, not the chart: the blank one builds rather than
    // draws, and the icon follows `spec === null` in the model.
    expect(screen.getByTestId('block-template-picker-blank-icon')).toBeTruthy();

    fireEvent.click(blank);
    await waitFor(() => {
      expect(screen.getByTestId('report-block-bloco-1')).toBeTruthy();
    });
    // The modal leaves on a transition, so its absence is a state to wait for
    // rather than one to read immediately after the click.
    await waitFor(() => {
      expect(picker()).toBeNull();
    });
  });
});
