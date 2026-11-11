import { expect, type Locator, type Page } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

import { discountsWorld } from '../world.js';

/**
 * The packaged journeys' step definitions.
 *
 * Every locator is a test id THIS package's own components render, which is
 * what makes the scenarios portable: `discounts-grid`, `discount-dialog`,
 * `discount-action-edit`, `combo-slots` and the `total-form-field-*` family
 * mean the same thing in any app that mounts `createWebDiscounts`. Everything a
 * host owns — sign-in, routing, how a percentage reads — arrives through the
 * world port rather than being written down here.
 *
 * ## Why `package.json` declares this file under `sideEffects`
 *
 * Every Given/When/Then below runs at IMPORT time — registering a step is the
 * whole point of the module, and it exports nothing anybody imports by name. To
 * a bundler doing tree-shaking that reads as dead weight, and dropping it is
 * licensed: the result is a suite where bddgen reports the features compiled
 * and every scenario then fails on an undefined step.
 *
 * Not one step asserts a SENTENCE. The origin host's spec did — it clicked
 * `menuitem { name: 'Editar' }` and a `Salvar alterações` button — which is why
 * it could only ever have run in that host: copy is required config, so the next
 * adopter's words are different by construction and the spec would fail for a
 * reason unrelated to promotions working.
 */
const { Given, When, Then } = createBdd();

const GRID = 'discounts-grid';
const DIALOG = 'discount-dialog';

/** The name the current scenario minted, so later steps can find its row. */
let currentName = '';

Given('I am signed in as somebody who may manage promotions', async ({ page }) => {
  await discountsWorld().signInAsManager(page);
});

When('I open the promotions screen', async ({ page }) => {
  await discountsWorld().openDiscountsScreen(page);
  await expect(page.getByTestId(GRID)).toBeVisible();
});

Then('the promotions grid is visible', async ({ page }) => {
  await expect(page.getByTestId(GRID)).toBeVisible();
});

/** The create dialog, open and ready to be filled. */
async function openCreateDialog(page: Page): Promise<Locator> {
  await page.getByTestId('new-discount-button').click();
  const dialog = page.getByTestId(DIALOG);
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Pass the open step: its Continuar (Pronto on step 4), which is enabled once the step is complete. */
async function passStep(dialog: Locator, step: 1 | 2 | 3 | 4): Promise<void> {
  const next = dialog.getByTestId(`discount-step-${step}-next`);
  await expect(next).toBeEnabled();
  await next.click();
}

When('I compose a percentage promotion', async ({ page }) => {
  const { newName, percent } = discountsWorld().fixtures;
  currentName = newName('Journey');
  const dialog = await openCreateDialog(page);
  // The form asks in four steps: what it is, where it applies (the whole
  // order by default), how much, and the rules (the usual ones by default).
  await dialog.getByTestId('total-form-field-name').fill(currentName);
  // Percentage is the default kind; picking it anyway is the interaction that
  // proves the cards drive which value field step 3 mounts.
  await dialog.getByTestId('discount-kind-PERCENTAGE').click();
  await passStep(dialog, 1);
  await passStep(dialog, 2);
  await dialog.getByTestId('total-form-field-percentOff').fill(percent);
  await passStep(dialog, 3);
  await passStep(dialog, 4);
  await dialog.getByTestId('discount-form-submit').click();
  await expect(dialog).toBeHidden();
});

/**
 * The row is found by NAME, and a name is the one user-visible string here that
 * is not copy — the scenario chose it a moment ago, so naming it is naming a
 * fixture rather than an adopter's wording.
 */
function rowFor(page: Page, name: string): Locator {
  return page.getByTestId(GRID).getByRole('row', { name: new RegExp(name) });
}

Then('the promotion is listed with its rate', async ({ page }) => {
  const row = rowFor(page, currentName);
  await expect(row).toBeVisible();
  // The round trip is the claim: a rate typed as a percentage comes back as one
  // only if the conversion into basis points and back out BOTH ran. How it
  // reads is the host's formatting, so the host states it.
  await expect(row.getByText(discountsWorld().fixtures.percentInGrid)).toBeVisible();
});

When('I start a promotion step by step', async ({ page }) => {
  await openCreateDialog(page);
});

Then('the first step cannot be passed yet and says what is missing', async ({ page }) => {
  const next = page.getByTestId(DIALOG).getByTestId('discount-step-1-next');
  await expect(next).toBeDisabled();
  // The reason is the button's description, not a sentence this package names.
  await expect(page.getByTestId(DIALOG).getByTestId('discount-step-1-missing')).not.toBeEmpty();
  await expect(next).toHaveAttribute('aria-describedby', 'discount-step-1-missing');
});

When('I name the promotion', async ({ page }) => {
  await page.getByTestId(DIALOG).getByTestId('total-form-field-name').fill(discountsWorld().fixtures.newName('Step'));
});

Then('the first step can be passed', async ({ page }) => {
  await expect(page.getByTestId(DIALOG).getByTestId('discount-step-1-next')).toBeEnabled();
  await expect(page.getByTestId(DIALOG).getByTestId('discount-step-1-missing')).toBeEmpty();
});

When('I start composing a promotion', async ({ page }) => {
  const dialog = await openCreateDialog(page);
  // Every step open at once, so each field is on screen whatever its step.
  await dialog.getByTestId('discount-see-all').click();
});

Then('the percentage field is the one on screen', async ({ page }) => {
  await expect(page.getByTestId(DIALOG).getByTestId('total-form-field-percentOff')).toBeVisible();
});

When('I switch it to a fixed amount', async ({ page }) => {
  await page.getByTestId(DIALOG).getByTestId('discount-kind-FIXED_AMOUNT').click();
});

Then('the amount field REPLACES the percentage one', async ({ page }) => {
  const dialog = page.getByTestId(DIALOG);
  await expect(dialog.getByTestId('total-form-field-amountOff')).toBeVisible();
  // Replaced, not hidden: a merely-hidden percentage input would still submit a
  // stale rate alongside an amount the operator typed.
  await expect(dialog.getByTestId('total-form-field-percentOff')).toHaveCount(0);
});

When('I switch it to a combo', async ({ page }) => {
  await page.getByTestId(DIALOG).getByTestId('discount-kind-COMBO').click();
});

Then('the scope question disappears and the group builder takes its place', async ({ page }) => {
  const dialog = page.getByTestId(DIALOG);
  // A combo COVERS the groups it is made of, so scope stops being a question at
  // all — unmounted rather than disabled. That is what stops an operator
  // building a combination the write path then refuses.
  await expect(dialog.getByTestId('total-form-field-scope-item-ORDER')).toHaveCount(0);
  await expect(dialog.getByTestId('combo-slots')).toBeVisible();
});

Then('the scope question comes back for a plain kind', async ({ page }) => {
  const dialog = page.getByTestId(DIALOG);
  await dialog.getByTestId('discount-kind-FIXED_AMOUNT').click();
  await expect(dialog.getByTestId('total-form-field-scope-item-ORDER')).toBeVisible();
});

When('I set the activation to a coupon code', async ({ page }) => {
  await page.getByTestId(DIALOG).getByTestId('total-form-field-trigger-item-CODE').click();
});

Then('the coupon field is revealed', async ({ page }) => {
  await expect(page.getByTestId(DIALOG).getByTestId('total-form-field-code')).toBeVisible();
});

/** Open the row's kebab and take one of its entries by its STABLE id. */
async function chooseRowAction(page: Page, action: 'edit' | 'delete'): Promise<void> {
  await rowFor(page, currentName).locator('[data-testid^="discount-actions-"]').click();
  await page.getByTestId(`discount-action-${action}`).click();
}

When('I rename it from the row menu', async ({ page }) => {
  await chooseRowAction(page, 'edit');
  const dialog = page.getByTestId(DIALOG);
  await expect(dialog).toBeVisible();
  currentName = `${currentName} II`;
  // An edit opens every step answered: the name is step 1's, reopened by its card.
  await dialog.getByTestId('discount-steps-identity-change').click();
  await dialog.getByTestId('total-form-field-name').fill(currentName);
  await dialog.getByTestId('discount-form-submit').click();
  await expect(dialog).toBeHidden();
});

Then('the grid shows the new name', async ({ page }) => {
  // The grid re-read the server — proof the write landed, rather than proof the
  // dialog closed.
  await expect(rowFor(page, currentName)).toBeVisible();
});

When('I delete it from the row menu', async ({ page }) => {
  await chooseRowAction(page, 'delete');
  // The menu entry only OPENS the confirmation; the DELETE leaves when it is
  // confirmed.
  await page.getByTestId('discount-delete-confirm-confirm-button').click();
});

Then('the promotion is gone from the grid', async ({ page }) => {
  // A soft delete: the row leaves the list even though the record survives for
  // its redemption history.
  await expect(rowFor(page, currentName)).toHaveCount(0);
});
