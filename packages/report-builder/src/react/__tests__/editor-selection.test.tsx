// @vitest-environment jsdom
import { PT_BR_REPORT_ENGINE_COPY } from '../../pt-BR';
import { PT_BR_BLANK_BLOCK_TEMPLATE_COPY } from '../../server/pt-BR';
import { PT_BR_REPORT_SCREENS_COPY } from '../pt-BR';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { createWebReportBuilder } from '../create-report-builder';
import { TEST_SURFACE } from './surface-fixture';
import type {
  ReportEntityFields,
  ReportSpecWire,
  SavedReportSummary,
  SavedReportView,
} from '../custom-reports-api';
import type { ReportRender } from '../reports-api';
import type { ReportBuilderTransport } from '../transport';

/**
 * ONE panel, pointed at the SELECTED block (FUT-755) — the canvas-level
 * selection the `@regression` scenarios of
 * `docs/reports-builder/specs/editor-config-panel.feature` describe.
 *
 * Every case here was impossible while each block owned its own `editing`
 * flag: with the state per block, "click another block" could only mount a
 * SECOND panel, and "click the background" had nothing above the blocks to
 * clear. The two scenarios this file exists for read:
 *
 *   Clicking the middle of the screen does not dismiss the panel
 *     … Then the panel remains open
 *     … And the panel now targets the block I clicked
 *     … And the previously selected block loses its selected outline
 *
 *   Clicking the empty canvas background deselects
 *     … Then no block is selected
 *     … And the panel shows its empty state with the text
 *         "Selecione um bloco para editar"
 *     … And the panel remains docked and visible
 *
 * They drive the whole routed surface at `/:reportId/edit` rather than the
 * canvas in isolation: "the panel remains open" is a claim about what else is
 * on the page, and a canvas rendered on its own cannot make it. The transport
 * is stubbed, so nothing here reaches the network.
 */

const TENANT = 'acme';
const REPORT_ID = 'rel-1';

const TITLES = ['Receita no período', 'Receita por dia', 'Ticket médio'] as const;

const BLOCK_SPEC: ReportSpecWire = {
  entity: 'orders',
  dimensions: [{ field: 'method' }],
  measures: [{ field: 'revenueCents', aggregation: 'sum' }],
  filters: [],
  sort: [],
  presentation: { kind: 'table' },
};

const RENDER: ReportRender = {
  kind: 'table',
  columns: [
    { key: 'method', label: 'Forma de pagamento', format: 'text' },
    { key: 'revenueCents', label: 'Receita', format: 'brl' },
  ],
  rows: [{ method: 'PIX', revenueCents: 123456 }],
};

const RANGE = {
  preset: '30d' as const,
  from: '2026-01-02T03:00:00.000Z',
  toExclusive: '2026-02-01T03:00:00.000Z',
};

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
  updatedAt: '2026-02-01T12:00:00.000Z',
};

const VIEW: SavedReportView = {
  id: REPORT_ID,
  name: 'Painel da loja',
  description: 'Três blocos, para ter um outro bloco a clicar.',
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
      spec: BLOCK_SPEC,
    })),
  },
  blocks: TITLES.map((title, index) => ({
    id: `bloco-${index + 1}`,
    title,
    span: 6,
    sentence: 'soma de Receita por Forma de pagamento',
    status: 'ok' as const,
    render: RENDER,
  })),
};

const ENTITY: ReportEntityFields = {
  entity: 'orders',
  label: 'Pedidos',
  fields: [
    { field: 'method', label: 'Forma de pagamento', type: 'string', role: 'dimension' },
    { field: 'revenueCents', label: 'Receita', type: 'money', role: 'measure' },
  ],
};

/** The panel's own words when nothing is selected — the spec's exact string. */
const EMPTY_TEXT = 'Selecione um bloco para editar';

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
    send: <T,>() =>
      Promise.resolve({
        ok: true as const,
        data: { range: RANGE, render: RENDER } as unknown as T,
      }),
  };
}

/** The editor, opened on the saved three-block report. */
async function openEditor(): Promise<void> {
  const { page: Surface } = createWebReportBuilder({
    surface: TEST_SURFACE,
    copy: {
      engine: PT_BR_REPORT_ENGINE_COPY,
      blankTemplate: PT_BR_BLANK_BLOCK_TEMPLATE_COPY,
      screens: PT_BR_REPORT_SCREENS_COPY,
    },
    tenantSlug: TENANT,
    transport: stubTransport(),
    standalone: true,
    initialPath: `/${TENANT}/reports/${REPORT_ID}/edit`,
  });
  render(<Surface />);
  await screen.findByTestId('report-editor-save');
  // The precondition every case below shares, and the control that keeps a
  // blank canvas from passing them: three blocks, and no panel yet.
  expect(blockNamed(TITLES[0])).toBeTruthy();
  expect(openPanels()).toEqual([]);
}

function canvas(): HTMLElement {
  return screen.getByTestId('report-editor-grid');
}

function blockNamed(title: string): HTMLElement {
  return within(canvas()).getByRole('group', { name: title });
}

/** Which block wears the selected ring, by title. */
function selectedTitles(): string[] {
  return within(canvas())
    .getAllByRole('group')
    .filter((block) => block.getAttribute('data-selected') === 'true')
    .map((block) => block.getAttribute('aria-label') ?? '');
}

/**
 * The panel containers currently on screen, by test id.
 *
 * A LIST rather than a lookup, because half of what these scenarios assert is
 * that there is exactly ONE of them however many blocks get clicked — the
 * failure mode of per-block state was two.
 */
function openPanels(): string[] {
  return Array.from(document.querySelectorAll('[data-panel-tier] .MuiDrawer-root')).map(
    (panel) => panel.getAttribute('data-testid') ?? '',
  );
}

/** The text a screen reader would find in the panel's empty state. */
function emptyPrompts(): HTMLElement[] {
  return screen.queryAllByText(EMPTY_TEXT);
}

const realMatchMedia = window.matchMedia;

/**
 * `useMediaQuery` reads `window.matchMedia`, which jsdom does not implement.
 * Answering "no" to every query pins the DOCKED tier, which is the one every
 * scenario in this file is written against. Installed per test with a restore,
 * so the mutation cannot leak into another suite.
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

describe('editor canvas — the panel follows the selection', () => {
  it('opens the panel on the block whose body was clicked', async () => {
    await openEditor();

    fireEvent.click(blockNamed('Receita por dia'));

    await waitFor(() => {
      expect(openPanels()).toEqual(['report-block-bloco-2-editor']);
    });
    expect(selectedTitles()).toEqual(['Receita por dia']);
  });

  it('RETARGETS the panel when another block is clicked, rather than opening a second', async () => {
    await openEditor();
    fireEvent.click(blockNamed('Receita por dia'));
    await waitFor(() => {
      expect(openPanels()).toEqual(['report-block-bloco-2-editor']);
    });

    fireEvent.click(blockNamed('Ticket médio'));

    // Still exactly one panel, now pointed elsewhere — the whole scenario.
    await waitFor(() => {
      expect(openPanels()).toEqual(['report-block-bloco-3-editor']);
    });
    // "And the previously selected block loses its selected outline."
    expect(selectedTitles()).toEqual(['Ticket médio']);
  });

  it('keeps the block selected when the same block is clicked again', async () => {
    await openEditor();
    fireEvent.click(blockNamed('Receita por dia'));
    await waitFor(() => {
      expect(selectedTitles()).toEqual(['Receita por dia']);
    });

    fireEvent.click(blockNamed('Receita por dia'));

    await waitFor(() => {
      expect(openPanels()).toEqual(['report-block-bloco-2-editor']);
    });
    expect(selectedTitles()).toEqual(['Receita por dia']);
  });

  it('opens the panel from the KEYBOARD, with Enter on the focused block', async () => {
    await openEditor();

    fireEvent.keyDown(blockNamed('Receita por dia'), { key: 'Enter' });

    await waitFor(() => {
      expect(openPanels()).toEqual(['report-block-bloco-2-editor']);
    });
    expect(selectedTitles()).toEqual(['Receita por dia']);
  });

  it('does not read Enter in the TITLE FIELD as a selection', async () => {
    await openEditor();

    // The title input lives inside the block group, so its Enter bubbles to
    // the same handler. Without the target check, typing a title and pressing
    // Enter would open the panel over the field being typed into.
    fireEvent.keyDown(screen.getByTestId('report-block-bloco-2-title'), { key: 'Enter' });

    await waitFor(() => {
      expect(selectedTitles()).toEqual([]);
    });
    expect(openPanels()).toEqual([]);
  });

  it('still opens the panel from the block pen', async () => {
    await openEditor();

    fireEvent.click(screen.getByTestId('report-block-bloco-2-edit'));

    await waitFor(() => {
      expect(openPanels()).toEqual(['report-block-bloco-2-editor']);
    });
  });
});

describe('editor canvas — deselecting leaves the panel in its empty state', () => {
  /** Select a block and settle, so each case below starts from an open panel. */
  async function withPanelOpen(): Promise<void> {
    await openEditor();
    fireEvent.click(blockNamed('Receita por dia'));
    await waitFor(() => {
      expect(selectedTitles()).toEqual(['Receita por dia']);
    });
    expect(emptyPrompts()).toEqual([]);
  }

  it('deselects on a click that lands on the canvas BACKGROUND', async () => {
    await withPanelOpen();

    // The grid itself: the gap between blocks, which belongs to no block.
    fireEvent.click(canvas());

    await waitFor(() => {
      expect(emptyPrompts().length).toBe(1);
    });
    expect(selectedTitles()).toEqual([]);
    // "And the panel remains docked and visible" — it is a STATE of the panel,
    // not the panel going away.
    expect(openPanels()).toEqual(['report-editor-panel']);
  });

  it('never deselects on a click inside the panel', async () => {
    await withPanelOpen();

    fireEvent.click(screen.getByTestId('report-block-bloco-2-editor-content'));

    await waitFor(() => {
      expect(openPanels()).toEqual(['report-block-bloco-2-editor']);
    });
    expect(selectedTitles()).toEqual(['Receita por dia']);
    expect(emptyPrompts()).toEqual([]);
  });

  it('never deselects on a click that arrives from a PORTAL', async () => {
    await withPanelOpen();

    // The block menu renders at `document.body`, and React bubbles its clicks
    // along the React tree anyway — so a menu item reaches the canvas wrapper
    // with a target that is outside every block. Read as a background click,
    // it emptied the panel every time the menu was used (caught in Chromium).
    fireEvent.click(screen.getByTestId('report-block-bloco-2-menu'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mover para cima' }));

    await waitFor(() => {
      expect(screen.getByTestId('report-editor-live-region').textContent).toBe(
        'Receita por dia movido para a posição 1 de 3',
      );
    });
    expect(emptyPrompts()).toEqual([]);
    expect(openPanels()).toEqual(['report-block-bloco-2-editor']);
    expect(selectedTitles()).toEqual(['Receita por dia']);
  });

  it('never deselects when the remove confirmation is CANCELLED', async () => {
    await withPanelOpen();

    fireEvent.click(screen.getByTestId('report-block-bloco-2-remove'));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));

    // Inside the wait: the dialog marks the rest of the page `aria-hidden`
    // while it is up, so the canvas has no queryable roles until it is gone.
    await waitFor(() => {
      expect(selectedTitles()).toEqual(['Receita por dia']);
    });
    expect(openPanels()).toEqual(['report-block-bloco-2-editor']);
    expect(emptyPrompts()).toEqual([]);
  });

  it('empties the panel on Escape', async () => {
    await withPanelOpen();

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(emptyPrompts().length).toBe(1);
    });
    expect(selectedTitles()).toEqual([]);
  });

  it('empties the panel when the selected block is REMOVED, choosing no neighbour', async () => {
    await withPanelOpen();

    fireEvent.click(screen.getByTestId('report-block-bloco-2-remove'));
    // The dialog's own confirm, not the block's 🗑 — the latter is named
    // "Remover bloco", so an exact name tells the two apart.
    fireEvent.click(await screen.findByRole('button', { name: 'Remover' }));

    await waitFor(() => {
      expect(emptyPrompts().length).toBe(1);
    });
    // "And the panel does not select a neighbouring block on my behalf."
    //
    // Waited for, because the confirmation now belongs to the CANVAS rather
    // than to the block it removes (GAP 6 — the panel's *Remover* opens the
    // same dialog). It therefore survives the removal and closes on MUI's exit
    // transition, during which the canvas behind it is still `aria-hidden` and
    // has no queryable roles at all.
    await waitFor(() => {
      expect(selectedTitles()).toEqual([]);
    });
  });
});

describe('editor canvas — the block menu moves a block without a drag', () => {
  /**
   * `specs/editor-direct-manipulation.feature`, `@drag @mobile`:
   *
   *   And explicit "Mover para cima" / "Mover para baixo" actions are also
   *   available in the block's menu, because a long drag past sticky chrome is
   *   impractical one-handed
   *
   * The actions go through the keyboard path, so the announcement the `@a11y`
   * scenarios specify comes with them — asserted here, because a menu item
   * that quietly called `moveBlock` would pass an order-only check.
   */
  function openMenu(blockId: string): void {
    fireEvent.click(screen.getByTestId(`report-block-${blockId}-menu`));
  }

  function menuItem(label: string): HTMLElement {
    return screen.getByRole('menuitem', { name: label });
  }

  function blockOrder(): string[] {
    return within(canvas())
      .getAllByRole('group')
      .map((block) => block.getAttribute('aria-label') ?? '');
  }

  function announcement(): string {
    return screen.getByTestId('report-editor-live-region').textContent ?? '';
  }

  it('moves a block UP and announces the new position', async () => {
    await openEditor();

    openMenu('bloco-2');
    fireEvent.click(menuItem('Mover para cima'));

    await waitFor(() => {
      expect(blockOrder()).toEqual(['Receita por dia', 'Receita no período', 'Ticket médio']);
    });
    expect(announcement()).toBe('Receita por dia movido para a posição 1 de 3');
  });

  it('moves a block DOWN and announces the new position', async () => {
    await openEditor();

    openMenu('bloco-2');
    fireEvent.click(menuItem('Mover para baixo'));

    await waitFor(() => {
      expect(blockOrder()).toEqual(['Receita no período', 'Ticket médio', 'Receita por dia']);
    });
    expect(announcement()).toBe('Receita por dia movido para a posição 3 de 3');
  });

  it('disables the action that would fall off the end', async () => {
    await openEditor();

    openMenu('bloco-1');

    // The control in the same menu is the positive half: "disabled" has to be
    // a statement about the boundary, not about the menu being inert.
    expect(menuItem('Mover para cima').getAttribute('aria-disabled')).toBe('true');
    expect(menuItem('Mover para baixo').getAttribute('aria-disabled')).toBe(null);
  });

  it('disables the other end on the last block', async () => {
    await openEditor();

    openMenu('bloco-3');

    expect(menuItem('Mover para baixo').getAttribute('aria-disabled')).toBe('true');
    expect(menuItem('Mover para cima').getAttribute('aria-disabled')).toBe(null);
  });
});
