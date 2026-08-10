// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { createTheme } from '@12-apps/ui/mui/styles';

import { ReportRenderView } from '../report-render';
import type { ReportRender } from '../reports-api';

/**
 * The report table renders in the PRODUCT's table style (FUT-755, gap 9).
 *
 * It used to pass `variant="striped"`, which paints a zebra and nothing else —
 * no header treatment at all — so a report block read as a bare grid beside
 * every other list in the product. Three independent sources say what the
 * product's table is, and none of them stripes:
 *
 *  - `apps/admin` renders every list through `DataViewsTableBase` → `DataGrid`:
 *    a `1px solid divider` rule under the header, the same rule under each row,
 *    `action.hover` on hover, 36px rows.
 *  - `apps/super-admin/src/lib/table.tsx`, the `Th`/`Td` behind every platform
 *    list: the same two rules, header label at caption size and weight 600.
 *  - `docs/reports-builder/prototype.html`, this redesign's own spec:
 *    `th{...uppercase;border-bottom:1px solid var(--line)}` and
 *    `td{border-bottom:1px solid var(--line-2)}`.
 *
 * These cases assert those values, not "some style exists". They read the CSS
 * emotion actually emitted rather than `getComputedStyle`, because jsdom's
 * cascade ignores specificity: it resolves `text-transform` correctly here and
 * gets `font-weight` from MUI's own lower-specificity `.MuiTableCell-head`,
 * which a browser would never do. The emitted rule is the same fact without
 * jsdom's opinion in the way.
 */

/** The default theme's tokens — the values the house style is written in. */
const { palette } = createTheme();

const TABLE_RENDER: ReportRender = {
  kind: 'table',
  columns: [
    { key: 'day', label: 'Data (dia)', format: 'text' },
    { key: 'method', label: 'Forma de pagamento', format: 'text' },
    { key: 'revenueCents', label: 'Receita', format: 'brl' },
  ],
  rows: [
    { day: '01/08', method: 'PIX', revenueCents: 125_00 },
    { day: '02/08', method: 'Crédito', revenueCents: 340_00 },
    { day: '03/08', method: 'PIX', revenueCents: 90_00 },
  ],
};

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

/** Every rule emotion has emitted into this document, as one string. */
function emittedCss(): string {
  return Array.from(document.querySelectorAll('style'))
    .map((style) => style.textContent ?? '')
    .join('\n');
}

/** The declarations of the rule with this exact selector, or `''`. */
function ruleFor(selector: string): string {
  const css = emittedCss();
  const at = css.indexOf(`${selector}{`);
  if (at === -1) return '';
  return css.slice(at + selector.length + 1, css.indexOf('}', at));
}

/**
 * The emotion class the reports' table style is emitted under.
 *
 * It sits on the box WRAPPING the table, so the lookup walks up from the table
 * until it finds an ancestor class that has the head-cell rule. Returns `''`
 * when no ancestor carries it, which makes a missing style a failed assertion
 * rather than a thrown error.
 */
function reportTableClass(table: HTMLElement): string {
  for (let node = table.parentElement; node !== null; node = node.parentElement) {
    for (const className of node.className.split(' ')) {
      if (!className.startsWith('css-')) continue;
      if (ruleFor(`.${className} ${HEAD_CELL}`) !== '') return className;
    }
  }
  return '';
}

/** The declarations of the reports' own rule ending in `suffix`. */
function reportTableRule(table: HTMLElement, suffix: string): string {
  const className = reportTableClass(table);
  return className === '' ? '' : ruleFor(`.${className} ${suffix}`);
}

const HEAD = '.MuiTable-root .MuiTableHead-root';
const HEAD_CELL = `${HEAD} .MuiTableCell-root`;
const BODY_CELL = '.MuiTable-root .MuiTableBody-root .MuiTableCell-root';
const ROW_HOVER = '.MuiTable-root .MuiTableBody-root .MuiTableRow-root:hover';

/** Renders a table block and hands back its `<table>`. */
function renderTableBlock(): HTMLElement {
  render(<ReportRenderView render={TABLE_RENDER} dataTestId="bloco" />);
  return screen.getByTestId('bloco-table');
}

/**
 * Renders a chart block in its "Ver como tabela" fallback.
 *
 * `asTable` is an input rather than a click because the toggle moved out of
 * the rendering and into the block's header cluster (FUT-755) — the button and
 * the test ids it carries are covered in `block-tool-cluster.test.tsx`. What
 * this file is about is the table that comes out either way.
 */
function renderChartAsTable(): HTMLElement {
  render(<ReportRenderView render={CHART_RENDER} dataTestId="grafico" asTable />);
  return screen.getByTestId('grafico-table');
}

afterEach(cleanup);

describe('report table — the product\'s table style', () => {
  it('treats the header: a rule and a label, not a bare row of text', () => {
    const rule = reportTableRule(renderTableBlock(), HEAD_CELL);

    // The rule under the header — `DataGrid`, `super-admin`'s `Th` and the
    // prototype's `th` all draw exactly this.
    expect(rule).toContain('border-bottom:1px solid');
    expect(rule).toContain(`border-bottom-color:${palette.divider}`);
    // The label: the area's own small-label treatment (SECTION_LABEL_STYLE),
    // muted the way `super-admin`'s `Th` and the prototype's `th` are.
    expect(rule).toContain('text-transform:uppercase');
    expect(rule).toContain('font-weight:600');
    expect(rule).toContain('font-size:0.75rem');
    expect(rule).toContain(`color:${palette.text.secondary}`);
  });

  it('never tints the header band — no product table has one', () => {
    // `variant="default"` paints the head `alpha(primary.main, 0.1)`. The
    // override has to out-specify it, which is why it carries the extra
    // `.MuiTable-root` qualifier; a rule of equal weight would lose on
    // insertion order, since the wrapper's class is serialized first.
    expect(reportTableRule(renderTableBlock(), HEAD)).toContain(
      'background-color:transparent',
    );
  });

  it('rules the rows instead of striping them', () => {
    const table = renderTableBlock();

    expect(reportTableRule(table, BODY_CELL)).toContain('border-bottom:1px solid');
    expect(reportTableRule(table, BODY_CELL)).toContain(
      `border-bottom-color:${palette.divider}`,
    );
    // The reported defect: the striped variant's zebra
    // (`.MuiTableBody-root .MuiTableRow-root:nth-of-type(even)`). Only report
    // renderings are mounted in this file, so nothing else could emit it — and
    // the assertions above are the positive control that keeps this one from
    // passing against a table that rendered no rules at all.
    expect(emittedCss()).not.toContain('nth-of-type(even)');
  });

  it('hovers a row with the same token every admin list uses', () => {
    const rule = reportTableRule(renderTableBlock(), ROW_HOVER);

    expect(rule).toContain(`background-color:${palette.action.hover}`);
    // …and NOT `cursor: pointer`, which the design system's own `hoverable`
    // adds. A report row is not clickable.
    expect(rule).not.toContain('cursor');
  });

  it('sizes rows at the 36px every admin list is wired to', () => {
    const table = renderTableBlock();
    const cell = table.querySelector('tbody td');

    expect(cell).not.toBeNull();
    // `density="compact"`, reaching the component — `DataViews` wires
    // `rowHeight={36} headerHeight={36}` into every list in `apps/admin`.
    expect(globalThis.getComputedStyle(cell as HTMLElement).height).toBe('36px');
  });

  it('keeps the reporting divergences: tabular figures and numeric alignment', () => {
    const table = renderTableBlock();
    const cells = Array.from(table.querySelectorAll('tbody tr')[0]?.children ?? []);

    // Text left, numbers right — derived from `column.format`, so a column of
    // currency can be compared down the column.
    expect(cells.map((cell) => cell.className.includes('MuiTableCell-alignRight'))).toEqual([
      false,
      false,
      true,
    ]);
    // Digits of uniform advance, declared on the table's own box rather than
    // inherited from a page that may not be there — the same box the rules
    // above are emitted under, so a table mounted anywhere carries both.
    expect(ruleFor(`.${reportTableClass(table)}`)).toContain(
      'font-variant-numeric:tabular-nums',
    );
  });
});

describe('report table — one style for both call sites', () => {
  it('renders a chart\'s "Ver como tabela" exactly like a table block', () => {
    const fromChart = renderChartAsTable();
    const fromTable = renderTableBlock();

    // Same emotion class ⇒ same variant, same density, same everything the
    // design system styles a table by. A fallback that drifted from a real
    // table block would be the original bug one level down.
    expect(fromChart.className).toBe(fromTable.className);
    expect(reportTableRule(fromChart, HEAD_CELL)).toBe(
      reportTableRule(fromTable, HEAD_CELL),
    );
  });

  it('keeps the test ids the reports e2e drives', () => {
    const { rerender } = render(<ReportRenderView render={CHART_RENDER} dataTestId="grafico" />);

    expect(screen.getByTestId('grafico-chart')).not.toBeNull();
    rerender(<ReportRenderView render={CHART_RENDER} dataTestId="grafico" asTable />);
    expect(screen.getByTestId('grafico-table')).not.toBeNull();
  });
});
