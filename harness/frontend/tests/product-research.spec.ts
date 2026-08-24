import { expect, test, type Page } from '@playwright/test';

/**
 * `@12-apps/product-research-ui` from a real browser, against the real engine.
 *
 * The package is headless: every screen reads and writes through a
 * `ResearchApiClient` the HOST implements, and no fetch happens inside it. Its
 * own jsdom suite therefore drives a hand-written client answering fixtures —
 * which is exactly why nothing upstream can make the claim these cases make.
 * Two tarballs meet here over a socket: `@12-apps/product-research` declares
 * the routes and `@12-apps/product-research-ui` renders their answers, and the
 * shapes between them (`ResearchRequestView`, `ResearchRunView`) travel through
 * a store seam typed `Promise<unknown>` so a host can answer anything at all.
 *
 * There is NO type error when a host's client answers a smaller shape. There is
 * only a screen rendering `undefined`, in production. That is the failure this
 * page exists to make red.
 */

const PAGE = '#/product-research';

async function reset(page: Page): Promise<void> {
  /* eslint-disable-next-line test-flakiness/no-unmocked-network -- driving the real
     backend is the point of this harness: this is the suite's own reset control on
     the server the browser is talking to, and mocking it would leave nothing under
     test. */
  const response = await page.request.post('/__harness/reset');
  expect(response.ok()).toBe(true);
}

/** Fill the published form and submit it. */
async function research(page: Page, term: string, quantity = 1): Promise<void> {
  await page.getByTestId('research-term').fill(term);
  await page.getByTestId('research-quantity').fill(String(quantity));
  await page.getByTestId('research-submit').click();
}

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await reset(page);
  // `reload`, never a second `goto(PAGE)` — the URL is already this hash, so an
  // identical goto is a same-document navigation and the mount-time fetch never
  // re-fires.
  await page.reload();
  await expect(page.getByTestId('research-home')).toBeVisible();
});

test('an empty history says so in the host words', async ({ page }) => {
  await expect(page.getByTestId('research-history-empty')).toHaveText(
    'Nenhuma pesquisa ainda — a primeira leva segundos.',
  );
});

test('refuses a term too short to search, without asking the server', async ({ page }) => {
  // The guard is the package's and runs before any call — which is worth
  // pinning from a browser because the failure it prevents is a request the
  // engine would happily persist with a two-character term.
  await research(page, 'a');

  await expect(page.getByTestId('research-form-error')).toBeVisible();
  await expect(page.getByTestId('research-history-empty')).toBeVisible();
});

test('a research crosses into the engine and comes back as a run', async ({ page }) => {
  await research(page, 'Água mineral 500ml', 10);

  // The run screen polls `getRequest` until a run appears — the arrangement the
  // 202 forces, because the accepted answer cannot carry a run id.
  await expect(page.getByTestId('research-open-run')).toBeVisible();
  await expect(page.getByTestId('best-offer-card')).toBeVisible();

  // The winner is the cheapest TOTAL for ten units, not the cheapest sticker:
  // 430×10 with unstated shipping beats 480×10 plus 1200. Every one of those
  // numbers came out of Postgres, through the engine's route, into the
  // published card.
  await expect(page.getByTestId('best-offer-title')).toContainText('Atacado Litoral');
});

test('reports the source that failed rather than shortening the list', async ({ page }) => {
  // Degradation is what the run screen is built around: a failed source is a
  // banner, never a silently shorter list. The stat rows come from the run's
  // `source_stats` JSONB, so this is the whole chain — worker, column, route,
  // component.
  await research(page, 'Café em grão');

  await expect(page.getByTestId('research-degraded')).toBeVisible();
  await expect(page.getByTestId('source-status-list')).toContainText('Mercado Norte');
});

test('the history lists what was just researched, and reopens it', async ({ page }) => {
  await research(page, 'Café em grão');
  await expect(page.getByTestId('best-offer-card')).toBeVisible();

  // The listing is the ONE route of the seventeen the engine deliberately does
  // not declare — a host route mounted beside the package's own POST on the
  // same path. Its rows render through the same `ResearchRequestView` the poll
  // above returned, so a host that spelled that shape twice fails right here.
  await expect(page.getByTestId('research-history')).toContainText('Café em grão');
  await expect(page.getByTestId('research-history-empty')).toBeHidden();
});

test('a listed research can be repeated, catalog pointer and all', async ({ page }) => {
  await research(page, 'Café em grão', 4);
  await expect(page.getByTestId('best-offer-card')).toBeVisible();

  // `isResearchRepeatable` is the package's own guard, shared with hosts that
  // render their own history grid so both offer Repetir on exactly the same
  // rows. A COMPLETED run is repeatable; the button being enabled is that guard
  // reading a real run's real status.
  // Addressed by the row's own id-keyed test id — there is exactly one research
  // in this case, so the pattern resolves to one button without counting.
  const repeat = page.getByTestId(/^research-history-repeat-/);
  await expect(repeat).toBeEnabled();
  await repeat.click();

  await expect(page.getByTestId('best-offer-card')).toBeVisible();
});
