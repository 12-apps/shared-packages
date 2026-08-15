import { expect, type Browser, type Page } from '@playwright/test';
import { defineReportsWorld } from '@12-apps/report-builder/e2e';

/**
 * THIS APP'S half of the packaged report journeys (FUT-755).
 *
 * The scenarios and their steps ship inside `@12-apps/report-builder`; none of
 * them is copied here, and none of them knows what a harness page is. What is
 * host-specific is exactly what this file supplies: which URL the reports area
 * lives at, how to get the saved documents back to a known state, what a fresh
 * session is, and which of this app's own seeded rows a scenario may name.
 *
 * That is the integration a real consumer performs too — the origin host's admin
 * routes to `/{slug}/reports` where this routes to `#/report-builder`, and
 * resets through its own State API where this posts to `/__harness/reset`. The
 * features do not change.
 *
 * It lives in the `steps` glob on purpose: playwright-bdd imports every step
 * file before any scenario runs, so the `defineReportsWorld` call below lands
 * in every worker before the first Given executes.
 */

/** The harness page that mounts the surface — see `src/pages/report-builder.tsx`. */
const REPORTS_URL = '#/report-builder';

async function openReports(page: Page): Promise<void> {
  await page.goto(REPORTS_URL);
  await expect(page.getByTestId('reports-card-list')).toBeVisible();
}

defineReportsWorld({
  /**
   * Back to the seeded documents.
   *
   * The suite's own control, deliberately NOT under `/api` so nothing can
   * mistake it for part of the package's surface — and served by the same
   * backend the surface itself talks to, reached through the same Vite proxy,
   * so nothing here needs to know which port that backend is on.
   */
  reset: async (page: Page) => {
    const response = await page.request.post('/__harness/reset');
    // A silent failure here is a journey that starts from whatever the last
    // one left behind — visible only as an unrelated scenario going red later.
    expect(response.status()).toBe(204);
  },

  openReports,

  /**
   * A fresh context is the whole of a "new session" here: this harness has no
   * login, so nothing else distinguishes one visit from another. The origin
   * comes from the session being left rather than from a literal, so the port
   * is stated once, in `playwright.config.ts`.
   */
  openInNewSession: async (browser: Browser, from: Page) => {
    const context = await browser.newContext({ baseURL: new URL(from.url()).origin });
    const page = await context.newPage();
    await openReports(page);
    return page;
  },

  /**
   * The facts the scenarios name out loud, all of them from
   * `harness/backend/src/fixtures` — the seven saved rows, the catalog, and
   * the frozen clock the custom window is stated against.
   */
  fixtures: {
    // The two picker entries this app declares in `src/pages/report-builder.tsx`
    // — its own product, named here because the journeys stopped naming them.
    //
    // The `id` is what the tile's test id is built from, and it is supplied
    // rather than derived: the package used to derive it from the title through
    // a seven-entry map of the application it was extracted from, so a host
    // whose picker offered anything else got `unknown block template`. Neither
    // of these two shares a word with that map, which is what makes them a test
    // of the port rather than of a coincidence.
    blockTemplates: {
      first: { id: 'serie-cronologica', title: 'Série cronológica' },
      second: { id: 'reparticao-por-canal', title: 'Repartição por canal' },
    },
    // `r1` is the two-block dashboard published to the whole team: a bar chart
    // over payment methods, and a day-bucketed table beside it.
    publishedReport: {
      id: 'r1',
      name: 'Vendas por forma de pagamento',
      chartBlockId: 'revenue',
      tableBlockId: 'daily',
    },
    // An hour-of-day is a STRING, offerable as a line only because the catalog
    // declares it ordered — which is what makes it worth naming here.
    orderedGrouping: 'Hora do dia',
    unorderedGrouping: 'Forma de pagamento',
    // The clock is frozen at 2026-07-05, so the report opens on 30 dias
    // (06/06 – 05/07) and its calendar opens on June. 20–25 June holds exactly
    // one order in the fixture: `o7`, on the 20th.
    customWindow: { fromDay: 20, toDay: 25, reads: '20/06 – 25/06', rows: 1 },
  },
});
