// @vitest-environment jsdom
import { PT_BR_REPORT_ENGINE_COPY } from '../../pt-BR';
import { PT_BR_BLANK_BLOCK_TEMPLATE_COPY } from '../../server/pt-BR';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { createWebReportBuilder } from '../create-report-builder';
import { TEST_SURFACE } from './surface-fixture';
import type {
  ReportEntityFields,
  SavedReportSummary,
  SavedReportView,
} from '../custom-reports-api';
import type { ReportRange, ReportRender } from '../reports-api';
import type { ReportBuilderTransport } from '../transport';

/**
 * "Período padrão ao abrir" (FUT-755): a report opens on the period it stores,
 * not on a constant.
 *
 * The trap this file exists for is that a `useState<ReportRange>(seed)`
 * initialiser runs ONCE. Seeded there, the first report opens correctly and
 * every report selected afterwards silently keeps the first one's period — so
 * a single "it starts on the report's default" assertion passes against the
 * broken version. The second case here is the one that fails it.
 *
 * The period is observed where it actually has an effect: the `preset` on the
 * URL the surface asks the server for. A `ToggleGroup` can look right while
 * the request that was already sent asked for something else.
 */

/** The field lands with the settings half; read structurally until it does. */
type SummaryWithDefault = SavedReportSummary & { defaultRange?: ReportRange };

const TENANT = 'acme';

const RENDER: ReportRender = {
  kind: 'table',
  columns: [{ key: 'method', label: 'Forma de pagamento', format: 'text' }],
  rows: [{ method: 'PIX' }],
};

function summary(patch: Partial<SummaryWithDefault> & { id: string }): SummaryWithDefault {
  return {
    name: patch.id,
    description: null,
    type: 'dashboard',
    entity: '',
    entities: ['orders'],
    blockCount: 1,
    status: 'published',
    visibility: 'tenant',
    ownedByMe: true,
    updatedAt: '2026-02-01T12:00:00.000Z',
    ...patch,
  } as SummaryWithDefault;
}

/** Two reports, each storing a DIFFERENT opening period, and one storing none. */
const REPORTS: SummaryWithDefault[] = [
  summary({ id: 'hoje', name: 'Do dia', defaultRange: 'today', updatedAt: '2026-03-01T00:00:00Z' }),
  summary({ id: 'semana', name: 'Da semana', defaultRange: '7d', updatedAt: '2026-02-01T00:00:00Z' }),
  summary({ id: 'sem-padrao', name: 'Sem padrão', updatedAt: '2026-01-01T00:00:00Z' }),
];

function view(id: string): SavedReportView {
  return {
    id,
    name: id,
    description: null,
    status: 'published',
    visibility: 'tenant',
    visibilityRoles: [],
    range: { preset: '30d', from: '2026-01-02T03:00:00.000Z', toExclusive: '2026-02-01T03:00:00.000Z' },
    type: 'dashboard',
    spec: {
      kind: 'dashboard',
      blocks: [
        {
          id: 'bloco-1',
          title: 'Bloco',
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
      { id: 'bloco-1', title: 'Bloco', span: 6, sentence: 'soma', status: 'ok', render: RENDER },
    ],
  } as unknown as SavedReportView;
}

const ENTITY: ReportEntityFields = {
  entity: 'orders',
  label: 'Pedidos',
  fields: [
    { field: 'method', label: 'Forma de pagamento', type: 'string', role: 'dimension' },
    { field: 'revenueCents', label: 'Receita', type: 'money', role: 'measure' },
  ],
};

/**
 * Every saved-report URL the surface asked for, newest last. A container the
 * stub MUTATES — the flakiness gate rejects a closed-over binding reassigned
 * from inside one.
 */
const asked = { urls: [] as string[] };

function stubTransport(): ReportBuilderTransport {
  const read = <T,>(url: string): Promise<T> => {
    if (url.includes('/reports/fields')) return Promise.resolve({ entities: [ENTITY] } as T);
    const one = /\/reports\/custom\/([^?]+)/.exec(url);
    if (one?.[1] !== undefined) {
      asked.urls.push(url);
      return Promise.resolve(view(one[1]) as unknown as T);
    }
    if (url.includes('/reports/custom')) return Promise.resolve({ reports: REPORTS } as T);
    return Promise.reject(new Error(`unexpected read: ${url}`));
  };
  return {
    get: read,
    getRaw: read,
    send: <T,>() =>
      Promise.resolve({ ok: true as const, data: { render: RENDER } as unknown as T }),
  };
}

/** The `preset` of the most recent run of `id`, or '' if it was never asked for. */
function presetAskedFor(id: string): string {
  const match = [...asked.urls].reverse().find((url) => url.includes(`/reports/custom/${id}?`));
  return match === undefined ? '' : (/preset=([^&]+)/.exec(match)?.[1] ?? '');
}

const realMatchMedia = window.matchMedia;

beforeEach(() => {
  asked.urls = [];
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

function renderSurfaceAt(url: string): void {
  const { page: Surface } = createWebReportBuilder({
    surface: TEST_SURFACE,
    copy: { engine: PT_BR_REPORT_ENGINE_COPY, blankTemplate: PT_BR_BLANK_BLOCK_TEMPLATE_COPY },
    tenantSlug: TENANT,
    transport: stubTransport(),
    standalone: true,
    initialPath: url,
  });
  render(<Surface />);
}

describe('the viewer opens on the report’s own period', () => {
  it('runs the report for the period it stores', async () => {
    renderSurfaceAt(`/${TENANT}/reports/hoje`);

    expect(await screen.findByTestId('report-title')).toBeTruthy();
    expect(presetAskedFor('hoje')).toBe('today');
  });

  it('falls back to 30d for a report that stores nothing', async () => {
    renderSurfaceAt(`/${TENANT}/reports/sem-padrao`);

    expect(await screen.findByTestId('report-title')).toBeTruthy();
    expect(presetAskedFor('sem-padrao')).toBe('30d');
  });

  it('re-seeds from the NEXT report, not from the one before it', async () => {
    // The case a mount-time seed passes anyway: open one report, go back, then
    // pick another with a different default.
    renderSurfaceAt(`/${TENANT}/reports/hoje`);
    expect(await screen.findByTestId('report-title')).toBeTruthy();
    expect(presetAskedFor('hoje')).toBe('today');

    // The period change refetches, so the screen is momentarily the loading
    // state — wait for the header back before reaching for it.
    fireEvent.click(await screen.findByTestId('report-back'));
    fireEvent.click(await screen.findByTestId('reports-card-semana-open'));

    expect(await screen.findByTestId('report-title')).toBeTruthy();
    // `7d`, the second report's own default — not `today` carried over.
    expect(presetAskedFor('semana')).toBe('7d');
  });

  it('lets a hand-picked period win for the report it was picked on', async () => {
    renderSurfaceAt(`/${TENANT}/reports/hoje`);
    expect(await screen.findByTestId('report-title')).toBeTruthy();

    fireEvent.click(screen.getByTestId('report-range-item-30d'));

    expect(await screen.findByTestId('report-title')).toBeTruthy();
    // The setting is a default, not a lock.
    expect(presetAskedFor('hoje')).toBe('30d');
  });

  it('drops that choice on the next report, whose own default applies', async () => {
    renderSurfaceAt(`/${TENANT}/reports/hoje`);
    expect(await screen.findByTestId('report-title')).toBeTruthy();

    fireEvent.click(screen.getByTestId('report-range-item-30d'));
    expect(presetAskedFor('hoje')).toBe('30d');

    // The period change refetches, so the screen is momentarily the loading
    // state — wait for the header back before reaching for it.
    fireEvent.click(await screen.findByTestId('report-back'));
    fireEvent.click(await screen.findByTestId('reports-card-semana-open'));

    expect(await screen.findByTestId('report-title')).toBeTruthy();
    expect(presetAskedFor('semana')).toBe('7d');
  });

  it('brings the hand-picked period back when you return to that report', async () => {
    renderSurfaceAt(`/${TENANT}/reports/hoje`);
    expect(await screen.findByTestId('report-title')).toBeTruthy();

    fireEvent.click(screen.getByTestId('report-range-item-30d'));
    // The period change refetches, so the screen is momentarily the loading
    // state — wait for the header back before reaching for it.
    fireEvent.click(await screen.findByTestId('report-back'));
    fireEvent.click(await screen.findByTestId('reports-card-hoje-open'));

    expect(await screen.findByTestId('report-title')).toBeTruthy();
    // Still `30d`: the pick is remembered against the report it was made on,
    // and coming back to that report is not the same as opening another one.
    expect(presetAskedFor('hoje')).toBe('30d');
  });
});

/**
 * Two screens, not a list with a detail pane under it (FUT-755).
 *
 * The claim is mutual exclusion, so every case asserts BOTH halves: which
 * screen is on, and that the other one is not. Checking only what is present
 * would pass against the old single screen, where both were always rendered.
 */
describe('the list and the report are separate screens', () => {
  it('opens the list, and does not auto-navigate into the first report', async () => {
    renderSurfaceAt(`/${TENANT}/reports`);

    expect(await screen.findByTestId('reports-card-list')).toBeTruthy();
    // Auto-selection was right for a picker; with two screens it would make
    // the list unreachable, because landing on it would bounce you off it.
    expect(screen.queryByTestId('page-report')).toBe(null);
    expect(screen.queryByTestId('report-title')).toBe(null);
  });

  it('lands on the report’s own URL when a card is clicked', async () => {
    renderSurfaceAt(`/${TENANT}/reports`);

    fireEvent.click(await screen.findByTestId('reports-card-semana-open'));

    expect(await screen.findByTestId('page-report')).toBeTruthy();
    // The run payload names it, so this is the report the URL asked for.
    expect(screen.getByTestId('report-title').textContent).toBe('semana');
    // The grid is gone, not scrolled off — this is the whole point.
    expect(screen.queryByTestId('reports-card-list')).toBe(null);
  });

  it('renders a deep link as the report alone', async () => {
    renderSurfaceAt(`/${TENANT}/reports/semana`);

    expect(await screen.findByTestId('page-report')).toBeTruthy();
    expect(screen.queryByTestId('reports-card-list')).toBe(null);
    expect(screen.queryByTestId('reports-new')).toBe(null);
  });

  it('goes back to the grid from the report', async () => {
    renderSurfaceAt(`/${TENANT}/reports/semana`);
    expect(await screen.findByTestId('page-report')).toBeTruthy();

    fireEvent.click(screen.getByTestId('report-back'));

    expect(await screen.findByTestId('reports-card-list')).toBeTruthy();
    expect(screen.queryByTestId('page-report')).toBe(null);
  });

  it('carries the report’s own header: name, status, subtitle and the three actions', async () => {
    renderSurfaceAt(`/${TENANT}/reports/semana`);

    expect(await screen.findByTestId('page-report')).toBeTruthy();
    expect(screen.getByTestId('report-title').textContent).toBe('semana');
    expect(screen.getByTestId('report-back')).toBeTruthy();
    expect(screen.getByTestId('report-export-pdf')).toBeTruthy();
    // Editing is a primary button here, not only a line in the ⋮ menu.
    expect(screen.getByTestId('report-edit')).toBeTruthy();
    expect(screen.getByTestId('report-actions')).toBeTruthy();
    // One subtitle line, three facts: what it is, who reads it, how stale.
    const subtitle = screen.getByTestId('report-subtitle').textContent ?? '';
    expect(subtitle).toContain('Sem descrição.');
    expect(subtitle).toContain('visível para toda a equipe');
    expect(subtitle).toContain('editado');
  });

  it('says which window the preset resolved to', async () => {
    renderSurfaceAt(`/${TENANT}/reports/semana`);

    expect(await screen.findByTestId('page-report')).toBeTruthy();
    // The stub resolves 02/01 → 01/02 exclusive, so the inclusive end is 31/01.
    expect(screen.getByTestId('report-window').textContent).toBe('02/01 – 31/01');
  });
});

/**
 * The header's LAYOUT, as far as jsdom can honestly hold it.
 *
 * There is no layout engine here, so nothing below proves a pixel. What it does
 * prove is the two things that made a near-identical row in this area measure
 * 455px inside a 390px column — and push the ⋮, the only route to Editar, clean
 * off a phone: DOM ORDER (back, then the title column, then the actions at the
 * far edge) and the `min-width: 0` that lets the two columns shrink at all.
 * Widths are a browser check; these are the two failures a browser check would
 * be diagnosing.
 */
describe('the view header holds its shape', () => {
  it('puts back first, the title column next, and the actions last', async () => {
    renderSurfaceAt(`/${TENANT}/reports/semana`);
    expect(await screen.findByTestId('page-report')).toBeTruthy();

    const order = ['report-back', 'report-title', 'report-export-pdf', 'report-edit', 'report-actions'];
    const nodes = order.map((id) => screen.getByTestId(id));
    for (let index = 1; index < nodes.length; index += 1) {
      const previous = nodes[index - 1] as HTMLElement;
      const current = nodes[index] as HTMLElement;
      // DOCUMENT_POSITION_FOLLOWING: `current` comes after `previous`.
      // eslint-disable-next-line no-bitwise -- the DOM's own comparison is a bitmask
      expect(previous.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }
  });

  it('lets both header columns shrink, so a narrow one wraps instead of overflowing', async () => {
    renderSurfaceAt(`/${TENANT}/reports/semana`);
    expect(await screen.findByTestId('page-report')).toBeTruthy();

    const title = screen.getByTestId('report-title');
    const actions = screen.getByTestId('report-actions');
    const css = Array.from(document.querySelectorAll('style'))
      .map((tag) => tag.textContent ?? '')
      .join('\n');

    // Every ancestor between the header row and each column's content must be
    // allowed to shrink; `min-width: auto` on any one of them is what pins the
    // row wider than its container.
    const shrinkable = (from: HTMLElement): boolean => {
      for (let node = from.parentElement; node !== null; node = node.parentElement) {
        if (node.getAttribute('data-testid') === 'page-report') return false;
        const rule = css.split('}').find((chunk) => chunk.includes(`.${node.className.split(' ').find((c) => c.startsWith('css-')) ?? 'none'}{`));
        if (rule?.includes('min-width:0') === true) return true;
      }
      return false;
    };

    expect(shrinkable(title)).toBe(true);
    expect(shrinkable(actions)).toBe(true);
  });
});
