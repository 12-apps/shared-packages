import { expect, test } from '@playwright/test';

import { enabledToggle, expectWireOrder, openAdminCase, openProvider } from './helpers/admin';
import { openPage } from './helpers/checkout';

/**
 * The Chain & policy page: priority reordering and the decline policy on the
 * LANDING LIST, plus the enable/rank refusal rules (FUT-463 / FUT-743).
 *
 * The reorder control always sends the RENDERED chain permuted — the `enabled`
 * set — so it can neither add a disabled provider nor omit an enabled one.
 * The two refusals `assertReorderOnly` exists for are therefore proven RAW at
 * the mount (`refusal-wire`), while the one refusal the component CAN surface
 * — a host refusing the intent outright — proves its optimistic rollback
 * (`refusal-ui`). The split is deliberate; do not try to reach the 409s
 * through the arrows.
 */

test('reordering sends the whole chain, and the server order is what renders', async ({
  page,
}) => {
  await openPage(page, 'payments-provider-chain');
  await openAdminCase(page, 'reorder');

  // Three enabled rows, the head marked on the first.
  await expect(page.getByTestId('payments-priority-list')).toBeVisible();
  await expect(page.getByTestId('payments-priority-item-aurora')).toBeVisible();
  await expect(page.getByTestId('payments-priority-item-boreal')).toBeVisible();
  await expect(page.getByTestId('payments-priority-item-cerrado')).toBeVisible();
  await expect(
    page.getByTestId('payments-priority-item-aurora').getByTestId('payments-priority-first'),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Mover Boreal Pay para cima' }).click();

  // The write is the WHOLE chain in its new order — one intent, not a delta.
  await expectWireOrder(page, ['PUT /settings/priorities 200']);
  await expect(page.getByTestId('admin-wire-bodies')).toContainText(
    '{"providers":["boreal","aurora","cerrado"]}',
  );

  // Server truth moved…
  await expect(page.getByTestId('admin-enabled')).toHaveText('boreal,aurora,cerrado');

  // …and the rendered rows agree with it: the SERVER's answer set the final
  // order, not the local guess. Array form = these rows, in this order.
  await expect(page.locator('[data-testid^="payments-priority-item-"]')).toContainText([
    'Boreal Pay',
    'Aurora Pagamentos',
    'Cerrado Pagamentos',
  ]);
  await expect(
    page.getByTestId('payments-priority-item-boreal').getByTestId('payments-priority-first'),
  ).toBeVisible();
});

test('the decline policy is its own explicit decision, with its consequence spelled out', async ({
  page,
}) => {
  await openPage(page, 'payments-provider-chain');
  await openAdminCase(page, 'policy');

  // Cascading a decline is opt-in, never inherited.
  await expect(page.getByTestId('admin-failover-policy')).toHaveText('TECHNICAL');

  await page.getByTestId('payments-decline-policy').getByRole('checkbox').click();

  await expectWireOrder(page, ['PUT /settings/failover-policy 200']);
  await expect(page.getByTestId('admin-wire-bodies')).toContainText(
    '{"policy":"TECHNICAL_AND_DECLINE"}',
  );
  await expect(page.getByTestId('admin-failover-policy')).toHaveText('TECHNICAL_AND_DECLINE');
  // The caption changed to name what the owner just agreed to.
  await expect(page.getByTestId('payments-decline-policy')).toContainText(
    'passa para o próximo da lista',
  );
});

test('the activation gate locks the switch until a charge landed — and only then', async ({
  page,
}) => {
  await openPage(page, 'payments-provider-chain');
  await openAdminCase(page, 'enable-gate');

  // An activation-charge provider that never charged: locked, with the reason
  // printed under the switch rather than hidden in a tooltip.
  await openProvider(page, 'aurora');
  await expect(enabledToggle(page)).toBeDisabled();
  await expect(page.getByTestId('payments-enable-hint')).toBeVisible();
  await expect(page.getByTestId('payments-enable-hint')).toContainText('depois dos 3 passos');

  await page.getByTestId('payments-provider-back').click();
  await expect(page.getByTestId('payments-provider-picker')).toBeVisible();

  // A provider without the requirement toggles freely once connected.
  await openProvider(page, 'boreal');
  await expect(enabledToggle(page)).toBeEnabled();
  await enabledToggle(page).click();
  await expectWireOrder(page, ['PUT /settings/providers/boreal/enabled 200']);
  await expect(page.getByTestId('admin-enabled-boreal')).toHaveText('true');
  await expect(page.getByTestId('admin-enabled')).toContainText('boreal');
});

test('a refused reorder rolls the list back to the server order', async ({ page }) => {
  await openPage(page, 'payments-provider-chain');
  await openAdminCase(page, 'refusal-ui');

  await expect(page.getByTestId('admin-enabled')).toHaveText('aurora,boreal,cerrado');

  await page.getByRole('button', { name: 'Mover Boreal Pay para cima' }).click();

  // The host refused the intent before any handler ran; the component's own
  // catch surfaces the refusal body and rolls the optimistic order back.
  await expectWireOrder(page, ['PUT /settings/priorities 409']);
  await expect(page.getByTestId('payments-priority-error')).toBeVisible();
  await expect(page.getByTestId('payments-priority-error')).toContainText('HarnessRefusal');
  await expect(page.locator('[data-testid^="payments-priority-item-"]')).toContainText([
    'Aurora Pagamentos',
    'Boreal Pay',
    'Cerrado Pagamentos',
  ]);
  // And the server never changed.
  await expect(page.getByTestId('admin-enabled')).toHaveText('aurora,boreal,cerrado');
});

test('the two reorder refusals the component can never send, issued raw at the mount', async ({
  page,
}) => {
  await openPage(page, 'payments-provider-chain');
  await openAdminCase(page, 'refusal-wire');

  await expect(page.getByTestId('admin-priorities-refusal')).toHaveText('(none)');
  await expect(page.getByTestId('admin-enabled')).toHaveText('aurora,boreal');

  // Listing a stored-but-DISABLED provider: reordering ranks, it cannot
  // enable — `assertRankable` refuses.
  await page.getByTestId('admin-rank-disabled').click();
  await expect(page.getByTestId('admin-priorities-refusal')).toHaveText('409 CredentialsError');

  // Omitting the enabled-but-unproven row — the grandfathered FUT-463 shape —
  // is irreversible from here, so `assertDroppable` refuses.
  await page.getByTestId('admin-drop-grandfathered').click();
  await expect(page.getByTestId('admin-priorities-refusal')).toHaveText(
    '409 IrreversibleChainRemovalError',
  );

  // Neither refusal changed anything. `payments-priority-error` is NOT
  // asserted here: the component made no call, so it has nothing to report.
  await expect(page.getByTestId('admin-enabled')).toHaveText('aurora,boreal');
});
