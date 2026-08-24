import { expect, test } from '@playwright/test';

/**
 * The web half of the wiring contract, asserted the only way a browser host
 * can: by rendering `assemble()`.
 *
 * The backend harness pins its report in a unit suite; this app has no test
 * that runs its module graph outside a browser, so the report page is the
 * fixture and this spec is the assertion. What it makes impossible is the
 * failure that had no symptom before — a package shipping a web capability
 * nobody binds, with every screen still rendering exactly as it did.
 */
test.describe('the frontend host wiring report', () => {
  test('assembles without an unanswered capability', async ({ page }) => {
    await page.goto('/#/wiring-report');

    // Rendering at all is half the claim: `assemble()` THROWS while anything
    // declared is unanswered, so a page that painted is a host that answered.
    await expect(page.getByTestId('wiring-report')).toBeVisible();
    await expect(page.getByTestId('wiring-host')).toHaveText('harness-frontend (web)');

    const statuses = await page
      .locator('[data-testid^="wiring-"][data-status]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-status')));

    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses).not.toContain('unanswered');
    expect(statuses).not.toContain('unbound');
  });

  test('accounts for every package this app adopted', async ({ page }) => {
    await page.goto('/#/wiring-report');

    // Every web manifest this host binds. Named rather than counted: a count
    // passes when one package silently replaces another, which is the drift the
    // report exists to catch.
    for (const name of [
      '@12-apps/audit',
      '@12-apps/auth',
      '@12-apps/auth-platform',
      '@12-apps/discounts',
      '@12-apps/entitlements',
      '@12-apps/entity-lifecycle',
      '@12-apps/feature-flags',
      '@12-apps/impersonation',
      '@12-apps/notifications',
      '@12-apps/payments-checkout-ui',
      '@12-apps/payments-frontend',
      '@12-apps/product-research-ui',
      '@12-apps/rbac',
      '@12-apps/realtime',
      '@12-apps/report-builder',
    ]) {
      await expect(page.getByTestId(`wiring-package-${name}`)).toBeVisible();
      // Every one of them binds a surface — that is what a web adoption IS.
      await expect(page.getByTestId(`wiring-${name}-surface`)).toHaveAttribute(
        'data-status',
        'bound',
      );
    }
  });

  test('collects the AREAS a direct factory call leaves on the floor', async ({ page }) => {
    await page.goto('/#/wiring-report');

    // `areas` are route + nav SUGGESTIONS a package makes, each naming the
    // permission it is gated on. A host calling `createWeb*` directly never
    // sees them, which is how a package's own screen ends up unreachable in an
    // app that installed it.
    await expect(page.getByTestId('wiring-@12-apps/audit-areas')).toHaveAttribute(
      'data-status',
      'collected',
    );
    await expect(page.getByTestId('wiring-@12-apps/rbac-areas')).toHaveAttribute(
      'data-status',
      'collected',
    );
    // `@12-apps/realtime` ships plumbing rather than screens and declares NO
    // areas — the report says so instead of going quiet.
    await expect(page.getByTestId('wiring-@12-apps/realtime-areas')).toHaveCount(0);
  });

  test('says the SERVER halves are the backend harness to answer', async ({ page }) => {
    await page.goto('/#/wiring-report');

    // The same manifest declares both runtimes, and a web host must not be
    // able to claim it bound an http route. `out-of-scope` is the report
    // stating which host owes the answer, and the sibling backend harness's
    // suite is where it is given.
    await expect(page.getByTestId('wiring-@12-apps/audit-http')).toHaveAttribute(
      'data-status',
      'out-of-scope',
    );
  });
});
