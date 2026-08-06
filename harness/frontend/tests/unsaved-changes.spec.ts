import { expect, test } from '@playwright/test';

/**
 * The browser half of FUT-391's unsaved-changes state. These assertions cannot
 * be made in the package's own suite: it runs vitest with `environment: 'node'`,
 * where there is no `window` to listen on and no `beforeunload` to fire.
 */

test('a fresh report is clean', async ({ page }) => {
  await page.goto('#/unsaved-changes');

  await expect(page.getByTestId('unsaved-changes')).toBeVisible();
  await expect(page.getByTestId('dirty-state')).toHaveText('Salvo');
});

test('an edit marks it dirty', async ({ page }) => {
  await page.goto('#/unsaved-changes');

  await page.getByTestId('name-input').fill('Vendas 2');
  await expect(page.getByTestId('dirty-state')).toHaveText('Alterações não salvas');
});

/**
 * The acceptance criterion, and the reason dirtiness is a comparison rather
 * than a flag an edit raises: undoing a change by hand must return the report
 * to clean. A `setDirty(true)`-per-edit implementation fails this.
 */
test('undoing an edit by hand returns it to clean', async ({ page }) => {
  await page.goto('#/unsaved-changes');

  await page.getByTestId('name-input').fill('Vendas 2');
  await expect(page.getByTestId('dirty-state')).toHaveText('Alterações não salvas');

  await page.getByTestId('name-input').fill('Vendas');
  await expect(page.getByTestId('dirty-state')).toHaveText('Salvo');
});

test('choosing the width it already had never marks it dirty', async ({ page }) => {
  await page.goto('#/unsaved-changes');

  // The "drag that lands where it started" case, in the form this page can
  // express: a control fires its onChange, the value does not change.
  await page.getByTestId('span-select').selectOption('6');
  await expect(page.getByTestId('dirty-state')).toHaveText('Salvo');

  await page.getByTestId('span-select').selectOption('12');
  await expect(page.getByTestId('dirty-state')).toHaveText('Alterações não salvas');
});

test('saving clears the flag by moving the baseline', async ({ page }) => {
  await page.goto('#/unsaved-changes');

  await page.getByTestId('name-input').fill('Vendas 2');
  await page.getByTestId('save-button').click();

  await expect(page.getByTestId('dirty-state')).toHaveText('Salvo');
  // …and the edit survived: clearing the flag must not revert the draft.
  await expect(page.getByTestId('name-input')).toHaveValue('Vendas 2');
});

test('Ctrl+S saves when dirty', async ({ page }) => {
  await page.goto('#/unsaved-changes');

  await page.getByTestId('name-input').fill('Vendas 2');
  await expect(page.getByTestId('save-count')).toHaveText('0');

  await page.keyboard.press('Control+s');

  await expect(page.getByTestId('save-count')).toHaveText('1');
  await expect(page.getByTestId('dirty-state')).toHaveText('Salvo');
});

test('Meta+S saves too, so the shortcut works on a Mac', async ({ page }) => {
  await page.goto('#/unsaved-changes');

  await page.getByTestId('name-input').fill('Vendas 3');
  await page.keyboard.press('Meta+s');

  await expect(page.getByTestId('save-count')).toHaveText('1');
});

test('Ctrl+S on a clean report does nothing', async ({ page }) => {
  await page.goto('#/unsaved-changes');

  // Not merely harmless — the handler must not preventDefault either, or it
  // swallows a shortcut the person may have meant for the browser.
  await page.keyboard.press('Control+s');

  await expect(page.getByTestId('save-count')).toHaveText('0');
  await expect(page.getByTestId('dirty-state')).toHaveText('Salvo');
});
