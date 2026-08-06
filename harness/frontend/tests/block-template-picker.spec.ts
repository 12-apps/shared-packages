import { expect, test } from '@playwright/test';

/**
 * The published picker rendering the published template groups.
 *
 * The package proves each template COMPILES; only a browser proves the picker
 * shows them and hands the right one back. Those are different failures: a
 * template can be perfectly valid and still be unreachable behind a modal that
 * never opens.
 */

test('the picker offers grouped templates and the blank escape hatch', async ({ page }) => {
  await page.goto('#/block-template-picker');

  await page.getByTestId('open-picker').click();

  await expect(page.getByTestId('block-template-picker-receita-por-dia')).toBeVisible();
  await expect(page.getByTestId('block-template-picker-formas-de-pagamento')).toBeVisible();
  // Someone who knows what they want must not have to start from a template
  // and delete its parts.
  await expect(page.getByTestId('block-template-picker-blank')).toBeVisible();
});

test('a template hands back its spec, the blank one does not', async ({ page }) => {
  await page.goto('#/block-template-picker');

  await page.getByTestId('open-picker').click();
  await page.getByTestId('block-template-picker-receita-por-dia').click();

  await expect(page.getByTestId('picked-id')).toHaveText('receita-por-dia');
  await expect(page.getByTestId('picked-has-spec')).toHaveText('yes');

  await page.getByTestId('open-picker').click();
  await page.getByTestId('block-template-picker-blank').click();

  await expect(page.getByTestId('picked-id')).toHaveText('blank');
  await expect(page.getByTestId('picked-has-spec')).toHaveText('no');
});

test('a template names its description to a screen reader', async ({ page }) => {
  await page.goto('#/block-template-picker');
  await page.getByTestId('open-picker').click();

  // The description is the reason to pick this one, so it belongs in the
  // control's accessible name rather than as adjacent text that may never be
  // announced.
  await expect(page.getByTestId('block-template-picker-receita-por-dia')).toHaveAttribute(
    'aria-label',
    /Receita por dia — .+/,
  );
});

test('cancel closes without picking anything', async ({ page }) => {
  await page.goto('#/block-template-picker');

  await page.getByTestId('open-picker').click();
  await page.getByTestId('block-template-picker-cancel').click();

  await expect(page.getByTestId('block-template-picker-receita-por-dia')).toHaveCount(0);
  await expect(page.getByTestId('picked-id')).toHaveText('(nenhum)');
});
