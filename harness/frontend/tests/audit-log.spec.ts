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
 * Since the trail moved onto `@12-apps/ui`'s `DataViews` grid, the CONTROLS
 * below are that grid's — the search box, the filter pills, the period range,
 * the counter — and the page is mounted with no `table` binding, which is the
 * arrangement a host that wires no saved-view backend gets. So this also proves
 * the standalone fallback renders and filters, and not only the wired path.
 *
 * The one thing the extraction origin's own e2e spec could not assert, because
 * its screen did not render it, is here: the impersonation PAIR. Its API carried
 * both names and the viewer dropped them, so a support session was
 * indistinguishable on screen from the account owner working alone.
 */

/**
 * Wider than the default 1280, and that is about the SPEC rather than the
 * screen. The grid's filter bar is responsive: it measures itself and folds
 * whatever will not fit into a "Mais N" panel, so at 1280 the period range
 * moves out of reach the moment a pill is active — and a case that then failed
 * would be reporting the ladder, not the trail. The ladder is `@12-apps/ui`'s
 * own to test; these cases are about what the audit surface asks the grid for,
 * so they are given a viewport where every control it declares is on screen.
 */
test.use({ viewport: { width: 1800, height: 900 } });

test.beforeEach(async ({ request }) => {
  /* eslint-disable-next-line test-flakiness/no-unmocked-network --
     the unmocked network IS the subject: a mocked reset would restore a database
     nothing under test is reading (same rationale as rbac-admin.spec.ts beside
     this file). */
  const response = await request.post('/__harness/reset');
  expect(response.status()).toBe(204);
});

/**
 * Open the trail and wait for the grid SHELL.
 *
 * The container rather than the table, deliberately: the table is only in the
 * DOM once there are rows, so a case that narrows a filter to nothing would be
 * waiting for an element the screen is correct not to have.
 */
async function openTrail(page: Page): Promise<void> {
  await page.goto('#/audit-log');
  await expect(page.getByTestId('audit-log-grid-container')).toBeVisible();
}

/** Tick one option inside a filter pill's menu, by the label the host gave it. */
async function pickOption(page: Page, fieldId: string, label: string): Promise<void> {
  await page.getByTestId(`audit-log-filter-${fieldId}`).click();
  // By ROLE, not by text: an option's label is the same word the column it
  // filters renders in every row, so a bare text query matches the menu item
  // and the table at once.
  await page.getByRole('menuitem', { name: label }).click();
  await page.keyboard.press('Escape');
}

/**
 * The unpaginated total the SERVER answered, off the toolbar counter.
 *
 * The counter reads "<matched> de <total>"; this returns the second number,
 * which is the database's `count` rather than a tally of loaded rows — the
 * useful assertion the moment a filter narrows past one page.
 */
async function serverTotal(page: Page): Promise<number> {
  const text = (await page.getByTestId('audit-log-counter').textContent()) ?? '';
  const parts = text.match(/(\d+)\D+(\d+)/);
  expect(parts).not.toBeNull();
  return Number(parts?.[2]);
}

/**
 * Type a `YYYY-MM-DD` day into one of the period bounds, in the order THE FIELD
 * asks for, and answer what it should then read.
 *
 * The bounds are masked text fields whose segment order comes from the running
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
async function typeDayBound(page: Page, bound: 'min' | 'max', iso: string): Promise<string> {
  const field = page.getByTestId(`audit-log-range-period-${bound}`);
  const placeholder = (await field.getAttribute('placeholder')) ?? '';
  const [year, month, day] = iso.split('-') as [string, string, string];
  const tokens = placeholder.split(/[^A-Za-z]+/).filter(Boolean);
  // A bound that announces no order is a bound whose order nobody can know —
  // including this helper, which would then type nothing and let every
  // assertion below pass vacuously.
  expect(tokens).toHaveLength(3);
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

/** Open the period pill's popover, where both bounds live. */
async function openPeriod(page: Page): Promise<void> {
  await page.getByTestId('audit-log-range-period').click();
  await expect(page.getByTestId('audit-log-range-period-panel')).toBeVisible();
}

test.describe('The trail', () => {
  test('renders the seeded entries with labelled actions and resources', async ({ page }) => {
    await openTrail(page);

    // The page HEADER's own title, not a loose text match: "Audit trail" is
    // also the breadcrumb's last crumb, and the two are different claims.
    await expect(page.getByTestId('audit-log-dashboard-header')).toContainText('Audit trail');
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
    expect(await serverTotal(page)).toBe(4);

    await pickOption(page, 'action', 'Lamp extinguished');

    const grid = page.getByTestId('audit-log-grid');
    await expect(grid.getByText('Lamp extinguished')).toBeVisible();
    await expect(grid.getByText('Keeper assigned')).toHaveCount(0);
    // The count came back from the database, not from a client-side filter.
    await expect
      .poll(() => serverTotal(page))
      .toBe(1);
  });

  test('a resource pill and the keyword search compose', async ({ page }) => {
    await openTrail(page);

    await pickOption(page, 'resourceType', 'Lamp');
    await expect.poll(() => serverTotal(page)).toBe(2);

    // The grid's own search box, debounced — so the assertion polls rather than
    // reading once, exactly as an operator waits a beat after typing.
    await page.getByTestId('audit-log-search-all').fill('beacon-7');

    await expect.poll(() => serverTotal(page)).toBe(1);
    await expect(page.getByTestId('audit-log-grid')).toContainText('beacon-7');
  });

  test('the actor pill is the tenant roster, and filters by the chosen person', async ({
    page,
  }) => {
    await openTrail(page);

    // Populated by the package's own `/audit-logs/actors` route through the host
    // directory port — a host with no directory is offered no actor pill at all,
    // because a pill whose menu is empty reads as a broken filter.
    await pickOption(page, 'actorUserId', 'Cora Wick');

    await expect(page.getByTestId('audit-log-grid')).toContainText('Keeper assigned');
    await expect.poll(() => serverTotal(page)).toBe(1);
  });

  test('a period with no entries shows the empty state, and Clear filters restores', async ({
    page,
  }) => {
    await openTrail(page);

    await openPeriod(page);
    await typeDayBound(page, 'min', '2020-01-01');
    await typeDayBound(page, 'max', '2020-01-02');
    await page.keyboard.press('Escape');

    // The grid writes its OWN empty state when something is narrowing the list —
    // "nothing here yet" under an active filter is a different sentence, and the
    // wrong one.
    await expect(page.getByTestId('audit-log-empty-filtered')).toBeVisible();

    // The way out the FILTERED empty state carries, which is the whole reason
    // the grid writes its own sentence there rather than deferring to the
    // host's "nothing here yet": the fix is one click, and it is right there.
    await page.getByTestId('audit-log-empty-clear').click();
    await expect(page.getByTestId('audit-log-grid')).toBeVisible();
    await expect.poll(() => serverTotal(page)).toBe(4);
  });

  test('a day bound typed one digit at a time keeps every digit', async ({ page }) => {
    // The defect the masked field exists to prevent, in a real browser: a
    // controlled `<input type="date">` reports a WHOLE date from the year's first
    // digit, the surface's own commit comes back a render later, and the
    // browser's segment buffer is discarded mid-edit — so `2026` was applied as
    // the year `0006`, which is a valid date and looks like it worked.
    //
    // The field moved into `@12-apps/ui` with the grid; the property did not
    // move with it, because it is about a masked field COMBINED with a surface
    // that commits and re-renders around it. This is still where those meet.
    await openTrail(page);
    await openPeriod(page);

    // A year the seed cannot reach whatever day the suite runs on, so the empty
    // state means "the year that arrived is the year that was typed". An edit
    // interrupted mid-year lands in the 00xx range, which is BEFORE every seeded
    // row — the grid would still be full, and the old field failed exactly that
    // way while looking like it had worked.
    const displayed = await typeDayBound(page, 'min', '2099-12-31');

    await expect(page.getByTestId('audit-log-range-period-min')).toHaveValue(displayed);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('audit-log-empty-filtered')).toBeVisible();
  });

  test('the period clears from its own ✕, without dropping the other filters', async ({
    page,
  }) => {
    // "Clear filters" drops every pill, the search and the window; dropping the
    // window alone should not cost the rest of the screen.
    await openTrail(page);
    await pickOption(page, 'action', 'Lamp extinguished');
    await expect.poll(() => serverTotal(page)).toBe(1);

    await openPeriod(page);
    // A window wide enough to hold whatever day the seed stamped, so what the
    // ✕ changes is the only thing under test.
    await typeDayBound(page, 'min', '2020-01-01');
    await page.keyboard.press('Escape');

    await page.getByTestId('audit-log-range-period-clear').click();

    // The action pill survived: still one entry, not four.
    await expect.poll(() => serverTotal(page)).toBe(1);
    await expect(page.getByTestId('audit-log-grid')).toContainText('Lamp extinguished');
  });

  test('the counter reports the SERVER total, and one page needs no pager', async ({ page }) => {
    await openTrail(page);

    // Four seeded entries at the default page size of 20: one page, so the
    // pager is not rendered at all. The number is the database's `count`, not a
    // row tally — which is what makes it the useful assertion when a filter
    // narrows.
    expect(await serverTotal(page)).toBe(4);
    await expect(page.getByTestId('audit-log-pagination')).toHaveCount(0);
  });
});
