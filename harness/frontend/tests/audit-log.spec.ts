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

/**
 * Type a `YYYY-MM-DD` day into one of the bounds, in the order THE FIELD asks
 * for, and answer what it should then read.
 *
 * The bounds are masked text fields whose segment order comes from the surface's
 * locale, so the eight digits a person types are not the order the wire carries.
 * This spec used to `fill('2020-01-01')`, and under a month-first runtime that
 * is a 20th month: refused, nothing committed, and the filter silently never
 * applied — the exact upgrade hazard the package's own notes call out. The order
 * is read back off the PLACEHOLDER the component renders from its own format, so
 * this helper cannot drift from the mask — and a placeholder that lied about the
 * order would fail these cases, which is the second thing it proves.
 *
 * Typed one digit at a time, with a delay, deliberately: each keystroke is a real
 * render and a whole date is a real request. A `fill()` jumps straight to the
 * finished value and never visits the intermediate states, which is where a
 * controlled date field loses what is being typed.
 */
async function typeDayBound(page: Page, testId: string, iso: string): Promise<string> {
  const field = page.getByTestId(testId);
  const placeholder = (await field.getAttribute('placeholder')) ?? '';
  const [year, month, day] = iso.split('-') as [string, string, string];
  const tokens = placeholder.split(/[^A-Za-z]+/).filter(Boolean);
  // A bound that announces no order is a bound whose order nobody can know —
  // including this helper, which would then type nothing and let every
  // assertion below pass vacuously.
  expect(tokens, `${testId} must announce its segment order in its placeholder`).toHaveLength(3);
  const segments = tokens.map((token) => {
    const head = token.slice(0, 1).toLowerCase();
    if (head === 'y' || head === 'a') return year;
    return head === 'd' ? day : month;
  });
  await field.fill('');
  await field.pressSequentially(segments.join(''), { delay: 60 });
  const separator = placeholder.replace(/[A-Za-z]/g, '').slice(0, 1) || '/';
  return segments.join(separator);
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

    await typeDayBound(page, 'audit-log-from', '2020-01-01');
    await typeDayBound(page, 'audit-log-to', '2020-01-02');

    await expect(page.getByTestId('audit-log-empty')).toBeVisible();

    await page.getByTestId('audit-log-clear').click();
    await expect(page.getByTestId('audit-log-grid')).toBeVisible();
    await expect(page.getByTestId('audit-log-page-status')).toHaveText(
      'Page 1 of 1 · 4 entries',
    );
  });

  test('a day bound typed one digit at a time keeps every digit', async ({ page }) => {
    // The defect the masked field exists to prevent, in a real browser: a
    // controlled `<input type="date">` reports a WHOLE date from the year's first
    // digit, the surface's own commit comes back a render later, and the
    // browser's segment buffer is discarded mid-edit — so `2026` was applied as
    // the year `0006`, which is a valid date and looks like it worked.
    await openTrail(page);

    // A year the seed cannot reach whatever day the suite runs on, so the empty
    // state means "the year that arrived is the year that was typed". An edit
    // interrupted mid-year lands in the 00xx range, which is BEFORE every seeded
    // row — the grid would still be full, and the old field failed exactly that
    // way while looking like it had worked.
    const displayed = await typeDayBound(page, 'audit-log-from', '2099-12-31');

    await expect(page.getByTestId('audit-log-from')).toHaveValue(displayed);
    await expect(page.getByTestId('audit-log-empty')).toBeVisible();
  });

  test('each bound clears on its own, without dropping the other', async ({ page }) => {
    // "Clear filters" drops every pill, the search and both bounds; dropping one
    // end of a window should not cost the rest of the screen. The ✕ also has to
    // survive its own re-render — it lives in the field's adornment, so a blur
    // that rebuilds it between mousedown and mouseup swallows the click.
    await openTrail(page);

    // A window wide enough to hold whatever day the seed stamped, so what the
    // ✕ changes is the only thing under test.
    const upper = await typeDayBound(page, 'audit-log-to', '2099-12-31');
    const lower = await typeDayBound(page, 'audit-log-from', '2020-01-01');
    await expect(page.getByTestId('audit-log-from')).toHaveValue(lower);

    await page.getByTestId('audit-log-from-clear').click();

    await expect(page.getByTestId('audit-log-from')).toHaveValue('');
    await expect(page.getByTestId('audit-log-to')).toHaveValue(upper);
    await expect(page.getByTestId('audit-log-grid')).toBeVisible();
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
