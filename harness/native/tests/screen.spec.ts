import { expect, test } from '@playwright/test';

test('published Screen bounds and scrolls the gallery', async ({ page }) => {
  await page.goto('/');
  const viewport = page.getByTestId('app-root-viewport');
  await expect(viewport).toBeVisible();
  const initial = await viewport.evaluate((element) => ({ height: element.clientHeight, scroll: element.scrollHeight }));
  expect(initial.height).toBeGreaterThan(0);
  expect(initial.scroll).toBeGreaterThan(initial.height);
  await viewport.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  expect(await viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await viewport.evaluate((element) => { element.scrollTop = 0; });
  await expect(page.getByTestId('section-text')).toBeVisible();
});
