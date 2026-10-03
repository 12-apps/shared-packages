import { expect, test, type Page } from '@playwright/test';

import { openAdminCase, openProvider } from './helpers/admin';
import { openPage } from './helpers/checkout';

/**
 * Pix manual through the PUBLISHED settings screen: the store's own Pix key,
 * shown to the buyer as a static code and confirmed by hand. Its probe is
 * local — no bank is called — so this is the one vendor a harness can save and
 * test end to end: a malformed key fails ON the key, a complete setup passes
 * every field and unlocks the switch.
 */

/** Save — the key is `confirmOnSave`, so the screen asks where the money goes first. */
async function saveConfirmingTheKey(page: Page): Promise<void> {
  await page.getByTestId('payments-save').click();
  await page.getByRole('dialog').getByRole('button', { name: /salvar/i }).click();
}

test('it asks for the key, the recipient, the city and the window to confirm in', async ({ page }) => {
  await openPage(page, 'payments-provider-settings');
  await openAdminCase(page, 'pix-manual');
  await openProvider(page, 'pixmanual');

  for (const key of ['pixKey', 'merchantName', 'merchantCity', 'confirmWithinMinutes']) {
    await expect(page.locator(`input#payments-credential-${key}`)).toBeVisible();
  }
});

test('a malformed key fails on the key itself, and a complete setup passes every field', async ({ page }) => {
  await openPage(page, 'payments-provider-settings');
  await openAdminCase(page, 'pix-manual');
  await openProvider(page, 'pixmanual');

  await page.locator('#payments-credential-pixKey').fill('123');
  await page.locator('#payments-credential-merchantName').fill('Padaria Boa');
  await page.locator('#payments-credential-merchantCity').fill('Recife');
  await saveConfirmingTheKey(page);
  await expect(page.getByTestId('payments-field-note-pixKey')).toContainText('não parece uma chave Pix');

  await page.locator('#payments-credential-pixKey').fill('loja@example.com');
  await saveConfirmingTheKey(page);
  await expect(page.getByTestId('payments-field-note-pixKey')).toContainText('Chave Pix com formato válido');
  await expect(page.getByTestId('payments-field-note-confirmWithinMinutes')).toContainText('30 minutos');
});
