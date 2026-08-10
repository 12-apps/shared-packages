// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { createWebReportBuilder } from '../create-report-builder';
import type {
  ReportEntityFields,
  SavedReportSummary,
  SavedReportView,
} from '../custom-reports-api';
import type { ReportRender } from '../reports-api';
import type { ReportBuilderTransport } from '../transport';

/**
 * `Este mês` and `Personalizado…` (FUT-755) — the two pills the period row was
 * missing against `prototype.html`.
 *
 * Everything here is observed at the URL the surface asks the server for, not
 * at the control. A `ToggleGroup` can look perfectly right while the request
 * already sent asked for a different window, and that is precisely the failure
 * mode this feature has: `custom` is the only preset whose meaning does not fit
 * in its own name, so a period that travels without its two dates resolves as
 * something else and NOTHING on screen says so.
 */

const TENANT = 'acme';

const RENDER: ReportRender = {
  kind: 'table',
  columns: [{ key: 'method', label: 'Forma de pagamento', format: 'text' }],
  rows: [{ method: 'PIX' }],
};

const REPORTS: SavedReportSummary[] = [
  {
    id: 'r1',
    name: 'Vendas',
    description: null,
    type: 'dashboard',
    entity: '',
    entities: ['orders'],
    blockCount: 1,
    status: 'published',
    visibility: 'tenant',
    ownedByMe: true,
    updatedAt: '2026-02-01T12:00:00.000Z',
  },
];

/**
 * The run payload, with the window the server resolved.
 *
 * 02/01 → 01/02 exclusive at UTC-03:00, i.e. the tenant's 02/01 – 31/01. The
 * picker seeds itself from exactly this, so the calendar opens on January 2026
 * with no reference to the machine's own clock — which is what keeps these
 * cases from depending on the day they are run.
 */
function view(): SavedReportView {
  return {
    id: 'r1',
    name: 'Vendas',
    description: null,
    status: 'published',
    visibility: 'tenant',
    visibilityRoles: [],
    range: {
      preset: '30d',
      from: '2026-01-02T03:00:00.000Z',
      toExclusive: '2026-02-01T03:00:00.000Z',
    },
    type: 'dashboard',
    spec: { kind: 'dashboard', blocks: [] },
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
 * Every saved-report URL the surface asked for, oldest first. A container the
 * stub MUTATES — the flakiness gate rejects a closed-over binding reassigned
 * from inside one.
 */
const asked = { urls: [] as string[] };

function stubTransport(): ReportBuilderTransport {
  const read = <T,>(url: string): Promise<T> => {
    if (url.includes('/reports/fields')) return Promise.resolve({ entities: [ENTITY] } as T);
    if (/\/reports\/custom\/[^?]+/.test(url)) {
      asked.urls.push(url);
      return Promise.resolve(view() as unknown as T);
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

/** The query string of the most recent run, so a case can read what was asked. */
function lastAsked(): string {
  const url = asked.urls[asked.urls.length - 1] ?? '';
  return url.slice(url.indexOf('?') + 1);
}

/** Every DISTINCT run URL, which is what a react-query key decides. */
function distinctAsked(): string[] {
  return [...new Set(asked.urls)];
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
    tenantSlug: TENANT,
    transport: stubTransport(),
    standalone: true,
    initialPath: url,
  });
  render(<Surface />);
}

/** Open the report, then the period picker, and wait for the calendar. */
async function openPicker(): Promise<void> {
  renderSurfaceAt(`/${TENANT}/reports/r1`);
  expect(await screen.findByTestId('report-title')).toBeTruthy();
  fireEvent.click(screen.getByTestId('report-range-item-custom'));
  expect(await screen.findByTestId('report-range-custom')).toBeTruthy();
}

/**
 * Click a day in JANUARY, the picker's first visible month.
 *
 * The picker shows TWO months, so `calendar-date-5` matches twice — once in
 * each. An unscoped query fails on the ambiguity rather than picking one,
 * which is the right behaviour and the reason this helper exists: every case
 * here means the January day, and saying so once beats each case
 * disambiguating differently.
 */
function clickJanuary(day: number): void {
  fireEvent.click(
    within(screen.getByTestId('calendar-month-0')).getByTestId(`calendar-date-${day}`),
  );
}

/**
 * Pick `from` → `to` in January 2026.
 *
 * The seeded window is already complete, so the FIRST click opens a new range
 * and the second closes it — the calendar's own rule, not something this file
 * arranges. January's matrix runs 28/12 → 31/01, so a day in the first three
 * weeks appears exactly once and needs no disambiguation.
 */
function pickJanuary(from: number, to: number): void {
  clickJanuary(from);
  clickJanuary(to);
  fireEvent.click(screen.getByTestId('report-range-custom-apply'));
}

/** One end of the picker's typed pair, as the reader sees it. */
function bound(which: 'from' | 'to'): string {
  return (screen.getByTestId(`report-range-picker-${which}`) as HTMLInputElement).value;
}

describe('the period row offers every preset the prototype does', () => {
  it('renders the five pills, in the prototype’s order', async () => {
    renderSurfaceAt(`/${TENANT}/reports/r1`);
    expect(await screen.findByTestId('report-title')).toBeTruthy();

    const labels = ['Hoje', '7 dias', '30 dias', 'Este mês', 'Personalizado…'];
    const rendered = ['today', '7d', '30d', 'month', 'custom'].map(
      (preset) => screen.getByTestId(`report-range-item-${preset}`).textContent,
    );

    expect(rendered).toEqual(labels);
  });

  it('runs the report for `month` when Este mês is chosen', async () => {
    renderSurfaceAt(`/${TENANT}/reports/r1`);
    expect(await screen.findByTestId('report-title')).toBeTruthy();

    fireEvent.click(screen.getByTestId('report-range-item-month'));

    expect(await screen.findByTestId('report-title')).toBeTruthy();
    // A rolling preset is complete as its own name: no dates ride along.
    expect(lastAsked()).toBe('preset=month');
  });
});

describe('Personalizado… asks before it applies', () => {
  it('opens the picker instead of running anything', async () => {
    await openPicker();

    // The pill is not a period. Reporting `custom` on the click would send a
    // window with nothing in it, which the server can only answer with 400.
    expect(asked.urls.every((entry) => !entry.includes('preset=custom'))).toBe(true);
    expect(lastAsked()).toBe('preset=30d');
  });

  it('opens on the window already on screen, not on a blank calendar', async () => {
    await openPicker();

    // The run payload resolved to the tenant's 02/01 – 31/01, so that is what
    // the picker starts from — choosing "Personalizado…" while reading thirty
    // days means adjusting those thirty days. Read off the two typed fields,
    // which is where the seed has to LAND for it to be editable.
    expect(bound('from')).toBe('02/01/2026');
    expect(bound('to')).toBe('31/01/2026');
  });

  it('holds Aplicar until BOTH ends are chosen', async () => {
    await openPicker();

    clickJanuary(5);

    // Half a range is not a period, and the button says so rather than the
    // server saying it afterwards.
    const apply = screen.getByTestId('report-range-custom-apply');
    expect(apply.hasAttribute('disabled')).toBe(true);

    clickJanuary(9);
    await waitFor(() => {
      expect(screen.getByTestId('report-range-custom-apply').hasAttribute('disabled')).toBe(false);
    });
  });

  it('sends both dates with the preset once confirmed', async () => {
    await openPicker();

    pickJanuary(5, 9);

    expect(await screen.findByTestId('report-title')).toBeTruthy();
    expect(lastAsked()).toBe('preset=custom&from=2026-01-05&to=2026-01-09');
  });

  it('leaves the pill showing as the selected period', async () => {
    await openPicker();

    pickJanuary(5, 9);
    expect(await screen.findByTestId('report-title')).toBeTruthy();

    expect(screen.getByTestId('report-range-item-custom').getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByTestId('report-range-item-30d').getAttribute('aria-pressed')).toBe('false');
  });

  it('changes nothing when the picker is cancelled', async () => {
    await openPicker();

    clickJanuary(5);
    clickJanuary(9);
    fireEvent.click(screen.getByTestId('report-range-custom-cancel'));

    // The dialog leaves on a transition, so its node outlives the click.
    await waitFor(() => {
      expect(screen.queryByTestId('report-range-custom')).toBe(null);
    });
    expect(lastAsked()).toBe('preset=30d');
    expect(screen.getByTestId('report-range-item-30d').getAttribute('aria-pressed')).toBe('true');
  });

  it('re-opens from the pill once that pill is the selected period', async () => {
    await openPicker();
    pickJanuary(5, 9);
    expect(await screen.findByTestId('report-title')).toBeTruthy();

    // An exclusive ToggleGroup reports `null` for a click on the pill that is
    // already selected, so this click carries no preset at all. It is still
    // the only route back into the picker — without it a custom window could
    // be set once and never adjusted without first leaving for another preset.
    fireEvent.click(screen.getByTestId('report-range-item-custom'));

    expect(await screen.findByTestId('report-range-custom')).toBeTruthy();
  });

  it('starts the next open from the applied window, not from the cancelled pick', async () => {
    await openPicker();
    clickJanuary(5);
    fireEvent.click(screen.getByTestId('report-range-custom-cancel'));

    fireEvent.click(screen.getByTestId('report-range-item-custom'));

    // Scratch state, dropped: a cancelled pick must not be what the next open
    // resumes from.
    expect(await screen.findByTestId('report-range-custom')).toBeTruthy();
    expect(bound('from')).toBe('02/01/2026');
    expect(bound('to')).toBe('31/01/2026');
  });
});

/**
 * The dialog is a THIN consumer of `@12-apps/ui/form/DateRangePicker` (FUT-755).
 *
 * The picker's own behaviour — which days each quick range covers, what a
 * reversed pair does, how the cap refuses — is tested where it lives, in the
 * design system, on a frozen clock. What can only be checked HERE is the
 * wiring: that the quick column is on screen, that the two typed fields reach
 * the request, and that a quick entry which IS one of our presets is applied as
 * that preset rather than as an identical-looking custom window.
 */
describe('the picker is wired to the reports surface', () => {
  it('offers the quick column, including periods the pills do not have', async () => {
    await openPicker();

    // The whole reason the column exists: "Este trimestre" is not a pill and
    // could otherwise only be reached by paging the calendar back to 1 July.
    expect(screen.getByTestId('report-range-picker-quick-this-quarter').textContent).toContain(
      'Este trimestre',
    );
    expect(screen.getByTestId('report-range-picker-quick-yesterday').textContent).toContain(
      'Ontem',
    );
  });

  it('sends a typed pair, so the fields are a real way in', async () => {
    await openPicker();

    fireEvent.change(screen.getByTestId('report-range-picker-from'), {
      target: { value: '07/01/2026' },
    });
    fireEvent.change(screen.getByTestId('report-range-picker-to'), {
      target: { value: '09/01/2026' },
    });
    fireEvent.click(screen.getByTestId('report-range-custom-apply'));

    expect(await screen.findByTestId('report-title')).toBeTruthy();
    expect(lastAsked()).toBe('preset=custom&from=2026-01-07&to=2026-01-09');
  });

  it('holds Aplicar shut on a reversed pair rather than sending it', async () => {
    await openPicker();

    fireEvent.change(screen.getByTestId('report-range-picker-to'), {
      target: { value: '01/01/2026' },
    });

    // 02/01 → 01/01. The server would answer this with a 400; the button that
    // would send it is the one that says so.
    const apply = screen.getByTestId('report-range-custom-apply');
    expect(apply.hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('report-range-picker-status').textContent).toBe(
      'A data final deve ser igual ou posterior à inicial.',
    );
  });

  it('applies "Hoje" as the PRESET, not as a custom window of today', async () => {
    await openPicker();

    fireEvent.click(screen.getByTestId('report-range-picker-quick-today'));
    fireEvent.click(screen.getByTestId('report-range-custom-apply'));

    expect(await screen.findByTestId('report-title')).toBeTruthy();
    // `preset=today` re-resolves on every run; `custom` with today's two dates
    // would freeze one day forever under a pill reading "Personalizado…".
    expect(lastAsked()).toBe('preset=today');
    expect(screen.getByTestId('report-range-item-today').getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('applies a quick period the pills do NOT have as a custom window', async () => {
    await openPicker();

    fireEvent.click(screen.getByTestId('report-range-picker-quick-yesterday'));
    fireEvent.click(screen.getByTestId('report-range-custom-apply'));

    expect(await screen.findByTestId('report-title')).toBeTruthy();
    // "Ontem" is no preset of ours, so it travels as the two dates it is.
    expect(lastAsked()).toContain('preset=custom&from=');
    expect(screen.getByTestId('report-range-item-custom').getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
});

/**
 * The bug class that made the period control look broken before: a react-query
 * key that carries the preset but not the dates.
 *
 * Two custom windows share the word `custom`, so a key built from the preset
 * alone files them under one entry — the second window is answered from the
 * first's cache, no request is made, and the screen keeps showing the window
 * you just replaced. Nothing errors; the control simply appears not to work.
 */
describe('two custom windows are two different results', () => {
  it('re-runs the report for the second window instead of serving the first', async () => {
    await openPicker();
    pickJanuary(5, 9);
    expect(await screen.findByTestId('report-title')).toBeTruthy();

    fireEvent.click(screen.getByTestId('report-range-item-custom'));
    expect(await screen.findByTestId('report-range-custom')).toBeTruthy();
    pickJanuary(12, 20);
    expect(await screen.findByTestId('report-title')).toBeTruthy();

    const custom = distinctAsked().filter((entry) => entry.includes('preset=custom'));
    expect(custom).toHaveLength(2);
    expect(lastAsked()).toBe('preset=custom&from=2026-01-12&to=2026-01-20');
  });
});

/**
 * The pill is opt-in per surface, and the editor has not opted in.
 *
 * A block holds its period as a bare preset all the way down to
 * `useRunReport`, so the two dates have nowhere to travel from here — offering
 * the pill would be a 400 per block. `Este mês` needs no dates and IS offered,
 * which is what makes the distinction a rule rather than an omission.
 */
describe('the editor’s preview toolbar offers rolling presets only', () => {
  it('has Este mês and no Personalizado…', async () => {
    renderSurfaceAt(`/${TENANT}/reports/new`);

    expect(await screen.findByTestId('page-report-editor')).toBeTruthy();
    expect(screen.getByTestId('report-editor-range-item-month')).toBeTruthy();
    expect(screen.queryByTestId('report-editor-range-item-custom')).toBe(null);
  });
});
