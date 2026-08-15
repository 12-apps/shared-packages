import { expect, test } from '@playwright/test';

/**
 * THE WALKTHROUGH MUST SAY THE ADOPTER'S NAME, AND NOBODY ELSE'S (FUT-760/761).
 *
 * Two shipped setup guides addressed the platform by the origin host's brand
 * name in the middle of a pt-BR instruction — "é assim que o <brand> confirma
 * que a notificação veio mesmo da Stone" (Stone), "não há como reverter pelo
 * <brand>" (InfinitePay). Those sentences render to a STORE OWNER, out of a
 * package four products install, so every adopter but one shipped a stranger's
 * brand on its own settings screen.
 *
 * No test caught it because the package's own suites fed those guides the very
 * host vocabulary the guides had baked in, and agreement proves nothing when
 * both sides are the same string. `SetupGuideContext.brandName` is the seam
 * that fixed it; this spec is the consumer-side proof, and it belongs HERE
 * rather than in the package because `harness/frontend` builds against the
 * PACKED TARBALL — what it renders is what npm would upload. A unit test can
 * assert that an interpolation happens; only a consumer can assert the shipped
 * artifact carries no leftover.
 *
 * The negative assertion is the load-bearing half. `toContainText(brand)` alone
 * would pass on a guide that interpolates once and hardcodes a second name
 * somewhere else — which is exactly the state this replaces.
 */

/** What the harness — a deliberately fictional adopter — calls itself. */
const HOST_BRAND = 'Plataforma Harness';

/** Real adopters of this package. None may appear in shipped copy. */
const ADOPTER_NAMES = /future[\s_-]?pay|paladira/i;

test.beforeEach(async ({ page }) => {
  // `guide-brand` seeds Stone CONNECTED. A guide renders the section of the
  // stage it opens on, and Stone's brand sentence lives in the webhook
  // section — on a fresh row that text is not in the DOM at all, so a spec
  // pointed at the default case would fail for a reason that has nothing to
  // do with what it is asserting.
  await page.goto('#/payments-provider-settings');
  await expect(page.getByTestId('harness-page')).toHaveAttribute(
    'data-page',
    'payments-provider-settings',
  );
  await page.getByTestId('harness-case-guide-brand').click();
  await expect(page.getByTestId('harness-case-body')).toHaveAttribute('data-case', 'guide-brand');
  await expect(page.getByTestId('payments-provider-settings')).toBeVisible();
});

test('a guide that names the platform names THIS host', async ({ page }) => {
  await page.getByTestId('payments-provider-card-stone').click();

  const guide = page.getByTestId('payments-setup-guide');
  await expect(guide).toBeVisible();
  await expect(guide).toContainText(HOST_BRAND);

  const rendered = await guide.innerText();
  expect(rendered).not.toMatch(ADOPTER_NAMES);
});

/**
 * The sweep: whatever any of the four published adapters puts on this screen,
 * none of it may name an adopter. Broader than the case above on purpose — a
 * brand can leak from a credential helper text or a link label just as easily
 * as from a guide step, and those have no seam of their own.
 */
test('no published provider surface names an adopter of this package', async ({ page }) => {
  for (const provider of ['pagbank', 'stone', 'infinitepay', 'stripe'] as const) {
    await page.getByTestId(`payments-provider-card-${provider}`).click();
    await expect(page.getByTestId('payments-provider-back')).toBeVisible();

    const panel = await page.getByTestId('payments-provider-settings').innerText();
    expect(panel, `${provider} panel names an adopter`).not.toMatch(ADOPTER_NAMES);

    await page.getByTestId('payments-provider-back').click();
  }
});
