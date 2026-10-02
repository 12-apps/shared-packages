import { expect, test } from '@playwright/test';

/**
 * `@12-apps/notifications/attention/react` mounted as a host mounts it
 * (`src/notifications/attention-wiring.tsx`): the subpath resolves from the
 * built package, renders in a real browser, ranks by the host's wiring, opens
 * the sheet a kind declares, and keeps the device's settings across a reload.
 *
 * No backend: what waits is two fixed items, so this needs no reset.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('#/notifications-center');
  await expect(page.getByTestId('attention-button')).toBeVisible();
});

test('names the late order first, in amber, and holds the fresh return behind a +1', async ({ page }) => {
  const button = page.getByTestId('attention-button');
  await expect(button).toHaveAttribute('aria-label', 'Próximo: Pedido #31, Separar pedido, há 15 min. Mais 1');
  await expect(button).toHaveAttribute('data-severity', 'late');
  const others = page.getByTestId('attention-others');
  await expect(others).toHaveAttribute('aria-label', 'Ver mais 1');
  await expect(others).toHaveAttribute('data-severity', 'calm');
});

test('opens the sheet the kind declares, and lists the rest', async ({ page }) => {
  await page.getByTestId('attention-button').click();
  const sheet = page.getByRole('dialog', { name: 'Pedido #31' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Fechar' }).click();
  await expect(sheet).toHaveCount(0);

  await page.getByTestId('attention-others').click();
  await expect(page.getByTestId('attention-others-r-77')).toHaveAttribute(
    'aria-label',
    'Pedido #77, Analisar devolução, 2 min, no prazo',
  );
});

test("keeps this device's settings across a reload", async ({ page }) => {
  const bell = page.getByTestId('attention-quick-settings');
  await expect(bell).toHaveAttribute('data-on', 'false');
  await bell.click();
  await page.getByTestId('attention-quick-settings-panel').getByRole('radio', { name: 'Tudo' }).first().check();
  await expect(bell).toHaveAttribute('data-on', 'true');
  await page.reload();
  await expect(page.getByTestId('attention-quick-settings')).toHaveAttribute('data-on', 'true');
});
