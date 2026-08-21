// @vitest-environment jsdom
import { renderWithCopy } from "./with-copy";
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import type { DashboardBlockRender, SavedReportView } from '../custom-reports-api';
import { ReportViewCanvas } from '../report-view';
import type { ReportRender } from '../reports-api';

/**
 * A block's chrome is a CLUSTER OF ICONS in its top-right corner, and it
 * appears on hover (FUT-755, gaps B and C).
 *
 * It used to be a `CSV` text button parked permanently in the header, plus a
 * "Ver como tabela" text link *inside the block body*, above the chart — so
 * every block on a canvas carried two controls competing with the figures it
 * exists to show, one of which pushed the rendering down by a control's
 * height. `prototype.html` renders both as glyphs in one `.block-tools`
 * cluster, revealed by `.block:hover`.
 *
 * "Only on hover" is the half that is easy to get wrong, and much of this file
 * is about that: a keyboard user never hovers, a touch device cannot, and a
 * faded-out control that is still clickable is worse than a visible one. A
 * hover-only implementation passes any "does it appear on hover?" test while
 * being unusable by a keyboard.
 *
 * The last describe block is the user's own acceptance criteria for the
 * toggle, line by line.
 */

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
  rows: [
    { day: '01/08', revenueCents: 125_00 },
    { day: '02/08', revenueCents: 340_00 },
  ],
};

const TABLE_RENDER: ReportRender = {
  kind: 'table',
  columns: [{ key: 'method', label: 'Forma de pagamento', format: 'text' }],
  rows: [{ method: 'PIX' }],
};

const CHART_BLOCK: DashboardBlockRender = {
  id: 'grafico',
  title: 'Receita por dia',
  span: 6,
  sentence: 'soma de receita em pedidos por dia',
  status: 'ok',
  render: CHART_RENDER,
};

/** A SECOND chart, so "this block only" has something to be true against. */
const OTHER_CHART_BLOCK: DashboardBlockRender = { ...CHART_BLOCK, id: 'grafico-2' };

const TABLE_BLOCK: DashboardBlockRender = {
  id: 'tabela',
  title: 'Formas de pagamento',
  span: 6,
  sentence: 'contagem de pedidos por forma de pagamento',
  status: 'ok',
  render: TABLE_RENDER,
};

const ERROR_BLOCK: DashboardBlockRender = {
  id: 'quebrado',
  title: 'Bloco quebrado',
  span: 6,
  sentence: 'soma de receita em pedidos',
  status: 'error',
  error: 'Campo removido.',
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

/** Every rule emotion has emitted into this document, as one string. */
function emittedCss(): string {
  return Array.from(document.querySelectorAll('style'))
    .map((style) => style.textContent ?? '')
    .join('\n');
}

/** The declarations of the FIRST rule matching `pattern`, or `''`. */
function declarationsOf(pattern: RegExp): string {
  return pattern.exec(emittedCss())?.[1] ?? '';
}

/** The cluster while nothing is hovered or focused. */
const HIDDEN_RULE = /\.css-[\w-]+ \[data-block-tools\]\{([^}]*)\}/;
/** The cluster under a hovered block. */
const HOVER_RULE = /:hover \[data-block-tools\][^{]*\{([^}]*)\}/;
/** The cluster with the keyboard inside it. */
const FOCUS_RULE = /:focus-within \[data-block-tools\]\{([^}]*)\}/;

/** Every download `exportRows` triggered, by file name. */
const downloads: { names: string[] } = { names: [] };

const realCreateObjectUrl = URL.createObjectURL;
const realRevokeObjectUrl = URL.revokeObjectURL;

beforeEach(() => {
  downloads.names = [];
  // jsdom implements neither, and `exportRows` calls both around the anchor.
  URL.createObjectURL = () => 'blob:report';
  URL.revokeObjectURL = () => undefined;
  // Recorded onto a container's property rather than a closed-over binding —
  // the flakiness gate errors on the latter.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ): void {
    downloads.names.push(this.download);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  URL.createObjectURL = realCreateObjectUrl;
  URL.revokeObjectURL = realRevokeObjectUrl;
});

describe('gap B — the CSV export is an icon, and it still exports', () => {
  it('is named, and carries a glyph rather than the word CSV', () => {
    renderWithCopy(<ReportViewCanvas view={viewOf([CHART_BLOCK])} />);
    const csv = screen.getByTestId('report-block-grafico-export');

    // An icon with no accessible name is a worse screen than the text it
    // replaced — this is the whole price of the change.
    expect(csv.getAttribute('aria-label')).toBe('Baixar CSV');
    expect(csv.querySelector('svg')).not.toBeNull();
    expect((csv.textContent ?? '').trim()).toBe('');
  });

  it('keeps the test id the reports e2e drives, on every block', () => {
    renderWithCopy(<ReportViewCanvas view={viewOf([CHART_BLOCK, TABLE_BLOCK])} />);

    expect(screen.getByTestId('report-block-grafico-export')).not.toBeNull();
    expect(screen.getByTestId('report-block-tabela-export')).not.toBeNull();
  });

  it("downloads the block's rows when pressed", () => {
    renderWithCopy(<ReportViewCanvas view={viewOf([CHART_BLOCK])} />);

    fireEvent.click(screen.getByTestId('report-block-grafico-export'));

    // The behaviour under the glyph: the same file the text button produced,
    // from the same rows the block is showing.
    expect(downloads.names).toEqual(['bloco-grafico.csv']);
  });

  it('offers no cluster at all on a block that failed to run', () => {
    renderWithCopy(<ReportViewCanvas view={viewOf([ERROR_BLOCK])} />);
    const block = screen.getByTestId('report-block-quebrado');

    // Positive control first: the block IS on the canvas, showing why it
    // failed. Without it the two sweeps below would pass against nothing.
    expect(screen.getByTestId('report-block-quebrado-error').textContent).toBe('Campo removido.');
    // Nothing to export, nothing to switch. An empty box in the header is a
    // control that does nothing.
    expect(screen.queryAllByTestId('report-block-quebrado-export')).toEqual([]);
    expect(block.querySelectorAll('[data-block-tools]')).toHaveLength(0);
  });
});

describe('the cluster is revealed by hover — and by focus, and always on touch', () => {
  it('hides itself, and stops being clickable while hidden', () => {
    renderWithCopy(<ReportViewCanvas view={viewOf([CHART_BLOCK])} />);
    const hidden = declarationsOf(HIDDEN_RULE);

    expect(hidden).toContain('opacity:0');
    // Fading a control out and leaving it live puts an invisible button over
    // the header. The two go together.
    expect(hidden).toContain('pointer-events:none');
  });

  it('is revealed by hovering the BLOCK, not the cluster', () => {
    renderWithCopy(<ReportViewCanvas view={viewOf([CHART_BLOCK])} />);

    // `prototype.html`'s `.block:hover .block-tools`. A rule on the cluster
    // itself would ask the pointer to find a control it cannot see.
    expect(declarationsOf(HOVER_RULE)).toContain('opacity:1');
  });

  it('is revealed by focus too — a keyboard user never hovers', () => {
    renderWithCopy(<ReportViewCanvas view={viewOf([CHART_BLOCK])} />);
    const focused = declarationsOf(FOCUS_RULE);

    expect(focused).toContain('opacity:1');
    // …and becomes clickable on the way in, or a keyboard user would watch it
    // appear and be unable to press it.
    expect(focused).toContain('pointer-events:auto');
  });

  it('never uses display:none — the controls stay in the tab order', async () => {
    renderWithCopy(<ReportViewCanvas view={viewOf([CHART_BLOCK])} />);
    const csv = screen.getByTestId('report-block-grafico-export');

    // Positive control: there IS a rule hiding the cluster. Without it the
    // next line would pass against a stylesheet that never hid anything.
    expect(declarationsOf(HIDDEN_RULE)).not.toBe('');
    // `display:none` passes every "appears on hover" test ever written, and
    // takes the control out of the tab order entirely.
    expect(declarationsOf(HIDDEN_RULE)).not.toContain('display:none');
    expect(csv.hasAttribute('hidden')).toBe(false);
    // eslint-disable-next-line test-flakiness/no-focus-check -- being IN the tab order is the requirement, not a timing observation: a hover-revealed control that a tab can never land on is unreachable by keyboard.
    expect(csv.getAttribute('tabindex')).not.toBe('-1');

    // eslint-disable-next-line test-flakiness/no-focus-check, test-flakiness/await-async-events -- not a check: the control has to genuinely take focus, which is the only way the `:focus-within` reveal above can ever fire.
    csv.focus();
    await waitFor(() => {
      expect(document.activeElement).toBe(csv);
    });
  });

  it('reaches BOTH tools with the keyboard, in the order they are read', async () => {
    renderWithCopy(<ReportViewCanvas view={viewOf([CHART_BLOCK])} />);
    const toggle = screen.getByTestId('report-block-grafico-render-as-table');
    const csv = screen.getByTestId('report-block-grafico-export');

    // Focus alone is not the claim — a focused control must also be operable,
    // so the toggle is pressed from the keyboard path it was just given.
    // eslint-disable-next-line test-flakiness/no-focus-check, test-flakiness/await-async-events -- not a check: the toggle must genuinely hold focus before it is operated, which is what makes this the keyboard path rather than a click.
    toggle.focus();
    await waitFor(() => {
      expect(document.activeElement).toBe(toggle);
    });
    fireEvent.click(toggle);
    expect(screen.getByTestId('report-block-grafico-render-table')).not.toBeNull();

    // eslint-disable-next-line test-flakiness/no-focus-check, test-flakiness/await-async-events -- not a check: the SECOND tool must be reachable too, so it has to take focus for real.
    csv.focus();
    await waitFor(() => {
      expect(document.activeElement).toBe(csv);
    });
  });

  it('is permanently visible where there is no hover at all', () => {
    renderWithCopy(<ReportViewCanvas view={viewOf([CHART_BLOCK])} />);
    const css = emittedCss();
    const at = css.search(/@media\s*\(\s*hover:\s*none\s*\)/);

    // A touch device has no gesture that summons a hover-revealed control, so
    // under `(hover: none)` the cluster simply stays.
    expect(at).toBeGreaterThan(-1);
    expect(css.slice(at, at + 300)).toContain('opacity:1');
    // Stated AFTER the hiding rule, or it would lose to it at equal weight.
    expect(at).toBeGreaterThan(css.search(HIDDEN_RULE));
  });
});

describe('gap C — "Ver como tabela" is a toggle in the cluster, not a link in the body', () => {
  it('is an icon button in the block\'s tool cluster', () => {
    renderWithCopy(<ReportViewCanvas view={viewOf([CHART_BLOCK])} />);
    const toggle = screen.getByTestId('report-block-grafico-render-as-table');

    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.querySelector('svg')).not.toBeNull();
    expect((toggle.textContent ?? '').trim()).toBe('');
    // IN the cluster, and no longer inside the rendering it switches — that
    // move is the whole gap.
    expect(toggle.closest('[data-block-tools]')).not.toBeNull();
    expect(toggle.closest('[data-testid="report-block-grafico-render"]')).toBeNull();
  });

  it('carries aria-pressed reflecting the current mode', () => {
    renderWithCopy(<ReportViewCanvas view={viewOf([CHART_BLOCK])} />);
    const toggle = screen.getByTestId('report-block-grafico-render-as-table');

    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('names its destination: "Ver como tabela", then "Ver como gráfico"', () => {
    renderWithCopy(<ReportViewCanvas view={viewOf([CHART_BLOCK])} />);
    const toggle = screen.getByTestId('report-block-grafico-render-as-table');

    expect(toggle.getAttribute('aria-label')).toBe('Ver como tabela');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-label')).toBe('Ver como gráfico');
  });

  it('swaps the rendering IN PLACE — nothing is stacked above or below it', () => {
    renderWithCopy(<ReportViewCanvas view={viewOf([CHART_BLOCK])} />);
    const toggle = screen.getByTestId('report-block-grafico-render-as-table');
    const body = screen.getByTestId('report-block-grafico-render');
    const header = toggle.closest('[data-block-tools]')?.parentElement;

    // jsdom has no layout, so "does not change the block's height by more than
    // the content requires" is asserted structurally: one rendering in the
    // body before and after, the same header around it, and a toggle whose own
    // box does not change when its label does. `active` is excluded because it
    // is exactly the pressed-state class the toggle SHOULD gain — it paints,
    // it does not measure.
    const shape = (): Record<string, unknown> => ({
      bodyChildren: body.children.length,
      headerChildren: header?.children.length,
      toggleBox: toggle.className.split(' ').filter((name) => name !== 'active').join(' '),
    });
    const before = shape();
    expect(screen.getByTestId('report-block-grafico-render-chart')).not.toBeNull();

    fireEvent.click(toggle);

    expect(screen.getByTestId('report-block-grafico-render-table')).not.toBeNull();
    expect(screen.queryAllByTestId('report-block-grafico-render-chart')).toEqual([]);
    expect(shape()).toEqual(before);
  });

  it('applies to that block only', () => {
    renderWithCopy(<ReportViewCanvas view={viewOf([CHART_BLOCK, OTHER_CHART_BLOCK])} />);

    fireEvent.click(screen.getByTestId('report-block-grafico-render-as-table'));

    expect(screen.getByTestId('report-block-grafico-render-table')).not.toBeNull();
    // The neighbour is untouched: one `useState` per block, not a page mode.
    expect(screen.getByTestId('report-block-grafico-2-render-chart')).not.toBeNull();
    expect(
      screen.getByTestId('report-block-grafico-2-render-as-table').getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('is not saved to the report', () => {
    const view = viewOf([CHART_BLOCK]);
    const before = JSON.stringify(view);
    const canvas = renderWithCopy(<ReportViewCanvas view={view} />);

    fireEvent.click(screen.getByTestId('report-block-grafico-render-as-table'));
    expect(screen.getByTestId('report-block-grafico-render-table')).not.toBeNull();

    // Nothing was written into the report it was read from…
    expect(JSON.stringify(view)).toBe(before);
    // …so opening the same report again shows the chart the author chose. This
    // is deliberate: the toggle is how someone wants to read this block right
    // now, and saving it would change what every other viewer sees.
    canvas.unmount();
    renderWithCopy(<ReportViewCanvas view={view} />);
    expect(screen.getByTestId('report-block-grafico-render-chart')).not.toBeNull();
    expect(
      screen.getByTestId('report-block-grafico-render-as-table').getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('is offered only where there is a chart to switch', () => {
    renderWithCopy(<ReportViewCanvas view={viewOf([TABLE_BLOCK, ERROR_BLOCK])} />);

    // A table has no other view of itself, and a failed block has no view at
    // all — but the table still exports, so its cluster is not empty.
    expect(screen.queryAllByTestId('report-block-tabela-render-as-table')).toEqual([]);
    expect(screen.getByTestId('report-block-tabela-export')).not.toBeNull();
    expect(screen.queryAllByTestId('report-block-quebrado-render-as-table')).toEqual([]);
  });
});
