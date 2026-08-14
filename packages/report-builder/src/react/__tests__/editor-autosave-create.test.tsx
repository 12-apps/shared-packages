// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { createWebReportBuilder } from '../create-report-builder';
import { TEST_SURFACE } from './surface-fixture';
import { defaultPublishDraft } from '../lib/publish-section';
import type {
  ReportEntityFields,
  SavedReportSummary,
  SavedReportView,
} from '../custom-reports-api';
import type { ReportRender } from '../reports-api';
import type { ReportBuilderTransport } from '../transport';

/**
 * A report that has never been saved is autosaved too, by CREATING it
 * (FUT-755).
 *
 * That was deliberately excluded when the working copy landed: there is no row
 * to park an edit against, and creating one behind the author's back would
 * drop half-built reports into everyone's list. The exclusion is gone because
 * its premise is — a new report now starts as a PRIVATE DRAFT, so the row this
 * creates is visible to its author and to nobody else.
 *
 * Which makes the default load-bearing rather than cosmetic, and it is the
 * first thing pinned here: if a new report ever goes back to starting
 * published, autosave starts broadcasting half-built reports to the store.
 */

const TENANT = 'acme';

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
  starter: {
    entity: 'orders',
    dimensions: [{ field: 'method' }],
    measures: [{ field: 'revenueCents', aggregation: 'sum' }],
    filters: [],
    sort: [],
    presentation: { kind: 'table' },
  },
};

const SUMMARY: SavedReportSummary = {
  id: 'rel-1',
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

const CREATED_ID = 'novo-1';

/**
 * What the server returns once the report EXISTS. The editor navigates to the
 * new id after creating, so without this the surface lands on a report the
 * stub has never heard of and the header disappears — which reads as "the
 * create failed" when it is really "the fixture stopped short".
 */
const CREATED_VIEW: SavedReportView = {
  id: CREATED_ID,
  name: 'Relatório novo',
  description: null,
  status: 'draft',
  visibility: 'private',
  visibilityRoles: [],
  defaultRange: '30d',
  range: RANGE,
  type: 'dashboard',
  spec: { kind: 'dashboard', blocks: [] },
  blocks: [],
};

interface SentCall {
  url: string;
  method: string;
  body: unknown;
}

/**
 * The backend, in memory, RECORDING every write.
 *
 * A container rather than a closed-over array reassigned from the stub: the
 * flakiness gate rejects the latter, and mutating one object is what the rest
 * of these suites do.
 */
function stubTransport(sent: { calls: SentCall[] }): ReportBuilderTransport {
  const read = <T,>(url: string): Promise<T> => {
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
    send: <T,>(url: string, method: string, body?: unknown) => {
      sent.calls.push({ url, method, body });
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

/** Writes that are report saves — the run endpoint is not one. */
function saves(sent: { calls: SentCall[] }): SentCall[] {
  return sent.calls.filter((call) => !call.url.includes('/reports/run'));
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

async function openNewReport(sent: { calls: SentCall[] }): Promise<void> {
  const { page: Surface } = createWebReportBuilder({
    surface: TEST_SURFACE,
    tenantSlug: TENANT,
    transport: stubTransport(sent),
    standalone: true,
    initialPath: `/${TENANT}/reports/new`,
  });
  render(<Surface />);
  await screen.findByTestId('report-editor-save');
}

/**
 * Make the new report valid enough to be created: it needs a NAME and at
 * least one block, which is the same guard the manual save applies. Autosave
 * deliberately shares it — creating an invalid document would 400 on every
 * tick of the timer.
 */
async function makeCreatable(): Promise<void> {
  await addFirstBlock();
  fireEvent.change(screen.getByTestId('report-editor-name'), {
    target: { value: 'Relatório novo' },
  });
}

async function addFirstBlock(): Promise<void> {
  // The blank template is the one that exists for ANY catalog — the named
  // ones are filtered against entity starters, and this stub has one entity.
  const template = await screen.findByTestId('block-template-picker-blank');
  fireEvent.click(template);
  await waitFor(() => {
    expect(screen.queryByTestId('block-template-picker')).toBeNull();
  });
}

describe('a new report starts private', () => {
  it('defaults to a draft nobody else can see', () => {
    // The whole safety argument for autosaving an unsaved report rests on this
    // one function. Asserting the shape rather than a snapshot so the reason a
    // failure matters is legible: published + autosave = broadcasting.
    expect(defaultPublishDraft()).toEqual({
      status: 'draft',
      visibility: 'private',
      visibilityRoles: [],
    });
  });
});

describe('autosaving a report that has never been saved', () => {
  it('creates it exactly once, however many edits follow', async () => {
    const sent = { calls: [] as SentCall[] };
    await openNewReport(sent);
    await makeCreatable();

    await waitFor(
      () => {
        expect(saves(sent).length).toBeGreaterThan(0);
      },
      { timeout: 4000 },
    );

    const created = saves(sent)[0];
    expect(created?.method).toBe('POST');

    // Creating navigates to the new id, so the editor reloads that report —
    // wait for the header to come back before typing into it.
    const name = await screen.findByTestId('report-editor-name');

    // Keep editing. A second create here is the bug this whole test exists
    // for: the timer would see no route id yet and start a twin report.
    fireEvent.change(name, { target: { value: 'Relatório do mês' } });
    fireEvent.change(name, { target: { value: 'Relatório do mês inteiro' } });

    await waitFor(
      () => {
        expect(saves(sent).filter((call) => call.method === 'POST').length).toBe(1);
      },
      { timeout: 4000 },
    );
  });

  it('creates it as a draft, not published to the store', async () => {
    const sent = { calls: [] as SentCall[] };
    await openNewReport(sent);
    await makeCreatable();

    await waitFor(
      () => {
        expect(saves(sent).length).toBeGreaterThan(0);
      },
      { timeout: 4000 },
    );

    const body = saves(sent)[0]?.body as { status?: string; visibility?: string } | undefined;
    expect(body?.status).toBe('draft');
    expect(body?.visibility).toBe('private');
  });
});
