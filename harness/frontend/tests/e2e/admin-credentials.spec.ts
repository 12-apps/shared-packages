import { expect, test } from '@playwright/test';

import { enabledToggle, expectWireOrder, openAdminCase, openProvider } from './helpers/admin';
import { openPage } from './helpers/checkout';

/**
 * The Credentials page: the schema-driven form end to end, over the fictional
 * cast (FUT-743, the merchant side).
 *
 * What is under test is the published form's money rules — the dirty gate, the
 * confirm-on-save dialog for the field that decides who gets paid, "saving IS
 * testing" (the probe that runs on save, environment included), write-only
 * secrets, per-environment credential sets, the enable gate (FUT-463), and the
 * walkthrough that advances on server truth plus the owner's word. Server
 * truth is read through the probe's `admin-*` facts; wire-order claims are
 * subsequences, never adjacency (the screen refetches on its own schedule).
 */

test('first save: dirty rule, pattern gate, read-back confirmation, and the probe that follows', async ({
  page,
}) => {
  await openPage(page, 'payments-provider-credentials');
  await openAdminCase(page, 'first-save');
  await openProvider(page, 'aurora');

  // Untouched form: nothing to commit. And the activation slot is WITHHELD
  // until the environment on screen holds every required credential.
  await expect(page.getByTestId('payments-save')).toBeDisabled();
  await expect(page.getByTestId('admin-verification-context')).toBeHidden();

  // A value failing the declared pattern keeps the button dead — shape is
  // checked before the owner is ever asked to vouch for a value.
  await page.getByLabel('Arroba da loja').fill('@ab');
  await expect(page.getByTestId('payments-save')).toBeDisabled();

  await page.getByLabel('Arroba da loja').fill('@loja-harness');
  await expect(page.getByTestId('payments-save')).toBeEnabled();

  // The confirm dialog reads the value back, verbatim. Cancelling writes
  // NOTHING — the wire has no PUT.
  await page.getByTestId('payments-save').click();
  await expect(page.getByTestId('payments-confirm-credential')).toBeVisible();
  await expect(page.getByTestId('payments-confirm-credential-value')).toHaveText('@loja-harness');
  await page.getByTestId('payments-confirm-credential-cancel').click();
  await expect(page.getByTestId('payments-confirm-credential')).toBeHidden();
  await expect(page.getByTestId('admin-wire-paths')).not.toContainText('PUT');

  // Confirming writes, then probes — a `GET /settings` lands between the two,
  // so the claim is a subsequence, never adjacency.
  await page.getByTestId('payments-save').click();
  await page.getByTestId('payments-confirm-credential-confirm').click();
  await expectWireOrder(page, [
    'PUT /settings/providers/aurora 200',
    'POST /settings/providers/aurora/verify 200',
  ]);
  await expect(page.getByTestId('admin-wire-paths')).toContainText('GET /settings 200');

  // The probe reached the adapter with the environment on screen, and the
  // verdict persisted for the active environment.
  await expect(page.getByTestId('admin-verify-calls')).toContainText('aurora:SANDBOX');
  await expect(page.getByTestId('admin-stored-aurora-SANDBOX')).toHaveText('handle');
  await expect(page.getByTestId('admin-status-aurora')).toHaveText('VERIFIED');
  await expect(page.getByTestId('payments-status')).toHaveText('CONEXÃO OK');
});

test('rotate: the collapsed summary, the no-op exemption, the replacement cost, the empty save', async ({
  page,
}) => {
  await openPage(page, 'payments-provider-credentials');
  await openAdminCase(page, 'rotate');
  await openProvider(page, 'aurora');

  // Step 1 — proven and collapsed: the summary row stands in for the fields,
  // and the activation context reads connected+proven, unblocked, shown.
  await expect(page.getByTestId('payments-credential-summary')).toBeVisible();
  await expect(page.getByLabel('Arroba da loja')).toBeHidden();
  await expect(page.getByTestId('admin-verification-context')).toHaveText(
    'aurora|Aurora Pagamentos|true|true|false|false',
  );

  // Reopening reveals the fields, with the warning about what a change costs
  // shown BEFORE anything is typed.
  await page.getByTestId('payments-credential-summary-edit').click();
  await expect(page.getByLabel('Arroba da loja')).toBeVisible();
  await expect(page.getByTestId('payments-reverify-warning')).toBeVisible();

  // Step 2 — re-saving the SAME handle (cleared then re-typed, so the change
  // event is unambiguous) is the no-op exemption: proof and enablement live.
  await page.getByLabel('Arroba da loja').fill('');
  await page.getByLabel('Arroba da loja').fill('@loja-harness');
  await page.getByTestId('payments-save').click();
  await expectWireOrder(page, [
    'PUT /settings/providers/aurora 200',
    'POST /settings/providers/aurora/verify 200',
  ]);
  await expect(page.getByTestId('admin-proof-aurora')).toHaveText('stamped');
  await expect(page.getByTestId('admin-enabled-aurora')).toHaveText('true');

  // Step 3 — a DIFFERENT handle drops the proof and switches the store off:
  // new keys may name a different account, and nothing about it is proven.
  await expect(page.getByTestId('payments-credential-summary')).toBeVisible();
  await page.getByTestId('payments-credential-summary-edit').click();
  await page.getByLabel('Arroba da loja').fill('@nova-loja');
  await page.getByTestId('payments-save').click();
  await page.getByTestId('payments-confirm-credential-confirm').click();
  await expect(page.getByTestId('admin-proof-aurora')).toHaveText('(none)');
  await expect(page.getByTestId('admin-enabled-aurora')).toHaveText('false');

  // Step 4 — saving with the field EMPTIED runs no probe: there is nothing to
  // test, and a store that entered nothing has not failed at anything.
  await expect(page.getByTestId('payments-credential-summary')).toBeVisible();
  await page.getByTestId('payments-credential-summary-edit').click();
  await page.getByLabel('Arroba da loja').fill('');
  await page.getByTestId('payments-save').click();
  await expect(page.getByTestId('payments-status')).toHaveText('NÃO VERIFICADO');
  // Three saves put three PUTs on the wire…
  await expectWireOrder(page, [
    'PUT /settings/providers/aurora 200',
    'PUT /settings/providers/aurora 200',
    'PUT /settings/providers/aurora 200',
  ]);
  // …and only the first two were followed by a probe. The adapter's own call
  // log is the "no probe ran" fact — exact, so a third probe cannot hide.
  await expect(page.getByTestId('admin-verify-calls')).toHaveText('aurora:SANDBOX,aurora:SANDBOX');
});

test('a proven provider can be paused and resumed without a new charge', async ({ page }) => {
  await openPage(page, 'payments-provider-credentials');
  await openAdminCase(page, 'rotate');
  await openProvider(page, 'aurora');

  // Enabled by seeding; the proof persists, so off→on needs no second charge.
  await expect(enabledToggle(page)).toBeChecked();
  await enabledToggle(page).click();
  await expectWireOrder(page, ['PUT /settings/providers/aurora/enabled 200']);
  await expect(page.getByTestId('admin-enabled-aurora')).toHaveText('false');
  await expect(page.getByTestId('admin-enabled')).toHaveText('(none)');

  await enabledToggle(page).click();
  await expect(page.getByTestId('admin-enabled-aurora')).toHaveText('true');
  await expect(page.getByTestId('admin-wire-bodies')).toContainText('{"enabled":true}');
  await expect(page.getByTestId('admin-enabled')).toHaveText('aurora');
});

test('masked secrets: write-only fields, preserve-on-blank, clear-on-empty', async ({ page }) => {
  await openPage(page, 'payments-provider-credentials');
  await openAdminCase(page, 'masked');
  await openProvider(page, 'boreal');

  // The two secret fields carry the masked hint as placeholder and the
  // keep-current helper; the stored value itself is never echoed back.
  await expect(page.getByPlaceholder(/••••/)).toHaveCount(2);
  await expect(page.getByText('deixe em branco')).toHaveCount(2);

  // Three required fields: nothing collapses to a summary row, and the button
  // keeps the plain verb — naming one of three would lie about the commit.
  await expect(page.getByTestId('payments-credential-summary')).toBeHidden();
  await expect(page.getByTestId('payments-save')).toHaveText('Salvar');

  // Connected but unproven, no guide: the context says exactly that.
  await expect(page.getByTestId('admin-verification-context')).toHaveText(
    'boreal|Boreal Pay|true|false|false|false',
  );

  // One new value, two blanks: blanks PRESERVE, so all three keys survive.
  await page.getByLabel('Chave de API').fill('chave-nova');
  await page.getByTestId('payments-save').click();
  await expectWireOrder(page, ['PUT /settings/providers/boreal 200']);
  await expect(page.getByTestId('admin-stored-boreal-SANDBOX')).toHaveText(
    'apiKey,apiSecret,merchantCode',
  );

  // An explicitly EMPTIED field clears exactly that key.
  await page.getByLabel('Código do lojista').fill('');
  await page.getByTestId('payments-save').click();
  await expect(page.getByTestId('admin-stored-boreal-SANDBOX')).toHaveText('apiKey,apiSecret');
});

test('environment tabs: separate credential sets, cleared drafts, and a probe that names its target', async ({
  page,
}) => {
  await openPage(page, 'payments-provider-credentials');
  await openAdminCase(page, 'environments');
  await openProvider(page, 'aurora');

  // SANDBOX is connected: the walkthrough is past step 1, and the stored
  // handle sits collapsed in its summary row.
  await expect(page.getByTestId('payments-setup-section-ativar-cobrancas')).toBeVisible();
  await expect(page.getByTestId('payments-credential-summary')).toBeVisible();

  // Type a draft on SANDBOX, then switch tabs: the draft and the last verdict
  // describe the OTHER environment, so both are retired.
  await page.getByTestId('payments-credential-summary-edit').click();
  await page.getByLabel('Arroba da loja').fill('@outra-loja');
  await page.getByTestId('payments-environment-PRODUCTION').click();
  await expect(page.getByTestId('payments-environment-notice-PRODUCTION')).toBeVisible();
  await expect(page.getByLabel('Arroba da loja')).toHaveValue('');
  await expect(page.getByTestId('payments-save')).toBeDisabled();
  // Nothing stored HERE: the guide falls back to its first section, whatever
  // the active environment has achieved.
  await expect(page.getByTestId('payments-setup-section-chave')).toBeVisible();

  // Saving on this tab names the environment in the body, and the probe that
  // follows names it in the adapter call.
  await page.getByLabel('Arroba da loja').fill('@loja-producao');
  await page.getByTestId('payments-save').click();
  await page.getByTestId('payments-confirm-credential-confirm').click();
  await expectWireOrder(page, [
    'PUT /settings/providers/aurora 200',
    'POST /settings/providers/aurora/verify 200',
  ]);
  await expect(page.getByTestId('admin-wire-bodies')).toContainText('"environment":"PRODUCTION"');
  await expect(page.getByTestId('admin-verify-calls')).toContainText('aurora:PRODUCTION');
  await expect(page.getByTestId('admin-status-aurora')).toHaveText('VERIFIED');
});

test('a failed probe shows the adapter sentence, offers no retry, and records FAILED', async ({
  page,
}) => {
  await openPage(page, 'payments-provider-credentials');
  await openAdminCase(page, 'probe-failed');
  await openProvider(page, 'boreal');

  await page.getByLabel('Código do lojista').fill('outro-lojista');
  await page.getByTestId('payments-save').click();

  // The ADAPTER's sentence, not a generic one — only it knows the provider's
  // own words. A rejection is a verdict, so no retry button.
  await expect(page.getByTestId('payments-probe-result')).toBeVisible();
  await expect(page.getByTestId('payments-probe-result')).toContainText(
    'Chave de API rejeitada pelo provedor.',
  );
  await expect(page.getByTestId('payments-verify-retry')).toBeHidden();
  await expect(page.getByTestId('admin-status-boreal')).toHaveText('FAILED');
});

test('an unreachable probe offers a retry and records nothing', async ({ page }) => {
  await openPage(page, 'payments-provider-credentials');
  await openAdminCase(page, 'probe-unreachable');
  await openProvider(page, 'boreal');

  await page.getByLabel('Código do lojista').fill('outro-lojista');
  await page.getByTestId('payments-save').click();

  // An outage is not a rejection: the retry is the one control that helps,
  // and the stored status stays what the save left it — learned nothing,
  // record nothing.
  await expect(page.getByTestId('payments-probe-result')).toBeVisible();
  await expect(page.getByTestId('payments-probe-result')).toContainText(
    'Não foi possível falar com o provedor.',
  );
  await expect(page.getByTestId('payments-verify-retry')).toBeVisible();
  await expect(page.getByTestId('admin-status-boreal')).toHaveText('UNVERIFIED');
});

test('a slow probe holds the verifying pulse until the adapter answers', async ({ page }) => {
  await openPage(page, 'payments-provider-credentials');
  await openAdminCase(page, 'probe-slow');
  await openProvider(page, 'boreal');

  await page.getByLabel('Código do lojista').fill('outro-lojista');
  await page.getByTestId('payments-save').click();

  await expect(page.getByTestId('payments-verifying')).toBeVisible();
  await page.getByTestId('admin-release-verify').click();
  await expect(page.getByTestId('payments-verifying')).toBeHidden();
  await expect(page.getByTestId('admin-status-boreal')).toHaveText('VERIFIED');
});

test('guided setup: the walkthrough advances on server truth and the owner word', async ({
  page,
}) => {
  await openPage(page, 'payments-provider-credentials');
  await openAdminCase(page, 'guided-setup');
  await openProvider(page, 'aurora');

  // Fresh store: step 1 is open, and it physically contains the field.
  await expect(page.getByTestId('payments-setup')).toBeVisible();
  await expect(page.getByTestId('payments-setup-guide')).toBeVisible();
  await expect(page.getByTestId('payments-setup-section-chave')).toBeVisible();

  await page.getByLabel('Arroba da loja').fill('@loja-harness');
  await page.getByTestId('payments-save').click();
  await page.getByTestId('payments-confirm-credential-confirm').click();

  // The guide was refetched AFTER the write and came back different, because
  // the host's setup context read the new row. Asserted on the RENDERED
  // stage; the wire subsequence corroborates, never a count.
  await expect(page.getByTestId('payments-setup-section-ativar-cobrancas')).toBeVisible();
  const section = page.getByTestId('payments-setup-section-ativar-cobrancas');
  await expect(section.getByTestId('payments-setup-warning')).toBeVisible();
  await expect(section.getByTestId('payments-setup-copy-reveal')).toBeVisible();
  await expectWireOrder(page, [
    'PUT /settings/providers/aurora 200',
    'GET /settings/guides/aurora 200',
  ]);

  // The open section carries the owner-confirmed step, so the activation
  // context is blocked AND hidden — the walkthrough still owns the screen.
  await expect(page.getByTestId('admin-verification-context')).toHaveText(
    'aurora|Aurora Pagamentos|true|false|true|true',
  );

  // Connected but never charged: the enable switch is locked with its reason
  // printed, not hidden in a tooltip (FUT-463).
  await expect(enabledToggle(page)).toBeDisabled();
  await expect(page.getByTestId('payments-enable-hint')).toContainText('depois dos 3 passos');

  // The owner's word collapses the step…
  await page.getByRole('button', { name: 'Já habilitei o Checkout Integrado' }).click();
  await expect(page.getByTestId('payments-setup-confirmed')).toBeVisible();
  await expect(page.getByTestId('payments-setup-section-ativar-cobrancas')).toBeHidden();
  await expect(page.getByTestId('admin-verification-context')).toHaveText(
    'aurora|Aurora Pagamentos|true|false|false|false',
  );

  // …and Revisar takes it back, blocking the activation step again.
  await page.getByTestId('payments-setup-confirmed-edit').click();
  await expect(page.getByTestId('payments-setup-section-ativar-cobrancas')).toBeVisible();
  await expect(page.getByTestId('admin-verification-context')).toHaveText(
    'aurora|Aurora Pagamentos|true|false|true|true',
  );
});

test('quota: the host refuses re-enabling, and only that', async ({ page }) => {
  await openPage(page, 'payments-provider-credentials');
  await openAdminCase(page, 'quota');
  await openProvider(page, 'boreal');

  // Switching OFF is never blocked — the owner can always stop selling.
  await expect(enabledToggle(page)).toBeChecked();
  await enabledToggle(page).click();
  await expectWireOrder(page, ['PUT /settings/providers/boreal/enabled 200']);
  await expect(page.getByTestId('admin-enabled-boreal')).toHaveText('false');
  await expect(enabledToggle(page)).not.toBeChecked();

  // Switching back ON is refused BEFORE any handler runs: the gate read the
  // intent AND the body, not just the path. Nothing else changed.
  await enabledToggle(page).click();
  await expect(page.getByTestId('admin-wire-paths')).toContainText(
    'PUT /settings/providers/boreal/enabled 403',
  );
  await expect(page.getByTestId('admin-enabled-boreal')).toHaveText('false');
  await expect(page.getByTestId('admin-status-boreal')).toHaveText('VERIFIED');
  await expect(enabledToggle(page)).not.toBeChecked();
  // No error UI is asserted, because there is none: a refused setEnabled is a
  // package defect this harness surfaces (unhandled rejection, no catch).
});
