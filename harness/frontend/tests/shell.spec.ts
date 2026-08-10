import { expect, test } from '@playwright/test';

/**
 * The harness chrome at the width it is actually read on.
 *
 * The harness is where these packages get looked at on a phone, so its own
 * shell has to survive one. It did not: a 280px rail out of a 390px viewport
 * left the page 110px, and out of a 660px one left it 380px — narrower than a
 * single chart. The rail is an overlay drawer below 900px now, the way
 * future-pay's admin shell has always done it.
 *
 * These are geometry and media-query claims, which is why they live here
 * rather than in a unit test: jsdom matches no media query it is not told to,
 * so a jsdom version of this would be asserting the stub.
 */

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

test('on a phone the nav is behind a menu button, not docked', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('#/report-builder');

  // The rail is gone and the toggle is what stands in for it.
  await expect(page.getByTestId('harness-sidebar')).toBeHidden();
  await expect(page.getByTestId('harness-nav-toggle')).toBeVisible();

  // Which means the page gets the width. Anything under ~340px here is the
  // regression this guards: the rail still taking its 280px.
  const content = await page.getByTestId('page-reports').boundingBox();
  if (!content) throw new Error('the reports page should be rendered');
  expect(content.width).toBeGreaterThan(340);
});

test('the phone drawer opens from the toggle and closes on a destination', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('#/report-builder');

  await expect(page.getByTestId('harness-sidebar-drawer')).toBeHidden();
  await page.getByTestId('harness-nav-toggle').click();
  await expect(page.getByTestId('harness-sidebar-drawer')).toBeVisible();

  // Every row in this nav IS a route change, so a drawer that stayed open
  // would sit over the page it was just asked for.
  //
  // The destination is read off the row's own href rather than written down:
  // a nav row's KEY and its SLUG are different strings here (`checkout` points
  // at `payments-checkout-pix`), so a hard-coded slug is a guess that rots the
  // first time a page is renamed. This still asserts the navigation happened —
  // it just asks the link where it goes.
  const row = page.getByTestId('harness-nav-checkout');
  const slug = (await row.getAttribute('href'))?.replace('#/', '');
  if (!slug) throw new Error('the checkout row should link somewhere');

  await row.click();
  await expect(page.getByTestId('harness-sidebar-drawer')).toBeHidden();
  await expect(page.getByTestId('harness-page')).toHaveAttribute('data-page', slug);
});

test('on a desktop the rail is docked and there is no phone header', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto('#/report-builder');

  const rail = await page.getByTestId('harness-sidebar').boundingBox();
  if (!rail) throw new Error('the rail should be docked');
  expect(Math.round(rail.width)).toBe(280);

  // A second header above an already-visible rail would be a title bar for a
  // page that has its own.
  await expect(page.getByTestId('harness-top-bar')).toBeHidden();
});
