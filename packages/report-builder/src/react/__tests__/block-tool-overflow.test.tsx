// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { JSX } from 'react';

import type { DashboardBlockRender, SavedReportView } from '../custom-reports-api';
import type { DragReorder, KeyboardReorder } from '../lib/drag-reorder';
import { EditableBlock } from '../report-editor-block';
import { ReportViewCanvas } from '../report-view';
import type { ReportRender } from '../reports-api';

/**
 * THE TOOL CLUSTER IS PINNED TOP-RIGHT, AND IT NEVER WRAPS (FUT-755, gap 18).
 *
 * The header row used to be `flexWrap: "wrap"`, so a block too narrow for
 * title + chrome put ✎ ⋮ 🗑 on a SECOND LINE, left-aligned under the title.
 * That was a deliberate trade against a worse bug — an earlier row overflowed
 * at 390px and pushed ⋮ clean off-screen, and ⋮ was the only route to Editar —
 * and overflowing into the menu is the answer that costs neither.
 *
 * jsdom reports every element as 0×0 and has no `ResizeObserver`, so a
 * measured rule would collapse everything into the menu (or nothing into it)
 * for reasons that have nothing to do with the rule. These tests install a
 * `ResizeObserver` that reports whatever width the case asks for — the same
 * device `data-views-overflow.test.tsx` uses, and the only honest way to test
 * something whose whole point is that it MEASURES rather than breakpoints.
 * `WIDE` and `NARROW` below are the two answers it gives.
 */

/**
 * Roomy enough for every tool: the title's 140px floor plus four icon slots.
 * A 6-span block on a 1440px canvas measures about this.
 */
const WIDE = 400;

/**
 * One icon slot past the title's floor. Enough for the ⋮ and ONE tool, which
 * is what makes the ranking observable: something has to be chosen.
 */
const NARROW = 210;

/** No room for any tool at all — everything must be reachable through ⋮. */
const CRAMPED = 150;

const CHART_RENDER: ReportRender = {
  kind: 'chart',
  chartSpec: {
    type: 'bar',
    xAxis: { key: 'day', label: 'Data (dia)' },
    series: [{ key: 'revenueCents', label: 'Receita' }],
    numberFormat: 'brl',
  },
  tableColumns: [
    { key: 'day', label: 'Data (dia)', format: 'text' },
    { key: 'revenueCents', label: 'Receita', format: 'brl' },
  ],
  rows: [{ day: '01/08', revenueCents: 125_00 }],
};

const CHART_BLOCK: DashboardBlockRender = {
  id: 'grafico',
  title: 'Receita por dia',
  span: 6,
  sentence: 'soma de receita em pedidos por dia',
  status: 'ok',
  render: CHART_RENDER,
};

function viewOf(blocks: DashboardBlockRender[]): SavedReportView {
  return {
    id: 'rel-1',
    name: 'Relatório',
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
    blocks,
  };
}

/**
 * A `ResizeObserver` reporting a fixed content width, fired synchronously on
 * `observe` — a real one delivers its first callback a frame later, which
 * would only make every assertion wait on a timer.
 */
function stubResizeObserver(width: number): void {
  class FakeResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element): void {
      this.callback(
        [{ target, contentRect: { width } } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
}

/** The record of what `moveBlock`/`onRemove` were asked to do. */
const calls: { removed: number; moved: string[] } = { removed: 0, moved: [] };

const DND: DragReorder = {
  overId: null,
  handleProps: () => ({ draggable: true, onDragStart: () => undefined, onDragEnd: () => undefined }),
  targetProps: () => ({
    onDragOver: () => undefined,
    onDragLeave: () => undefined,
    onDrop: () => undefined,
  }),
};

const KEYBOARD: KeyboardReorder = {
  announcement: '',
  blockProps: () => ({ tabIndex: 0, onKeyDown: () => undefined, ref: () => undefined }),
  move: (id, delta) => calls.moved.push(`${id}:${delta}`),
  canMove: () => true,
};

/** The editor's block, at a measured width. Its preview is allowed to fail. */
function renderEditorBlock(width: number): void {
  stubResizeObserver(width);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const block = { id: 'bloco-1', title: 'Bloco 1', span: 6, spec: {} as never };
  const tree = (): JSX.Element => (
    <QueryClientProvider client={client}>
      <EditableBlock
        tenantSlug="acme"
        block={block}
        range="30d"
        dnd={DND}
        keyboard={KEYBOARD}
        selected={false}
        onSelect={() => undefined}
        onTitleChange={() => undefined}
        onRemove={() => {
          calls.removed += 1;
        }}
      />
    </QueryClientProvider>
  );
  render(tree());
}

/** The viewer's canvas, at a measured width. */
function renderViewBlock(width: number): void {
  stubResizeObserver(width);
  render(<ReportViewCanvas view={viewOf([CHART_BLOCK])} />);
}

/** Open a block's ⋮ and hand back the ids of what is in it. */
async function openMenu(testId: string): Promise<HTMLElement[]> {
  fireEvent.click(screen.getByTestId(testId));
  return screen.findAllByRole('menuitem');
}

beforeEach(() => {
  calls.removed = 0;
  calls.moved = [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The declarations emotion emitted for `className`, or `''`. */
function ruleFor(className: string): string {
  const css = Array.from(document.querySelectorAll('style'))
    .map((style) => style.textContent ?? '')
    .join('\n');
  const at = css.indexOf(`.${className}{`);
  return at === -1 ? '' : css.slice(at + className.length + 2, css.indexOf('}', at));
}

/** The declarations of whichever of an element's classes emotion styled. */
function emittedFor(element: HTMLElement): string {
  return Array.from(element.classList)
    .map((name) => ruleFor(name))
    .join(';');
}

describe('the header row never puts the chrome on a second line', () => {
  it('lays the row out `nowrap`, whatever it is carrying', () => {
    renderViewBlock(WIDE);
    const cluster = document.querySelector('[data-block-tools]');
    const row = cluster?.parentElement;

    expect(row).not.toBeNull();
    // The reversal itself, asserted on the ROW rather than on the stylesheet:
    // the canvas around it is legitimately `flex-wrap: wrap` (that is what
    // closes its last row), so a document-wide sweep would only ever find it.
    const declarations = emittedFor(row as HTMLElement);
    expect(declarations).toContain('flex-wrap:nowrap');
    expect(declarations).not.toContain('flex-wrap:wrap;');
  });

  it('gives the title a floor rather than letting it push the tools out', () => {
    renderViewBlock(WIDE);
    const title = document.querySelector('[data-block-tools]')?.previousElementSibling;

    expect(title).not.toBeNull();
    // The same 140 the cluster prices the title at. A CSS floor that let the
    // title take more than the arithmetic assumed would shed nothing and
    // overflow anyway — the bug, one level down.
    expect(emittedFor(title as HTMLElement)).toContain('min-width:140px');
  });
});

describe('edit mode — ✎ and 🗑 shed into ⋮, the trash first', () => {
  it('shows both tools and the ⋮ when the block is wide enough', async () => {
    renderEditorBlock(WIDE);

    expect(await screen.findByTestId('report-block-bloco-1-edit')).not.toBeNull();
    expect(screen.getByTestId('report-block-bloco-1-remove')).not.toBeNull();
    // ⋮ is always on the row in edit mode: it carries the move actions at every
    // width, so the escape hatch is never itself missing.
    expect(screen.getByTestId('report-block-bloco-1-menu')).not.toBeNull();
  });

  it('sheds the TRASH first — ✎ is the primary action, 🗑 the costly one', async () => {
    renderEditorBlock(NARROW);

    // The pencil keeps the visible slot…
    expect(await screen.findByTestId('report-block-bloco-1-edit')).not.toBeNull();
    // …and the trash is one deliberate step further away, which is the right
    // direction for a destructive action to move.
    const items = await openMenu('report-block-bloco-1-menu');
    expect(items.map((item) => item.textContent)).toContain('Remover bloco');
  });

  it('keeps the trash\'s test id when it moves into the menu', async () => {
    renderEditorBlock(NARROW);
    await screen.findByTestId('report-block-bloco-1-edit');
    await openMenu('report-block-bloco-1-menu');

    // the origin host's reports e2e drives `${testId}-remove`. An id that exists on
    // a desktop and not on a laptop is a suite that fails for the width.
    const remove = screen.getByTestId('report-block-bloco-1-remove');
    fireEvent.click(remove);
    // Same handler, so the canvas's confirmation opens exactly as it does from
    // the icon — the menu row is not a second implementation.
    expect(calls.removed).toBe(1);
  });

  it('puts the destructive item LAST in the menu, under the move actions', async () => {
    renderEditorBlock(NARROW);
    await screen.findByTestId('report-block-bloco-1-edit');
    const labels = (await openMenu('report-block-bloco-1-menu')).map(
      (item) => item.textContent ?? '',
    );

    // A trash that overflows must not land at the top of a menu, under the
    // cursor that just opened it.
    expect(labels[labels.length - 1]).toBe('Remover bloco');
    expect(labels.slice(0, -1)).toEqual(['Mover para cima', 'Mover para baixo']);
  });

  it('never overflows the ⋮ itself — it is what everything escapes into', async () => {
    renderEditorBlock(CRAMPED);

    // No room for any tool at all, so both are in the menu and the trigger is
    // still on the row. A cluster that shed its own escape hatch would strand
    // every action behind it.
    const trigger = await screen.findByTestId('report-block-bloco-1-menu');
    expect(trigger).not.toBeNull();
    const labels = (await openMenu('report-block-bloco-1-menu')).map(
      (item) => item.textContent ?? '',
    );
    expect(labels).toEqual([
      'Editar bloco',
      'Mover para cima',
      'Mover para baixo',
      'Remover bloco',
    ]);
  });

  it('keeps the move actions the @drag @mobile scenario asks for', async () => {
    renderEditorBlock(WIDE);
    await screen.findByTestId('report-block-bloco-1-edit');
    const items = await openMenu('report-block-bloco-1-menu');

    fireEvent.click(items[0] as HTMLElement);
    // Still the KEYBOARD path, which is what announces the move and restores
    // focus — the menu did not grow its own reimplementation.
    expect(calls.moved).toEqual(['bloco-1:-1']);
  });
});

describe('view mode — the same mechanism, ranked for what the viewer needs', () => {
  it('shows both tools and no ⋮ when they fit', () => {
    renderViewBlock(WIDE);

    expect(screen.getByTestId('report-block-grafico-render-as-table')).not.toBeNull();
    expect(screen.getByTestId('report-block-grafico-export')).not.toBeNull();
    // Nothing overflowed and the viewer declares no permanent menu items, so
    // there is no ⋮ — an empty menu is a control that does nothing.
    expect(screen.queryAllByTestId('report-block-grafico-menu')).toEqual([]);
  });

  it('sheds the CSV first — the table toggle is a chart\'s accessibility fallback', async () => {
    renderViewBlock(NARROW);

    expect(screen.getByTestId('report-block-grafico-render-as-table')).not.toBeNull();
    const labels = (await openMenu('report-block-grafico-menu')).map(
      (item) => item.textContent ?? '',
    );
    expect(labels).toEqual(['Baixar CSV']);
  });

  it('keeps the export test id when it moves into the menu', async () => {
    renderViewBlock(NARROW);
    await openMenu('report-block-grafico-menu');

    expect(screen.getByTestId('report-block-grafico-export')).not.toBeNull();
  });

  it('still toggles the rendering from the menu when even the toggle sheds', async () => {
    renderViewBlock(CRAMPED);
    const items = await openMenu('report-block-grafico-menu');
    expect(items.map((item) => item.textContent)).toEqual(['Ver como tabela', 'Baixar CSV']);

    fireEvent.click(screen.getByTestId('report-block-grafico-render-as-table'));

    // The action survives the move intact: same handler, same result.
    expect(screen.getByTestId('report-block-grafico-render-table')).not.toBeNull();
  });
});

describe('both routes stay open to a keyboard', () => {
  it('reaches a VISIBLE tool through the tab order', async () => {
    renderViewBlock(WIDE);
    const toggle = screen.getByTestId('report-block-grafico-render-as-table');

    // eslint-disable-next-line test-flakiness/no-focus-check -- being IN the tab order is the requirement, not a timing observation: a tool a tab can never land on is not reachable by keyboard at all.
    expect(toggle.getAttribute('tabindex')).not.toBe('-1');
    // eslint-disable-next-line test-flakiness/no-focus-check, test-flakiness/await-async-events -- not a check: the tool has to genuinely take focus, which is also what reveals the cluster through `:focus-within`.
    toggle.focus();
    await waitFor(() => {
      expect(document.activeElement).toBe(toggle);
    });
  });

  it('reaches an OVERFLOWED tool through the menu', async () => {
    renderViewBlock(NARROW);
    const trigger = screen.getByTestId('report-block-grafico-menu');

    // eslint-disable-next-line test-flakiness/no-focus-check, test-flakiness/await-async-events -- not a check: the trigger is the only way in to an overflowed action, so it must genuinely be focusable.
    trigger.focus();
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
    // Enter on the trigger opens the menu, and the item is a real `menuitem`
    // — MUI's Menu takes focus from there, so the whole path is keyboard-only.
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(trigger);
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toContain('Baixar CSV');
  });
});
