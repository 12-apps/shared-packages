import { expect, test } from '@playwright/test';

/**
 * `@12-apps/notifications/toast/react` mounted as a host mounts it
 * (`src/pages/notifications-center.tsx`, "Toasts"): the subpath resolves from
 * the built package, and a queued toast and a declarative one both land in the
 * ONE column at the top of the screen, on the inverse surface.
 *
 * No backend: the toasts are raised by the page's own buttons.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('#/notifications-center');
  await expect(page.getByTestId('host-toast-raise')).toBeVisible();
});

test('draws a queued toast at the top of the screen, near-black, with its action', async ({ page }) => {
  await page.getByTestId('host-toast-raise').click();
  const toast = page.getByTestId('host-toast-saved');
  await expect(toast).toBeVisible();
  await expect(page.getByTestId('toast-viewport').getByTestId('host-toast-saved')).toBeVisible();
  const box = await toast.boundingBox();
  expect(box?.y ?? Infinity).toBeLessThan(40);
  await expect(toast).toHaveCSS('background-color', 'rgb(33, 33, 33)');
  await page.getByTestId('host-toast-undo').click();
  await expect(toast).toHaveCount(0);
});

test('draws a declarative toast in the same column and closes it from its own button', async ({ page }) => {
  await page.getByTestId('host-toast-hold').click();
  const held = page.getByTestId('host-toast-held');
  await expect(page.getByTestId('toast-slot').getByTestId('host-toast-held')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Não foi possível salvar');
  await page.getByRole('button', { name: 'Fechar aviso' }).click();
  await expect(held).toHaveCount(0);
});
