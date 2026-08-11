import { expect, type Locator, type Page } from '@playwright/test';

import { reportsWorld } from '../world.js';

/**
 * The gestures the packaged report journeys are built from — every one of them
 * driving a test id `@12-apps/report-builder` renders itself (FUT-755).
 *
 * They live outside `steps/` on purpose: that directory IS the `steps` glob, so
 * bddgen loads every file in it looking for definitions, and a helper module
 * sitting there would be imported for its (absent) side effects. This is the
 * same split `@12-apps/payments-e2e` keeps between `src/steps` and
 * `src/helpers`.
 *
 * Exported from the package as well, so a host can write its OWN specs in the
 * same vocabulary as the journeys.
 */

/**
 * How long a block may take to draw.
 *
 * A block is not markup: it compiles a spec, runs it against the host's data
 * and renders the result, so first paint legitimately outlives Playwright's
 * default. Stated once here rather than as a number typed into each assertion,
 * which is the shape a reviewer cannot argue with later.
 */
export const BLOCK_RENDER_TIMEOUT_MS = 15_000;

/** The id the editor gives the first block of a brand-new report. */
export const NEW_BLOCK = 'bloco-1';

/**
 * The picker's templates, by the name an author reads on the card.
 *
 * A scenario says "the Receita por dia template" because that is what is
 * printed on the tile; the picker addresses it by id. One map, so the feature
 * files stay in the author's words and no step has to spell a slug.
 */
const TEMPLATE_IDS: Record<string, string> = {
  'Receita por dia': 'receita-por-dia',
  'Produtos mais vendidos': 'produtos-mais-vendidos',
  'Tempo de preparo por estação': 'preparo-por-estacao',
  'Horas trabalhadas por estação': 'horas-por-estacao',
  'Formas de pagamento': 'formas-de-pagamento',
  'Perdas por motivo': 'perdas-por-motivo',
  'Movimentações de estoque': 'movimentacoes-de-estoque',
};

/** The picker id behind a template's printed name. */
export function templateId(title: string): string {
  const id = TEMPLATE_IDS[title];
  if (!id) throw new Error(`unknown block template "${title}"`);
  return id;
}

/** The rolling periods, by the word on their pill. */
const RANGE_IDS: Record<string, string> = {
  Hoje: 'today',
  '7 dias': '7d',
  '30 dias': '30d',
  'Este mês': 'month',
};

/** The preset behind a period's printed name. */
export function rangeId(label: string): string {
  const id = RANGE_IDS[label];
  if (!id) throw new Error(`unknown period "${label}"`);
  return id;
}

/**
 * The picker's QUICK column, by the same printed names.
 *
 * Deliberately a second map rather than a reuse of the one above: four of the
 * quick entries read word-for-word like the pills and mean the same window,
 * which is exactly the coincidence one journey is about — and the other five
 * are periods the pills do not offer at all.
 */
const QUICK_RANGE_IDS: Record<string, string> = {
  Hoje: 'today',
  '7 dias': 'last-7-days',
  '30 dias': 'last-30-days',
  'Este mês': 'this-month',
};

/** The quick entry behind a period's printed name. */
export function quickRangeId(label: string): string {
  const id = QUICK_RANGE_IDS[label];
  if (!id) throw new Error(`no quick range named "${label}"`);
  return id;
}

/** The grid of saved reports. */
export function reportsList(page: Page): Locator {
  return page.getByTestId('reports-card-list');
}

/** One block on whichever canvas is on screen — the viewer's or the editor's. */
export function block(page: Page, id: string): Locator {
  return page.getByTestId(`report-block-${id}`);
}

/**
 * The rows a block is showing.
 *
 * Every rendering this is asked about draws a `<tbody>` — a table block, and a
 * chart block switched to its table view — so counting rows is the one measure
 * that means the same thing before and after the toggle.
 */
export function blockRows(page: Page, id: string): Locator {
  return block(page, id).locator('tbody tr');
}

/** Open the report the host published to the team, from the list. */
export async function openPublishedReport(page: Page): Promise<void> {
  const { id } = reportsWorld().fixtures.publishedReport;
  await page.getByTestId(`reports-card-${id}-open`).click();
  await expect(page.getByTestId('page-report')).toBeVisible({ timeout: BLOCK_RENDER_TIMEOUT_MS });
}

/** The same report, opened straight into its editor. */
export async function openEditorOfPublishedReport(page: Page): Promise<void> {
  await openPublishedReport(page);
  await page.getByTestId('report-edit').click();
  await expect(page.getByTestId('page-report-editor')).toBeVisible({
    timeout: BLOCK_RENDER_TIMEOUT_MS,
  });
}

/**
 * The id of the report the address bar is currently on.
 *
 * Every screen in the surface routes to `…/reports/<id>`, whatever the host
 * mounted it under and whether or not that host uses a hash — so this is the
 * one way to learn the id of a report the author has just CREATED without the
 * scenario guessing at it or matching a card by its text.
 */
export function openReportId(page: Page): string {
  const match = /\/reports\/([^/?#]+)/.exec(page.url());
  if (!match?.[1]) throw new Error(`no report id in the address bar: ${page.url()}`);
  return match[1];
}
