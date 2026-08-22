// @vitest-environment jsdom
import { PT_BR_REPORT_ENGINE_COPY } from '../../pt-BR';
import { PT_BR_BLANK_BLOCK_TEMPLATE_COPY } from '../../server/pt-BR';
import { PT_BR_REPORT_SCREENS_COPY } from '../pt-BR';
import { useState, type JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithCopy as render } from './with-copy';

import { createWebReportBuilder } from '../create-report-builder';
import { TEST_SURFACE } from './surface-fixture';
import type {
  ReportEntityFields,
  ReportSpecWire,
  SavedReportSummary,
  SavedReportView } from '../custom-reports-api';
import { useKeyboardReorder } from '../lib/drag-reorder';
import { blockLabel, moveBlock, type ReportDraft } from '../report-model';
import type { ReportRender } from '../reports-api';
import type { ReportBuilderTransport } from '../transport';

/** The block words, from the pack a host would pass. */
const BUILDER = PT_BR_REPORT_SCREENS_COPY.builder;

/**
 * Keyboard reordering on the editor canvas (FUT-755) — the `@drag @a11y`
 * scenarios of `specs/editor-direct-manipulation.feature`.
 *
 * Reordering used to be pointer-only: `drag-reorder.ts`'s header claimed
 * keyboard users had up/down buttons, and no such control existed anywhere in
 * `src/react`. That is a WCAG 2.1.1 failure, so these cases are written the
 * way the scenarios are — Alt+↑/↓ on a focused block, the exact announcement,
 * focus retained, and the BOUNDARIES as no-ops rather than as errors.
 *
 * They drive the whole routed surface at `/:reportId/edit`, not the canvas in
 * isolation, because two of the four assertions only exist there: the dirty
 * marker is derived by the editor from the draft, and focus retention is a
 * claim about the real re-render. The transport is stubbed, so nothing here
 * reaches the network.
 *
 * Every no-op case carries a CONTROL in the same test — the identical key
 * path, one step in the legal direction, moving/announcing/dirtying. Without
 * it, "no announcement" would also pass against a canvas that rendered
 * nothing at all.
 */

const TENANT = 'acme';
const REPORT_ID = 'rel-1';

/** The five blocks, in saved order. Position is 1-based throughout the spec. */
const TITLES = [
  'Receita no período',
  'Produtos mais vendidos',
  'Ticket médio',
  'Receita por dia',
  'Pedidos por hora',
] as const;

const BLOCK_SPEC: ReportSpecWire = {
  entity: 'orders',
  dimensions: [{ field: 'method' }],
  measures: [{ field: 'revenueCents', aggregation: 'sum' }],
  filters: [],
  sort: [],
  presentation: { kind: 'table' } };

const RENDER: ReportRender = {
  kind: 'table',
  columns: [
    { key: 'method', label: 'Forma de pagamento', format: 'text' },
    { key: 'revenueCents', label: 'Receita', format: 'brl' },
  ],
  rows: [{ method: 'PIX', revenueCents: 123456 }] };

const RANGE = {
  preset: '30d' as const,
  from: '2026-01-02T03:00:00.000Z',
  toExclusive: '2026-02-01T03:00:00.000Z' };

const SUMMARY: SavedReportSummary = {
  id: REPORT_ID,
  name: 'Painel da loja',
  description: null,
  type: 'dashboard',
  entity: 'orders',
  entities: ['orders'],
  blockCount: 2,
  status: 'published',
  visibility: 'tenant',
  ownedByMe: true,
  updatedAt: '2026-02-01T12:00:00.000Z' };

const VIEW: SavedReportView = {
  id: REPORT_ID,
  name: 'Painel da loja',
  description: 'Cinco blocos, para ter posições a mover.',
  status: 'published',
  visibility: 'tenant',
  visibilityRoles: [],
  range: RANGE,
  type: 'dashboard',
  spec: {
    kind: 'dashboard',
    blocks: TITLES.map((title, index) => ({
      id: `bloco-${index + 1}`,
      title,
      span: 6,
      spec: BLOCK_SPEC })) },
  blocks: TITLES.map((title, index) => ({
    id: `bloco-${index + 1}`,
    title,
    span: 6,
    sentence: 'soma de Receita por Forma de pagamento',
    status: 'ok' as const,
    render: RENDER })) };

const ENTITY: ReportEntityFields = {
  entity: 'orders',
  label: 'Pedidos',
  fields: [
    { field: 'method', label: 'Forma de pagamento', type: 'string', role: 'dimension' },
    { field: 'revenueCents', label: 'Receita', type: 'money', role: 'measure' },
  ] };

/**
 * The whole backend, in memory. `ReportBuilderTransport` is this package's
 * only I/O seam, so answering these paths substitutes the entire server.
 */
function stubTransport(): ReportBuilderTransport {
  const read = <T,>(url: string): Promise<T> => {
    if (url.includes('/reports/fields')) return Promise.resolve({ entities: [ENTITY] } as T);
    if (url.includes(`/reports/custom/${REPORT_ID}`)) {
      return Promise.resolve(VIEW as unknown as T);
    }
    if (url.includes('/reports/custom')) return Promise.resolve({ reports: [SUMMARY] } as T);
    return Promise.reject(new Error(`unexpected read: ${url}`));
  };
  return {
    get: read,
    getRaw: read,
    // Each block dry-runs its spec through this while the editor is open.
    send: <T,>() =>
      Promise.resolve({
        ok: true as const,
        data: { range: RANGE, render: RENDER } as unknown as T }) };
}

/** The editor, opened on the saved five-block report. */
function renderEditor(): void {
  const { page: Surface } = createWebReportBuilder({
    surface: TEST_SURFACE,
    copy: {
      engine: PT_BR_REPORT_ENGINE_COPY,
      blankTemplate: PT_BR_BLANK_BLOCK_TEMPLATE_COPY,
      screens: PT_BR_REPORT_SCREENS_COPY },
    tenantSlug: TENANT,
    transport: stubTransport(),
    standalone: true,
    initialPath: `/${TENANT}/reports/${REPORT_ID}/edit` });
  render(<Surface />);
}

/** The canvas only: the period ToggleGroup outside it is a `group` as well. */
function canvas(): HTMLElement {
  return screen.getByTestId('report-editor-grid');
}

/** The block titles in canvas order, read off the blocks themselves. */
function blockOrder(): string[] {
  return within(canvas())
    .getAllByRole('group')
    .map((block) => block.getAttribute('aria-label') ?? '');
}

function blockNamed(title: string): HTMLElement {
  return within(canvas()).getByRole('group', { name: title });
}

/** What a screen reader would have been told, verbatim. */
function announcement(): string {
  return screen.getByTestId('report-editor-live-region').textContent ?? '';
}

/** The editor's "Alterações não salvas" marker — present only when dirty. */
function dirtyMarkers(): HTMLElement[] {
  return screen.queryAllByTestId('report-editor-dirty');
}

/** Focus a block and press a chord on it, the way a keyboard user would. */
function press(block: HTMLElement, key: string, altKey: boolean): void {
  // eslint-disable-next-line test-flakiness/no-focus-check, test-flakiness/await-async-events -- not a check: the scenarios are "given focus is on the block", so the focus has to be real before the chord is pressed.
  block.focus();
  fireEvent.keyDown(block, { key, altKey });
}

/** Open the editor and settle it, returning the untouched starting order. */
async function openEditor(): Promise<void> {
  renderEditor();
  await screen.findByTestId('report-editor-save');
  // Preconditions, and the positive control for every negative below: the
  // five blocks really are on screen, in order, on a report nobody has
  // changed yet.
  expect(blockOrder()).toEqual([...TITLES]);
  expect(dirtyMarkers()).toEqual([]);
  expect(announcement()).toBe('');
}

const realMatchMedia = window.matchMedia;

/**
 * `useMediaQuery` reads `window.matchMedia`, which jsdom does not implement.
 * Answering "no" to every query keeps the surface on one layout branch instead
 * of inheriting whatever a missing global happens to do. Installed per test
 * with a restore, so the mutation cannot leak into another suite.
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
    dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  window.matchMedia = realMatchMedia;
});

describe('editor canvas — Alt+↑/↓ reorders a block', () => {
  it('moves the focused block one position UP', async () => {
    await openEditor();

    press(blockNamed('Receita por dia'), 'ArrowUp', true);

    await waitFor(() => {
      expect(blockOrder()).toEqual([
        'Receita no período',
        'Produtos mais vendidos',
        'Receita por dia',
        'Ticket médio',
        'Pedidos por hora',
      ]);
    });
  });

  it('moves the focused block one position DOWN', async () => {
    await openEditor();

    press(blockNamed('Receita por dia'), 'ArrowDown', true);

    await waitFor(() => {
      expect(blockOrder()).toEqual([
        'Receita no período',
        'Produtos mais vendidos',
        'Ticket médio',
        'Pedidos por hora',
        'Receita por dia',
      ]);
    });
  });

  it.each([
    ['ArrowUp', 'Receita por dia movido para a posição 3 de 5'],
    ['ArrowDown', 'Receita por dia movido para a posição 5 de 5'],
  ])('announces the new position after Alt+%s', async (key, expected) => {
    await openEditor();

    press(blockNamed('Receita por dia'), key, true);

    // Exact, not a substring: the position and the total are the whole point
    // of the sentence, and "movido para a posição 4 de 5" would still contain
    // every word a loose match looks for.
    await waitFor(() => {
      expect(announcement()).toBe(expected);
    });
  });

  it('keeps focus on the block that moved', async () => {
    await openEditor();

    press(blockNamed('Receita por dia'), 'ArrowUp', true);
    await waitFor(() => {
      expect(announcement()).toBe('Receita por dia movido para a posição 3 de 5');
    });

    // eslint-disable-next-line test-flakiness/no-focus-check -- focus retention IS the requirement (WCAG 2.1.1): a move that drops focus to <body> strands the keyboard user, who then cannot press the chord again.
    expect(document.activeElement).toBe(blockNamed('Receita por dia'));
  });

  it('marks the report as having unsaved changes', async () => {
    await openEditor();

    press(blockNamed('Receita por dia'), 'ArrowUp', true);

    await waitFor(() => {
      expect(dirtyMarkers()).toHaveLength(1);
    });
    expect(screen.getByTestId('report-editor-dirty').textContent).toBe('Alterações não salvas');
  });
});

describe('editor canvas — the ends of the list are a no-op, not an error', () => {
  it('does nothing when the FIRST block is moved up', async () => {
    await openEditor();
    const first = blockNamed('Receita no período');

    press(first, 'ArrowUp', true);

    expect(blockOrder()).toEqual([...TITLES]);
    expect(announcement()).toBe('');
    expect(dirtyMarkers()).toEqual([]);

    // The control: the same block, the same handler, one step the other way
    // does all three. Without this the three assertions above would pass just
    // as well against a canvas that had failed to render.
    press(first, 'ArrowDown', true);
    await waitFor(() => {
      expect(announcement()).toBe('Receita no período movido para a posição 2 de 5');
    });
    expect(dirtyMarkers()).toHaveLength(1);
  });

  it('does nothing when the LAST block is moved down', async () => {
    await openEditor();
    const last = blockNamed('Pedidos por hora');

    press(last, 'ArrowDown', true);

    expect(blockOrder()).toEqual([...TITLES]);
    expect(announcement()).toBe('');
    expect(dirtyMarkers()).toEqual([]);

    press(last, 'ArrowUp', true);
    await waitFor(() => {
      expect(announcement()).toBe('Pedidos por hora movido para a posição 4 de 5');
    });
    expect(dirtyMarkers()).toHaveLength(1);
  });

  it('leaves a bare arrow key alone — the chord is Alt, and only Alt', async () => {
    await openEditor();
    const block = blockNamed('Receita por dia');

    press(block, 'ArrowUp', false);

    expect(blockOrder()).toEqual([...TITLES]);
    expect(announcement()).toBe('');
    expect(dirtyMarkers()).toEqual([]);

    press(block, 'ArrowUp', true);
    await waitFor(() => {
      expect(announcement()).toBe('Receita por dia movido para a posição 3 de 5');
    });
  });
});

describe('editor canvas — the block is a named tab stop that advertises the chord', () => {
  it('names every block and publishes its shortcut', async () => {
    await openEditor();

    const stops = within(canvas())
      .getAllByRole('group')
      .map((block) => `${block.getAttribute('tabindex')}|${block.getAttribute('aria-keyshortcuts')}`);

    // One distinct value across all five: every block is a tab stop, and every
    // one of them advertises the chord. `openEditor` already pinned the count,
    // so an empty canvas cannot satisfy this.
    expect(stops).toHaveLength(5);
    expect(new Set(stops)).toEqual(new Set(['0|Alt+ArrowUp Alt+ArrowDown']));
  });

  it('keeps the live region polite and out of the visual flow', async () => {
    await openEditor();

    const live = screen.getByTestId('report-editor-live-region');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.getAttribute('role')).toBe('status');
  });
});

/**
 * The canvas keys its blocks by id, so React MOVES their nodes rather than
 * rebuilding them — and jsdom, unlike a browser, keeps focus on a node it
 * moves with `insertBefore`. On the real surface focus retention is therefore
 * unfalsifiable: it holds whether or not the hook restores anything.
 *
 * This harness is the same wiring as `EditorCanvas` (the same hook, the same
 * `moveBlock`) over rows whose key carries their POSITION, so a move destroys
 * and recreates the focused element and focus really is lost. What is left
 * standing afterwards is the hook's restoration, and nothing else.
 */
function ReorderHarness(): JSX.Element {
  const [draft, setDraft] = useState<ReportDraft>(() => ({
    name: 'Harness',
    description: '',
    blocks: ['Alfa', 'Beta', 'Gama'].map((title, index) => ({
      id: `bloco-${index + 1}`,
      title,
      span: 6,
      spec: BLOCK_SPEC })) }));
  const keyboard = useKeyboardReorder({
    items: draft.blocks.map((block) => ({ id: block.id, label: blockLabel(block, BUILDER) })),
    onMove: (id, delta) => setDraft((current) => moveBlock(current, id, delta)) });
  return (
    <div>
      {draft.blocks.map((block, position) => (
        <div
          key={`${block.id}-${position}`}
          {...keyboard.blockProps(block.id)}
          role="group"
          aria-label={block.title}
        />
      ))}
      <p data-testid="harness-live-region">{keyboard.announcement}</p>
    </div>
  );
}

describe('useKeyboardReorder — focus follows the block, not the position', () => {
  it('restores focus to the moved block even when its element is rebuilt', async () => {
    render(<ReorderHarness />);

    // eslint-disable-next-line test-flakiness/no-focus-check, test-flakiness/await-async-events -- not a check: the block has to genuinely hold focus before the chord, or there is nothing for the move to preserve.
    screen.getByRole('group', { name: 'Beta' }).focus();
    fireEvent.keyDown(screen.getByRole('group', { name: 'Beta' }), {
      key: 'ArrowUp',
      altKey: true });

    await waitFor(() => {
      expect(screen.getByTestId('harness-live-region').textContent).toBe(
        'Beta movido para a posição 1 de 3',
      );
    });
    // eslint-disable-next-line test-flakiness/no-focus-check -- focus retention IS the requirement (WCAG 2.1.1): a move that leaves focus on <body> strands the keyboard user, who then cannot press the chord again.
    expect(document.activeElement).toBe(screen.getByRole('group', { name: 'Beta' }));
  });

  it('leaves focus alone when the move is refused at the top', async () => {
    render(<ReorderHarness />);

    const first = screen.getByRole('group', { name: 'Alfa' });
    // eslint-disable-next-line test-flakiness/no-focus-check, test-flakiness/await-async-events -- not a check: the refused move must leave a REAL focus where it was.
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowUp', altKey: true });

    expect(screen.getByTestId('harness-live-region').textContent).toBe('');
    // eslint-disable-next-line test-flakiness/no-focus-check -- the no-op must not move focus either; that is the assertion.
    expect(document.activeElement).toBe(first);

    // The control, again: the same element, one step the legal way, does move.
    fireEvent.keyDown(first, { key: 'ArrowDown', altKey: true });
    await waitFor(() => {
      expect(screen.getByTestId('harness-live-region').textContent).toBe(
        'Alfa movido para a posição 2 de 3',
      );
    });
  });
});

describe('blockLabel — what a move is announced as', () => {
  it('speaks a block by its own title', () => {
    expect(blockLabel({ id: 'bloco-1', title: 'Receita por dia', span: 6, spec: BLOCK_SPEC }, BUILDER)).toBe(
      'Receita por dia',
    );
  });

  it.each(['', '   '])('names an untitled block without using its position', (title) => {
    // Not "Bloco 4": a positional name renames itself as the block moves, so
    // the announcement would describe a block that no longer exists under it.
    expect(blockLabel({ id: 'bloco-4', title, span: 6, spec: BLOCK_SPEC }, BUILDER)).toBe('Bloco sem título');
  });
});
