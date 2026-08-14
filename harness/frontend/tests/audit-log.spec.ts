import { expect, test, type Page } from '@playwright/test';

/**
 * `@12-apps/audit` mounted the way a host mounts it: one call to
 * `createWebAudit({ apiBase, vocabulary })`, no route table, no screen imported
 * by name — driving the published package's own Hono router over a real Postgres
 * through the Vite proxy, as the seeded owner.
 *
 * Every label below comes from the HOST: the action and resource names from the
 * vocabulary this app declares (`src/pages/audit-log.tsx`), and the chrome from
 * the package's English defaults, which a real host overrides with its own copy.
 * The package ships no product vocabulary at all, which is what makes this a
 * consumer proof rather than a restatement of a default.
 *
 * The one thing the extraction origin's own e2e spec could not assert, because
 * its screen did not render it, is here: the impersonation PAIR. Its API carried
 * both names and the viewer dropped them, so a support session was
 * indistinguishable on screen from the account owner working alone.
 */

test.beforeEach(async ({ request }) => {
  /* eslint-disable-next-line test-flakiness/no-unmocked-network --
     the unmocked network IS the subject: a mocked reset would restore a database
     nothing under test is reading (same rationale as rbac-admin.spec.ts beside
     this file). */
  const response = await request.post('/__harness/reset');
  expect(response.status()).toBe(204);
});

async function openTrail(page: Page): Promise<void> {
  await page.goto('#/audit-log');
  await expect(page.getByTestId('audit-log-grid')).toBeVisible();
}

test.describe('The trail', () => {
  test('renders the seeded entries with labelled actions and resources', async ({ page }) => {
    await openTrail(page);

    await expect(page.getByRole('heading', { name: 'Audit trail' })).toBeVisible();
    const grid = page.getByTestId('audit-log-grid');
    // Labels come from the vocabulary the BACKEND validates against — one value,
    // so an action that exists is an action the screen can name.
    await expect(grid.getByText('Lamp extinguished')).toBeVisible();
    await expect(grid.getByText('Keeper assigned')).toBeVisible();
    await expect(grid.getByText('Lamp relit')).toBeVisible();
    // The redacted diff, as "field: before → after".
    await expect(grid.getByText('state: LIT → DARK')).toBeVisible();
  });

  test('names the actor and their role, and says System when nobody acted', async ({ page }) => {
    await openTrail(page);

    const grid = page.getByTestId('audit-log-grid');
    await expect(grid.getByText('Ada Keeper · OWNER')).toBeVisible();
    // The webhook entry: a system write names no one, and must not be attributed
    // to whoever happens to be reading the screen.
    await expect(grid.getByText('System', { exact: true })).toBeVisible();
  });

  test('renders the impersonation PAIR, naming both people on one line', async ({ page }) => {
    await openTrail(page);

    // The seeded relief session: support-1 acting as owner-1. Both ids were
    // resolved to names in ONE directory call by the listing route.
    const pair = page.getByTestId(/^audit-log-on-behalf-of-/);
    await expect(pair).toHaveCount(1);
    await expect(pair).toHaveText('relief@harness.dev on behalf of Ada Keeper');
    // …and the actor cell still names the REAL human, not the subject: that is the
    // whole property, and collapsing the two is unrecoverable on this table.
    const row = page.getByTestId('audit-log-grid').locator('tr', { hasText: 'beacon-7' });
    await expect(row).toContainText('relief@harness.dev · SUPERADMIN');
  });
});

test.describe('The filters', () => {
  test('an action pill narrows the trail through the backend', async ({ page }) => {
    await openTrail(page);

    await page.getByTestId('audit-log-action-lamp.extinguish').click();

    const grid = page.getByTestId('audit-log-grid');
    await expect(grid.getByText('Lamp extinguished')).toBeVisible();
    await expect(grid.getByText('Keeper assigned')).toHaveCount(0);
    // The count came back from the database, not from a client-side filter.
    await expect(page.getByTestId('audit-log-page-status')).toHaveText(
      'Page 1 of 1 · 1 entries',
    );
  });

  test('a resource pill and the keyword search compose', async ({ page }) => {
    await openTrail(page);

    await page.getByTestId('audit-log-resource-lamp').click();
    await expect(page.getByTestId('audit-log-page-status')).toHaveText(
      'Page 1 of 1 · 2 entries',
    );

    const search = page.getByTestId('audit-log-search');
    await search.fill('beacon-7');
    await search.press('Enter');

    await expect(page.getByTestId('audit-log-page-status')).toHaveText(
      'Page 1 of 1 · 1 entries',
    );
    await expect(page.getByTestId('audit-log-grid')).toContainText('beacon-7');
  });

  test('the actor picker is the tenant roster, and filters by the chosen person', async ({
    page,
  }) => {
    await openTrail(page);

    // Populated by the package's own `/audit-logs/actors` route through the host
    // directory port — a host with no directory gets a free-text id instead.
    await page.getByTestId('audit-log-actor-select').selectOption({ label: 'Cora Wick' });

    await expect(page.getByTestId('audit-log-grid')).toContainText('Keeper assigned');
    await expect(page.getByTestId('audit-log-page-status')).toHaveText(
      'Page 1 of 1 · 1 entries',
    );
  });

  test('a day range with no entries shows the empty state, and Clear filters restores', async ({
    page,
  }) => {
    await openTrail(page);

    await page.getByTestId('audit-log-from').fill('2020-01-01');
    await page.getByTestId('audit-log-to').fill('2020-01-02');

    await expect(page.getByTestId('audit-log-empty')).toBeVisible();

    await page.getByTestId('audit-log-clear').click();
    await expect(page.getByTestId('audit-log-grid')).toBeVisible();
    await expect(page.getByTestId('audit-log-page-status')).toHaveText(
      'Page 1 of 1 · 4 entries',
    );
  });

  test('the footer reports the SERVER totals, and pins both ends of one page', async ({
    page,
  }) => {
    await openTrail(page);

    // Four seeded entries at the default page size of 20: one page, so neither
    // control is live. The number is the database's `count`, not a row tally —
    // which is what makes it the useful assertion when a filter narrows.
    await expect(page.getByTestId('audit-log-page-status')).toHaveText(
      'Page 1 of 1 · 4 entries',
    );
    await expect(page.getByTestId('audit-log-prev')).toBeDisabled();
    await expect(page.getByTestId('audit-log-next')).toBeDisabled();
  });
});
