import { expect, type Page } from '@playwright/test';

/**
 * This app's own checkout gestures (FUT-561).
 *
 * The buyer's gestures — typing a CPF, filling a card, pressing pay — ship with
 * `@12-apps/payments-e2e` and are re-exported below, because every one of them
 * drives a test id the payments components themselves render. They mean the
 * same thing in any consumer, so reimplementing them here would be a copy that
 * drifts.
 *
 * What is genuinely this app's is BELOW: how it routes to a checkout page and
 * how it selects one store among several. Those are the same two facts
 * `PaymentsWorld` exists to abstract, which is why they are the only things
 * left here.
 */
export {
  chooseCard,
  DECLINE_PAN,
  fillCard,
  fillCpf,
  GOOD_PAN,
  payCard,
  reachPayment,
  VALID_CPF,
} from '@12-apps/payments-e2e';

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
