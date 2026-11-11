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

  // The form is the package's, every input of it, asked in four steps. The
  // host supplied only the money field — and `percentOff` is not it, which is
  // the point of the kind deciding what step 3 looks like. Step 3 mounts it
  // only once steps 1 and 2 are passed (FUT-4477).
  await dialog.locator('input[name="name"]').fill('Terça em dobro');
  await dialog.getByRole('button', { name: 'Continuar' }).click();
  await dialog.getByRole('button', { name: 'Continuar' }).click();
  await dialog.locator('input[name="percentOff"]').fill('15');
  await dialog.getByRole('button', { name: 'Continuar' }).click();
  await dialog.getByRole('button', { name: 'Pronto' }).click();
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

test('the host slot reports a bulk batch, and Desfazer restores what changed (FUT-4420)', async ({
  page,
  request,
}) => {
  const body = (name: string) => ({
    name,
    type: 'PERCENTAGE',
    percentOffBp: 1000,
    scope: 'ORDER',
    trigger: 'AUTOMATIC',
    stackable: true,
    active: true,
    endsAt: '2099-03-10',
  });
  /* eslint-disable test-flakiness/no-unmocked-network -- the unmocked network IS the subject. */
  await request.post('/api/admin/harness/discounts', { data: body('Lote A') });
  await request.post('/api/admin/harness/discounts', { data: body('Lote B') });
  /* eslint-enable test-flakiness/no-unmocked-network */

  await page.goto('#/discounts');
  await expect(page.getByTestId('discounts-grid')).toContainText('Lote B');

  // Two rows ticked, Ações (2) opens the package's entries.
  await page.getByTestId('discounts-grid').getByRole('checkbox').nth(0).check();
  await page.getByTestId('discounts-grid').getByRole('checkbox').nth(1).check();
  await page.getByTestId('discounts-bulk-actions').click();
  await page.getByRole('menuitem', { name: 'Desativar todos' }).click();

  await expect(page.getByTestId('bulk-counts')).toContainText('2 alterados');
  await page.getByTestId('bulk-undo').click();
  await expect(page.getByTestId('bulk-undone')).toContainText('2 desfeitos');
});

test('the extend dialog keeps its two ways on one row at 320 (FUT-4420)', async ({ page, request }) => {
  /* eslint-disable test-flakiness/no-unmocked-network -- the unmocked network IS the subject. */
  for (const name of ['Largura A', 'Largura B']) {
    await request.post('/api/admin/harness/discounts', {
      data: {
        name,
        type: 'PERCENTAGE',
        percentOffBp: 1000,
        scope: 'ORDER',
        trigger: 'AUTOMATIC',
        stackable: true,
        active: true,
        endsAt: '2099-03-10',
      },
    });
  }
  /* eslint-enable test-flakiness/no-unmocked-network */
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('#/discounts');
  await expect(page.getByTestId('discounts-grid')).toContainText('Largura B');
  await page.getByTestId('discounts-grid').getByRole('checkbox').nth(0).check();
  await page.getByTestId('discounts-grid').getByRole('checkbox').nth(1).check();
  await page.getByTestId('discounts-bulk-actions').click();
  await page.getByRole('menuitem', { name: 'Estender validade…' }).click();

  const group = page.getByTestId('bulk-extend-mode');
  await expect(group).toBeVisible();
  const buttons = await group.getByRole('button').all();
  const boxes = await Promise.all(buttons.map((button) => button.boundingBox()));
  expect(boxes).toHaveLength(2);
  expect(boxes[0]!.y).toBeCloseTo(boxes[1]!.y, 0);
  expect(boxes[0]!.width).toBeCloseTo(boxes[1]!.width, 0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

async function seedThree(request: import('@playwright/test').APIRequestContext): Promise<void> {
  /* eslint-disable test-flakiness/no-unmocked-network -- the unmocked network IS the subject. */
  for (const name of ['Fila A', 'Fila B', 'Fila C']) {
    await request.post('/api/admin/harness/discounts', {
      data: {
        name,
        type: 'PERCENTAGE',
        percentOffBp: 1000,
        scope: 'ORDER',
        trigger: 'AUTOMATIC',
        stackable: true,
        active: true,
        endsAt: '2099-03-10',
      },
    });
  }
  /* eslint-enable test-flakiness/no-unmocked-network */
}

test('a second batch cannot start while one runs, and one row gets no bulk entries (FUT-4420)', async ({
  page,
  request,
}) => {
  await seedThree(request);
  let posts = 0;
  await page.route('**/discounts/bulk', async (route) => {
    posts += 1;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.goto('#/discounts');
  await expect(page.getByTestId('discounts-grid')).toContainText('Fila C');
  const boxes = page.getByTestId('discounts-grid').getByRole('checkbox');

  // One row: Ações offers no bulk entry at all (Excluir only).
  await boxes.nth(0).check();
  await page.getByTestId('discounts-bulk-actions').click();
  await expect(page.getByRole('menuitem', { name: 'Desativar todos' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Excluir' })).toBeVisible();
  await page.keyboard.press('Escape');

  await boxes.nth(1).check();
  await boxes.nth(2).check();
  await page.getByTestId('discounts-bulk-actions').click();
  await page.getByRole('menuitem', { name: 'Desativar todos' }).click();
  await expect(page.getByTestId('bulk-running')).toBeVisible();

  // While the batch is in flight the grid still holds the selection, but the entries are gone.
  await page.getByTestId('discounts-bulk-actions').click();
  await expect(page.getByRole('menuitem', { name: 'Ativar todos' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Estender validade…' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await expect(page.getByTestId('bulk-counts')).toContainText('3 alterados');
  expect(posts).toBe(1);
});

test('the extend dialog: singular title, focus in the field, Enter confirms, hint follows the mode (FUT-4420)', async ({
  page,
  request,
}) => {
  await seedThree(request);
  await page.goto('#/discounts');
  await expect(page.getByTestId('discounts-grid')).toContainText('Fila C');
  const boxes = page.getByTestId('discounts-grid').getByRole('checkbox');
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.getByTestId('discounts-bulk-actions').click();
  await page.getByRole('menuitem', { name: 'Estender validade…' }).click();

  await expect(page.getByText('Estender validade de 2 descontos')).toBeVisible();
  // Focus lands on the next action, never on the container.
  await expect(page.getByTestId('bulk-extend-days')).toBeFocused();
  await expect(page.getByTestId('bulk-extend-hint')).toContainText('Conta a partir do fim');

  await page.getByRole('button', { name: 'Nova data' }).click();
  await expect(page.getByTestId('bulk-extend-hint')).toContainText('Todos passam a acabar nesta data');
  await expect(page.getByTestId('bulk-extend-date')).toBeFocused();
  await page.getByTestId('bulk-extend-date').fill('01012000');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Escolha uma data de hoje em diante.')).toBeVisible();

  await page.getByRole('button', { name: '+ dias' }).click();
  await expect(page.getByTestId('bulk-extend-days')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('bulk-counts')).toContainText('2 alterados');
  await expect(page.getByTestId('bulk-row-ok').first()).toContainText('Validade estendida');
});
