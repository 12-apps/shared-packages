import { expect, type Page } from '@playwright/test';

/**
 * The three or four gestures every checkout spec repeats (FUT-743).
 *
 * Deliberately thin. Anything that DECIDES something — which method, which
 * store, what the wire should say — stays in the spec, so a spec still reads as
 * the thing it asserts. What lives here is only the typing.
 */

/** A CPF that passes the real check-digit rule, which is what the form runs. */
export const VALID_CPF = '529.982.247-25';

/** A PAN that passes Luhn. Under stub mode it mints a fake token locally. */
export const GOOD_PAN = '4111 1111 1111 1111';

/** The sandbox PAN that always declines, honoured by the shipped tokenizer. */
export const DECLINE_PAN = '4000 0000 0000 0002';

/** Open a harness page BY SLUG, and prove the shell really rendered that one. */
export async function openPage(page: Page, slug: string): Promise<void> {
  await page.goto(`#/${slug}`);
  await expect(page.getByTestId('harness-page')).toHaveAttribute('data-page', slug);
}

/** Select one case on a multi-store page, and wait for its body to be current. */
export async function openCase(page: Page, id: string): Promise<void> {
  await page.getByTestId(`harness-case-${id}`).click();
  await expect(page.getByTestId('harness-case-body')).toHaveAttribute('data-case', id);
}

/** Fill the Dados step's CPF. */
export async function fillCpf(page: Page, cpf: string = VALID_CPF): Promise<void> {
  await page.getByTestId('buyer-cpf').fill(cpf);
}

/** Fill the card form the store's chain gave the buyer. */
export async function fillCard(page: Page, pan: string = GOOD_PAN): Promise<void> {
  await page.getByTestId('card-number').fill(pan);
  await page.getByTestId('card-holder').fill('ANA COMPRADORA');
  await page.getByTestId('card-expiry').fill('12/31');
  await page.getByTestId('card-cvv').fill('123');
}

/** Pick the card tile on a store that offers both, and wait for the form. */
export async function chooseCard(page: Page): Promise<void> {
  await page.getByTestId('checkout-method-CARD').click();
  await expect(page.getByTestId('card-view')).toBeVisible();
}

/** Press the pay bar and wait for the submit to have actually left. */
export async function payCard(page: Page): Promise<void> {
  await page.getByTestId('card-pay').click();
}

/** Walk the Dados step and land on Pagamento. */
export async function reachPayment(page: Page): Promise<void> {
  await fillCpf(page);
  await page.getByTestId('checkout-continue').click();
}
