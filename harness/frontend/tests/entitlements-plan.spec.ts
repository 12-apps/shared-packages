import { expect, test } from '@playwright/test';

/**
 * `@12-apps/entitlements` driven end to end: the REAL `createWebEntitlements`
 * surface in the browser against the REAL `entitlementsRouter` mount in
 * harness/backend, through the same Vite proxy a production SPA uses.
 *
 * The seeded tenant is on the cheapest tier, which makes it the exact shape
 * the plan screen was written for — something IS withheld, so both ways the
 * screen could mislead a customer are reachable in one load: naming a tier
 * that would not fix the problem, and printing a raw plan key at them.
 */
test.beforeEach(async ({ request }) => {
  /* eslint-disable-next-line test-flakiness/no-unmocked-network --
     the unmocked network IS the subject: these cases prove the published
     packages work for a consumer reaching a real server. Same rationale as
     report-builder.spec.ts beside this file. */
  const response = await request.post('/__harness/reset');
  expect(response.status()).toBe(204);
});

test('the whole surface mounts from one factory call and names the plan commercially', async ({
  page,
  request,
}) => {
  await page.goto('#/entitlements-plan');

  await expect(page.getByTestId('plan-page')).toBeVisible();
  // The comparison is the page — the cards, the tenant's own marked.
  await expect(page.getByTestId('tier-cards')).toBeVisible();
  await expect(page.getByTestId('tier-badge-shorts')).toHaveText('SEU PLANO');
  await expect(page.getByTestId('plan-name')).toHaveText('Shorts');

  // The printed catalogue is the cheapest tier's canonical denial, and this
  // line is the load-bearing one: it must name "Feature", the tier's
  // COMMERCIAL name from the pricing catalog — never the raw key.
  await expect(page.getByTestId('plan-upsell-catalogue.print')).toContainText('Feature');

  // And the endpoint itself, so a narrowing of the read guard fails here
  // rather than only in whatever the SPA happens to render.
  /* eslint-disable-next-line test-flakiness/no-unmocked-network -- see beforeEach */
  const plan = await request.get('/api/admin/harness/plan');
  expect(plan.status()).toBe(200);
});

test("the tenant's own switch earns the way back to it — never a sale", async ({ page }) => {
  await page.goto('#/entitlements-plan');

  const row = page.getByTestId('plan-feature-submissions.notes');
  await expect(row).toContainText('Desligado por você');
  // The useful thing to hand them is the screen holding the switch…
  await expect(page.getByTestId('plan-switch-submissions.notes')).toContainText(
    'Ajustes › Curadoria',
  );
  // …not an upgrade that would change nothing.
  await expect(page.getByTestId('plan-upsell-submissions.notes')).toHaveCount(0);
});

test('an outgrown quota says everything keeps working', async ({ page }) => {
  await page.goto('#/entitlements-plan');

  // Four curators held against Shorts' ceiling of three: the feature IS in
  // the plan, so neither "not included" nor a bare "included" is honest.
  const row = page.getByTestId('plan-feature-screeners.invited');
  await expect(row).toContainText('Seu plano inclui 3 e você tem 4');
  await expect(row).toContainText('Todos continuam ativos');
});

test('asking for a tier files ONE lead, and it survives a reload', async ({ page }) => {
  await page.goto('#/entitlements-plan');

  await page.getByTestId('tier-cta-feature').click();
  await expect(page.getByTestId('plan-request-open')).toBeVisible();
  // One conversation per tenant: the ask button is gone, not re-offered.
  await expect(page.getByTestId('tier-cta-feature')).toHaveCount(0);

  // A real server holds the lead — the banner is still there after a reload,
  // which is exactly what an in-browser fixture could never prove.
  await page.reload();
  await expect(page.getByTestId('plan-request-open')).toBeVisible();
  await expect(page.getByTestId('tier-cta-feature')).toHaveCount(0);
});

test('a plan-gated page locks in-shell and funnels into the upgrade prompt', async ({ page }) => {
  await page.goto('#/entitlements-plan');

  // The cheapest tier does not include the jury room, so the gated host area
  // renders the package's lock — chrome intact — instead of the page.
  const lock = page.getByTestId('page-locked');
  await expect(lock).toBeVisible();
  await expect(lock).toHaveAttribute('data-feature', 'jury.deliberation');
  await expect(page.getByTestId('jury-area')).toHaveCount(0);

  // "Saiba mais" raises the single upsell surface every trigger lands on.
  await page.getByTestId('page-locked-upsell').click();
  await expect(page.getByTestId('upsell-modal')).toBeVisible();
  // The pitch names the commercial tier, resolved from the pricing cards.
  await expect(page.getByTestId('upsell-plan-name')).toContainText('Feature');

  // The CTA files the same lead the plan screen files.
  await page.getByTestId('upsell-cta').click();
  await expect(page.getByTestId('upsell-request-sent')).toBeVisible();
});

test('a gated HOST endpoint answers 402 with the body the interceptor parses', async ({
  request,
}) => {
  /* eslint-disable-next-line test-flakiness/no-unmocked-network -- see beforeEach */
  const denial = await request.get('/api/admin/harness/jury-demo');
  expect(denial.status()).toBe(402);
  const body = (await denial.json()) as Record<string, unknown>;
  expect(body).toMatchObject({
    code: 'entitlement_required',
    feature: 'jury.deliberation',
    reason: 'not-entitled',
    requiredPlan: 'feature',
  });
});
