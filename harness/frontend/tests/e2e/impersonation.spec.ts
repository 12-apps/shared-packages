import { expect, test, type Page } from '@playwright/test';

/**
 * `@12-apps/impersonation`, driven through the harness.
 *
 * These are the cases PORTED from the application this package was extracted
 * from — the two that were worth a browser there, and the ones that only a real
 * mount can show:
 *
 *  1. **the start form's rules hold against the real endpoint.** The form
 *     refuses a short justification and the server refuses it again; either
 *     alone would be a rule a change on the other side could silently drop.
 *  2. **a start is refused for another platform account, in the server's own
 *     words.** A lateral move between full-privilege accounts is the refusal the
 *     whole mechanism is built around, and the refusal has to survive the trip
 *     back to the screen rather than being re-derived from a status code.
 *  3. **the write gate is real.** Five host endpoints behind it, one per rule —
 *     which is the half no unit test can show, because the gate's whole job is
 *     to sit between a browser and a route.
 *  4. **the trail is written.** A start that left no record is the one outcome
 *     this mechanism exists to prevent.
 *
 * The Gherkin journeys in `@12-apps/impersonation/e2e` cover the operator's and
 * the previewer's paths end to end; these stay hand-written because each one is
 * an assertion about a WIRE (a status, a recorded row) rather than about a
 * person's journey.
 */

const PAGE = '#/impersonation';

const REASON = 'the borrower says their card will not scan at the gate';

test.beforeEach(async ({ page, context }) => {
  // The session is a cookie, so a server-side reset alone would leave the
  // previous test's session live in this context.
  await context.clearCookies();
  await page.request.post('/__harness/reset');
  await page.goto(PAGE);
  await expect(page.getByTestId('impersonation-page')).toBeVisible();
});

async function chooseBranch(page: Page): Promise<void> {
  await page.getByTestId('impersonation-tenant').getByRole('combobox').click();
  await page.getByRole('option', { name: 'North Branch (/harness)' }).click();
}

test('the form refuses a start until a branch and a written reason are supplied', async ({
  page,
}) => {
  await page.getByTestId('impersonate-patron-1').click();
  await expect(page.getByTestId('impersonation-dialog')).toBeVisible();

  // A person is directory-wide; the cookie carries exactly one branch, so the
  // branch is the first thing missing, not the reason.
  await expect(page.getByTestId('impersonation-confirm')).toBeDisabled();
  await expect(page.getByTestId('impersonation-blocker')).toContainText(
    'Choose the branch this session applies to.',
  );

  await chooseBranch(page);
  await expect(page.getByTestId('impersonation-blocker')).toContainText('at least 15');

  // Too short is still refused — the length is the deterrent, not the presence.
  await page.getByTestId('impersonation-reason').fill('card');
  await expect(page.getByTestId('impersonation-confirm')).toBeDisabled();

  await page.getByTestId('impersonation-reason').fill(REASON);
  await expect(page.getByTestId('impersonation-confirm')).toBeEnabled();

  // Read-only is the default and the screen says so before anything starts.
  await expect(page.getByTestId('impersonation-readonly-note')).toContainText('only look');
});

test('a start aimed at another system librarian is refused, and says why', async ({ page }) => {
  await page.getByTestId('impersonate-system-2').click();
  await chooseBranch(page);
  await page.getByTestId('impersonation-reason').fill(REASON);

  await expect(page.getByTestId('impersonation-confirm')).toBeEnabled();
  await page.getByTestId('impersonation-confirm').click();

  // The SERVER's own sentence, not a status code — and the dialog stays open so
  // the operator can pick a different account without starting over.
  await expect(page.getByTestId('impersonation-error')).toContainText(
    'A system librarian may not be opened from the desk',
  );
  await expect(page.getByTestId('impersonation-dialog')).toBeVisible();
  await expect(page.getByTestId('impersonation-banner')).toHaveCount(0);
});

test('every kind of request meets the rule that governs it', async ({ page }) => {
  await page.getByTestId('preview-member').getByRole('combobox').click();
  await page.getByRole('option', { name: 'Role Target — staff' }).click();
  await page.getByTestId('preview-member-start').click();

  // A member preview resolves as somebody else, so it is read-only whatever the
  // cookie says.
  await expect(page.getByTestId('impersonation-banner')).toBeVisible();
  await expect(page.getByTestId('impersonation-banner-readonly')).toContainText('Look only');

  await page.getByTestId('probe-run').click();
  const results = page.getByTestId('probe-results');

  // An ordinary write: refused, because this session may only look.
  await expect(results).toContainText('An ordinary write: 403');
  // Money: refused for every kind, with a DIFFERENT sentence — the two refusals
  // are not interchangeable to whoever is reading the screen.
  await expect(results).toContainText('A money write: 403');
  await expect(results).toContainText('Loans and fines are never settled');
  // The verb is not evidence on a money path: an unlisted GET is refused too.
  await expect(results).toContainText('An unlisted money GET: 403');
  // …and the allowlisted read is not, or the feature would lose its point.
  await expect(results).toContainText('An allowlisted money read: 200');
  // A person's own record is never written to, whatever the session asked for.
  await expect(results).toContainText("A write to a borrower's own record: 403");
  await expect(results).toContainText('theirs to change');
});

test('the trail records the start before the cookie exists', async ({ page }) => {
  await page.getByTestId('impersonate-patron-1').click();
  await chooseBranch(page);
  await page.getByTestId('impersonation-reason').fill(REASON);
  await page.getByTestId('impersonation-confirm').click();

  await expect(page.getByTestId('impersonation-banner')).toBeVisible();

  const trail = await page.request
    .get('/__harness/impersonation/trail')
    .then((response) => response.json() as Promise<{ started: Record<string, unknown>[] }>);

  expect(trail.started).toHaveLength(1);
  expect(trail.started[0]).toMatchObject({
    kind: 'operator',
    tenantId: 'harness',
    targetUserId: 'patron-1',
    reason: REASON,
    allowWrites: false,
  });
});

test('the exit puts the operator back in their own view, from any page', async ({ page }) => {
  await page.getByTestId('impersonate-patron-1').click();
  await chooseBranch(page);
  await page.getByTestId('impersonation-reason').fill(REASON);
  await page.getByTestId('impersonation-confirm').click();
  await expect(page.getByTestId('impersonation-banner')).toBeVisible();

  // The banner is in the shell, so it follows the operator across the app.
  await page.goto('#/rbac-admin');
  await expect(page.getByTestId('impersonation-banner')).toBeVisible();

  await page.getByTestId('impersonation-banner-exit').click();
  await expect(page.getByTestId('impersonation-banner')).toHaveCount(0);
  // The host was told, which is where a real adopter drops its query cache.
  await expect(page.locator('html')).toHaveAttribute('data-impersonating', 'false');

  const trail = await page.request
    .get('/__harness/impersonation/trail')
    .then((response) => response.json() as Promise<{ ended: Record<string, unknown>[] }>);
  expect(trail.ended).toMatchObject([{ kind: 'operator', tenantId: 'harness' }]);
});

test('a revoked branch stops a live preview mid-session, and still lets it out', async ({
  page,
}) => {
  await page.getByTestId('preview-role').getByRole('combobox').click();
  await page.getByRole('option', { name: 'CLERK' }).click();
  await page.getByTestId('preview-role-start').click();
  await expect(page.getByTestId('impersonation-banner')).toBeVisible();

  // The branch switches desk sessions off while this one is open. The cookie's
  // own time box would not notice for another ten minutes — a time box is not a
  // revocation.
  await page.request.post('/__harness/impersonation/entitlement', {
    data: { tenantId: 'harness', enabled: false },
  });

  await page.getByTestId('probe-run').click();
  const results = page.getByTestId('probe-results');
  // Every request, INCLUDING the reads — which no other rule in this package
  // does.
  await expect(results).toContainText('An allowlisted money read: 403');
  await expect(results).toContainText('switched off for this branch');

  // …and the way out is never the request that fails.
  await page.getByTestId('impersonation-banner-exit').click();
  await expect(page.getByTestId('impersonation-banner')).toHaveCount(0);
});
