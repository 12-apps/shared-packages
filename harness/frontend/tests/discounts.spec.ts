import { expect, test } from '@playwright/test';

/**
 * `@12-apps/discounts` — the promotions admin, driven end to end.
 *
 * This package's SERVER half has been mounted and tested in the backend harness
 * for a while; its WEB half had no consumer anywhere until `src/pages/discounts.tsx`.
 * So every component below — the grid, the fourteen-input form, the toggles —
 * shipped release after release with nothing rendering it, and nothing was red:
 * `assemble()` reports on packages a host ADOPTED, so a web manifest nobody
 * binds is not an unanswered capability, it is a package the report never hears
 * about.
 *
 * What this spec proves is the SEAM, which is the half neither package suite
 * can reach. The screens are unit-tested inside the package against a stub
 * transport; the routes are tested inside the backend harness against a real
 * database. Nothing until now put the two in the same process: a form POSTing
 * one body shape and a handler reading another stay green in their own suites
 * forever.
 *
 * Every click here crosses a real socket — Vite proxies `/api` to
 * `harness/backend`, which serves the packed tarball's own handlers over a real
 * PGlite.
 */

test.beforeEach(async ({ request }) => {
  // `reseedDiscounts` deletes every discount and rebuilds the catalog the
  // target pickers read. Discounts deliberately start EMPTY — the catalog is
  // the fixture, the promotions are what the operator creates — so this is what
  // makes "the grid shows what I just made" a claim about this run.
  /* eslint-disable-next-line test-flakiness/no-unmocked-network --
     the unmocked network IS the subject, as in feature-flags.spec.ts beside this file. */
  await request.post('/__harness/reset');
});

test('the page renders the package screen, in the host words', async ({ page }) => {
  await page.goto('#/discounts');

  await expect(page.getByTestId('page-discounts')).toBeVisible();
  // The package's own pt-BR pack, passed rather than retyped. Copy is REQUIRED
  // config with no defaults, so a heading here is proof the host supplied it.
  await expect(page.getByRole('heading', { name: 'Descontos' })).toBeVisible();
  await expect(page.getByTestId('discounts-grid')).toBeVisible();
});

test('an operator creates a promotion and the backend keeps it', async ({ page }) => {
  await page.goto('#/discounts');
  await page.getByTestId('new-discount-button').click();

  const dialog = page.getByTestId('discount-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('discount-dialog-title')).toContainText('Novo desconto');

  // The form is the package's, every input of it. The host supplied only the
  // money field — and `percentOff` is not it, which is the point of the kind
  // toggle deciding what the rest of the form looks like.
  await dialog.locator('input[name="name"]').fill('Terça em dobro');
  await dialog.locator('input[name="percentOff"]').fill('15');
  await page.getByTestId('discount-form-submit').click();

  // The row arrives from the SERVER, not from optimistic local state: the grid
  // refetches through the same transport the create went out on.
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('discounts-grid')).toContainText('Terça em dobro');

  // A reload is the honest test of "the backend kept it" — an optimistic cache
  // survives a rerender and does not survive this.
  await page.reload();
  await expect(page.getByTestId('discounts-grid')).toContainText('Terça em dobro');
});

test('the grid filters live in the URL, which is why the host wires a real Router', async ({
  page,
}) => {
  // `DiscountsScreen` keeps its grid state in `useSearchParams`, and
  // `react-router-dom` is a declared PEER of the package rather than an
  // incidental import. A host that satisfied the context with a `MemoryRouter`
  // would render every screen and work every filter while the address bar never
  // moved — a filtered view would stop being a link an operator can send.
  //
  // So the assertion is on the QUERY STRING, not on the page still being at
  // `#/discounts`: the shell puts that there, so asserting it would pass under
  // a MemoryRouter and prove nothing about the wiring it claims to check.
  await page.goto('#/discounts');
  await page.getByPlaceholder('Buscar…').fill('almoço');

  await expect(page).toHaveURL(/#\/discounts\?.*q=almo/u);
});
