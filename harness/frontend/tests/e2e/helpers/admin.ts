import { expect, type Locator, type Page } from '@playwright/test';

import { openCase } from './checkout';

/**
 * This app's merchant-settings gestures, and the wire-order assertion.
 *
 * The admin store's probe renders `admin-wire-paths` as a comma-joined list of
 * `"<METHOD> <path> <status>"` in request-INITIATION order, rebased against
 * the case's own baseUrl, with `-` for a status still in flight. The settings
 * screen refetches `GET /settings` and the open provider's guide on its own
 * schedule, so a wire claim is only ever CONTAINMENT or a SUBSEQUENCE — never
 * adjacency, never a count — and it must retry, because an entry's status is
 * stamped after the entry itself appears.
 */

/** Every entry of `wanted` appears in `actual`, in this relative order. */
export function containsInOrder(actual: readonly string[], wanted: readonly string[]): boolean {
  let matched = 0;
  for (const entry of actual) {
    if (matched < wanted.length && entry === wanted[matched]) matched += 1;
  }
  return matched === wanted.length;
}

/** Assert `wanted` is a subsequence of the wire log, retrying until it lands. */
export async function expectWireOrder(page: Page, wanted: readonly string[]): Promise<void> {
  await expect
    .poll(
      async () => {
        const raw = (await page.getByTestId('admin-wire-paths').textContent()) ?? '';
        return containsInOrder(raw.split(','), wanted);
      },
      { message: `admin-wire-paths should contain, in order: ${wanted.join(' -> ')}` },
    )
    .toBe(true);
}

/**
 * Select a case and wait out its seeding gate: the body renders
 * `admin-store-seeding` until the world is written, and the settings screen
 * appears only once its first `GET /settings` resolves — so this marker is the
 * earliest moment any other assertion is meaningful.
 */
export async function openAdminCase(page: Page, id: string): Promise<void> {
  await openCase(page, id);
  await expect(page.getByTestId('payments-provider-settings')).toBeVisible();
}

/** Open one provider's screen from the landing list. */
export async function openProvider(page: Page, name: string): Promise<void> {
  await page.getByTestId(`payments-provider-card-${name}`).click();
  await expect(page.getByTestId('payments-provider-back')).toBeVisible();
}

/**
 * The "Recebendo vendas" switch. The testid lands on MUI's Switch ROOT; the
 * element that carries `checked`/`disabled` is the checkbox input inside it
 * (the package's own unit test documents the same detour).
 */
export function enabledToggle(page: Page): Locator {
  return page.getByTestId('payments-enabled-toggle').getByRole('checkbox');
}
