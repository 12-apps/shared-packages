import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * "Novo desconto" as four collapsing steps (FUT-4479, journeys 1–6 of
 * FUT-4475), each at a phone's 390 and a computer's 1280, on the harness seed:
 * Bebidas / Lanches, Café / Suco / X-Salada (`harness/backend/src/discounts-host.ts`).
 *
 * Journey 1 compares the stored rule with the POST body the single-page form
 * sent on main for the same input (`form-payloads.json`, FUT-4477): the steps
 * are a view, and the payload must not move.
 */

const FIXTURES = JSON.parse(
  /* eslint-disable-next-line test-flakiness/no-unmocked-fs --
     the payloads main's form sent ARE the oracle (FUT-4477); a fixture file, read once. */
  readFileSync(
    fileURLToPath(new URL('../../../packages/discounts/src/react/__tests__/fixtures/form-payloads.json', import.meta.url)),
    'utf8',
  ),
).fixtures as Record<string, { body: Record<string, unknown> }>;

const API = '/api/admin/harness/discounts';

for (const width of [390, 1280]) {
  test.describe(`at ${width}`, () => {
    test.use({ viewport: { width, height: width > 1000 ? 800 : 844 } });

    test.beforeEach(async ({ request }) => {
      /* eslint-disable-next-line test-flakiness/no-unmocked-network --
         the harness backend IS the subject, as in discounts.spec.ts beside this file. */
      await request.post('/__harness/reset');
    });

    test('1: a closed-price combo in three Continuar, Pronto and Criar sends main\'s body', async ({ page }) => {
      const dialog = await openCreate(page);
      const posted = page.waitForRequest((req) => req.method() === 'POST' && req.url().endsWith('/discounts'));
      await fillComboStepOne(dialog);
      await next(dialog, 1);
      await fillComboStepTwo(page, dialog);
      await next(dialog, 2);
      await fillComboStepThree(dialog);
      await next(dialog, 3);
      // Step 4 (Regras) opens on its own after step 3, with its defaults.
      await expect(dialog.getByTestId('discount-steps-rules')).toHaveAttribute('aria-current', 'step');
      await next(dialog, 4);
      await expect(dialog.getByTestId('discount-form-submit')).toBeEnabled();
      await dialog.getByTestId('discount-form-submit').click();
      expect((await posted).postDataJSON()).toEqual(FIXTURES['combo-bundle-price']!.body);
      await expect(dialog).toBeHidden();
      await expect(page.getByTestId('discounts-grid')).toContainText('2 Lanches por R$ 30');
    });

    test('2: each step is held with what it misses, and freed when fixed', async ({ page }) => {
      const dialog = await openCreate(page);
      // Step 1: no name.
      await expectHeld(dialog, 1, 'Falta: nome');
      await fillComboStepOne(dialog);
      await next(dialog, 1);
      // Step 2: a group with nothing in it.
      await dialog.getByTestId('combo-add-slot').click();
      await expectHeld(dialog, 2, 'Falta: o que entra em cada grupo');
      await fillComboStepTwo(page, dialog, false);
      await next(dialog, 2);
      // Step 3: price 0.
      await chooseReward(dialog, 'Preço fechado');
      await fill(dialog, 'total-form-field-bundlePrice', '0');
      await expectHeld(dialog, 3, 'Falta: o valor');
      await fill(dialog, 'total-form-field-bundlePrice', '30,00');
      await next(dialog, 3);
      // Step 4: a coupon with no code, then a day that does not exist.
      await dialog.getByTestId('total-form-field-trigger').getByRole('button', { name: 'Código', exact: true }).click();
      await expectHeld(dialog, 4, 'Falta: código do cupom');
      await fill(dialog, 'total-form-field-code', 'LANCHE30');
      await dialog.getByRole('textbox', { name: 'Início' }).fill('31/02/2026');
      await expectHeld(dialog, 4, 'Falta: data de início');
      await dialog.getByRole('textbox', { name: 'Início' }).fill('');
      await expect(dialog.getByTestId('discount-step-4-next')).toBeEnabled();
    });

    test('3: Porcentagem by Categoria, and Itens grátis on Café and Suco', async ({ page }) => {
      let dialog = await openCreate(page);
      await fill(dialog, 'total-form-field-name', '10% em Bebidas');
      await next(dialog, 1);
      await expect(dialog.getByTestId('discount-steps-targets')).toContainText('Onde vale o desconto');
      await dialog.getByTestId('total-form-field-scope').getByRole('button', { name: 'Categoria', exact: true }).click();
      await pick(page, dialog, 'discount-categories-targets', 'Bebidas');
      await next(dialog, 2);
      await expect(dialog.getByTestId('discount-steps-targets-answer')).toHaveText('Categorias: Bebidas');
      await fill(dialog, 'total-form-field-percentOff', '10');
      await next(dialog, 3);
      await expect(dialog.getByTestId('discount-steps-price-answer')).toHaveText('Desconto (%): 10%');

      // Leaving with changes asks first (FUT-4478); this case discards.
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Descartar e sair' }).click();
      await expect(dialog).toBeHidden();
      dialog = await openCreate(page);
      await fill(dialog, 'total-form-field-name', 'Leve 3, pague 2');
      await dialog.getByTestId('discount-kind-FREE_UNITS').click();
      await next(dialog, 1);
      await expect(dialog.getByTestId('discount-steps-targets')).toContainText('O que entra na promoção');
      await fill(dialog, 'free-units-quantity', '3');
      await fill(dialog, 'free-units-free', '1');
      await pick(page, dialog, 'free-units-items', 'Café');
      await pick(page, dialog, 'free-units-items', 'Suco');
      await next(dialog, 2);
      await expect(dialog.getByTestId('discount-steps-targets-answer')).toHaveText('Leve 3, pague 2');
      await expect(dialog.getByTestId('discount-steps-price')).toContainText('Quantas vezes');
      await fill(dialog, 'total-form-field-maxComboApplications', '2');
      await next(dialog, 3);
      await expect(dialog.getByTestId('discount-steps-price-answer')).toHaveText('Vezes por pedido: 2 por pedido');
    });

    test('4: a duplicate coupon code opens Regras with the server\'s message, which survives other typing', async ({ page, request }) => {
      /* eslint-disable-next-line test-flakiness/no-unmocked-network --
         the harness backend IS the subject: a stored coupon the next one collides with. */
      await request.post(API, { data: { ...FIXTURES['fixed-item-coupon-rules']!.body, name: 'Primeiro' } });
      const dialog = await openCreate(page);
      await fill(dialog, 'total-form-field-name', 'Cupom repetido');
      await next(dialog, 1);
      await next(dialog, 2);
      await fill(dialog, 'total-form-field-percentOff', '10');
      await next(dialog, 3);
      await dialog.getByTestId('total-form-field-trigger').getByRole('button', { name: 'Código', exact: true }).click();
      await fill(dialog, 'total-form-field-code', 'XSALADA5');
      await next(dialog, 4);
      await dialog.getByTestId('discount-form-submit').click();
      const message = dialog.getByTestId('total-form-field-code-message');
      await expect(dialog.getByTestId('discount-steps-rules')).toHaveAttribute('aria-current', 'step');
      await expect(message).toHaveText('Este código de cupom já existe nesta loja.');
      await dialog.getByTestId('total-form-field-usageLimit').fill('5');
      await expect(message).toHaveText('Este código de cupom já existe nesta loja.');
      await fill(dialog, 'total-form-field-code', 'XSALADA6');
      await expect(message).toHaveCount(0);
    });

    test('5: an edit opens every step done, the strip, the pill, and asks before leaving with changes', async ({ page, request }) => {
      /* eslint-disable-next-line test-flakiness/no-unmocked-network --
         the harness backend IS the subject: the rule the edit opens. */
      await request.post(API, { data: FIXTURES['combo-bundle-price']!.body });
      await page.goto('#/discounts');
      // The one rule the reset left plus the one just stored: exactly one row.
      await page.locator('[data-testid^="discount-actions-"]').click();
      await page.getByTestId('discount-action-edit').click();
      const dialog = page.getByTestId('discount-dialog');
      for (const id of ['identity', 'targets', 'price', 'rules']) {
        await expect(dialog.getByTestId(`discount-steps-${id}`)).toHaveAttribute('data-state', 'done');
      }
      await expect(dialog.getByTestId('discount-see-all')).toHaveCount(0);
      await expect(dialog.getByTestId('discount-state-pill')).toContainText('Salvo');
      await expect(dialog.getByTestId('discount-submit-hold')).toHaveText('Nada mudou.');
      await expect(dialog.getByRole('toolbar', { name: 'Situação do desconto' })).toBeVisible();
      await dialog.getByTestId('discount-strip-activation').click();
      await dialog.getByTestId('total-form-field-trigger').getByRole('button', { name: 'Código', exact: true }).click();
      await fill(dialog, 'total-form-field-code', 'LANCHE30');
      await expect(dialog.getByTestId('discount-state-pill')).toContainText('Alterações não salvas');
      await expect(dialog.getByTestId('discount-form-submit')).toHaveText('Salvar alterações');
      await expect(dialog.getByTestId('discount-form-submit')).toBeEnabled();
      await page.keyboard.press('Escape');
      const confirm = page.getByTestId('discount-leave-confirm');
      await expect(confirm).toContainText('Sair sem salvar?');
      await confirm.getByRole('button', { name: 'Continuar editando' }).click();
      await expect(confirm).toBeHidden();
      await expect(dialog.getByTestId('total-form-field-code')).toHaveValue('LANCHE30');
      // Esc ON the question closes only the question: the sheet's own Escape
      // listener must not take it for a way out of the form underneath.
      await page.keyboard.press('Escape');
      await expect(confirm).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(confirm).toBeHidden();
      await expect(dialog.getByTestId('total-form-field-code')).toHaveValue('LANCHE30');
      await page.keyboard.press('Escape');
      await page.getByTestId('discount-leave-confirm').getByRole('button', { name: 'Descartar e sair' }).click();
      await expect(dialog).toBeHidden();
    });

    test('6: Ver tudo numa página creates the same rule as the steps', async ({ page }) => {
      const dialog = await openCreate(page);
      await dialog.getByTestId('discount-see-all').click();
      const posted = page.waitForRequest((req) => req.method() === 'POST' && req.url().endsWith('/discounts'));
      await fillComboStepOne(dialog);
      await fillComboStepTwo(page, dialog);
      await fillComboStepThree(dialog);
      await expect(dialog.getByTestId('discount-form-submit')).toBeEnabled();
      await dialog.getByTestId('discount-form-submit').click();
      expect((await posted).postDataJSON()).toEqual(FIXTURES['combo-bundle-price']!.body);
    });
  });
}

async function openCreate(page: Page): Promise<Locator> {
  await page.goto('#/discounts');
  await page.getByTestId('new-discount-button').click();
  const dialog = page.getByTestId('discount-dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

/** A field by test id, on the input itself or around it. */
async function fill(dialog: Locator, testId: string, text: string): Promise<void> {
  // The test id sits on the input itself or on its wrapper, depending on the field.
  const typed = 'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])';
  const input = dialog.locator(`${typed}[data-testid="${testId}"], [data-testid="${testId}"] ${typed}`);
  await input.fill(text);
}

async function pick(page: Page, dialog: Locator, testId: string, text: string): Promise<void> {
  await fill(dialog, testId, text);
  await page.getByRole('option', { name: text, exact: true }).click();
}

async function next(dialog: Locator, step: 1 | 2 | 3 | 4): Promise<void> {
  const button = dialog.getByTestId(`discount-step-${step}-next`);
  await expect(button).toBeEnabled();
  await button.click();
}

async function expectHeld(dialog: Locator, step: 1 | 2 | 3 | 4, missing: string): Promise<void> {
  const button = dialog.getByTestId(`discount-step-${step}-next`);
  await expect(button).toBeDisabled();
  const reason = dialog.getByTestId(`discount-step-${step}-missing`);
  // The id is React's own (useId): compare it, never a fixed string.
  await expect(button).toHaveAttribute('aria-describedby', (await reason.getAttribute('id')) ?? '');
  await expect(reason).toHaveText(missing);
}

async function fillComboStepOne(dialog: Locator): Promise<void> {
  await fill(dialog, 'total-form-field-name', '2 Lanches por R$ 30');
  await dialog.getByTestId('discount-kind-COMBO').click();
}

async function fillComboStepTwo(page: Page, dialog: Locator, add = true): Promise<void> {
  if (add) await dialog.getByTestId('combo-add-slot').click();
  await fill(dialog, 'combo-slot-0-quantity', '2');
  await pick(page, dialog, 'combo-slot-0-categories', 'Lanches');
}

/** "Como o combo é cobrado": three parts where they fit, a select where they do not (ADR 0190). */
async function chooseReward(dialog: Locator, label: string): Promise<void> {
  const field = dialog.getByTestId('total-form-field-comboReward');
  const select = field.getByRole('combobox');
  if ((await select.count()) > 0) {
    await select.click();
    await dialog.page().getByRole('option', { name: label }).click();
    return;
  }
  await field.getByRole('button', { name: label, exact: true }).click();
}

async function fillComboStepThree(dialog: Locator): Promise<void> {
  await chooseReward(dialog, 'Preço fechado');
  await fill(dialog, 'total-form-field-bundlePrice', '30,00');
}
