import { expect, test } from '@playwright/test';

import { expectWireOrder, openAdminCase, openProvider } from './helpers/admin';
import { openPage } from './helpers/checkout';

/**
 * The Connect (OAuth) page: prepare → provider → callback, over the fictional
 * cast (FUT-300 / FUT-683 / FUT-743).
 *
 * Everything below the address bar is the shipped code — the host's prepare
 * extension mints the CSRF state, the published client's `beginOAuth` asks the
 * mount, the adapter's authorize URL differs from the current URL only in its
 * FRAGMENT (so the hop never reloads and the in-page world survives), and the
 * host's callback route performs the state comparison before the published
 * `oauth.complete` writes the tokens. Simulated: the consent screen, the code
 * string, and the network hop — nothing about the connection's state.
 *
 * `payments-status` is deliberately NOT asserted on connected `cerrado`: a
 * connected OAuth provider that declares a credential schema reads
 * NÃO VERIFICADO (the masked view cannot see the token blob) — a package
 * defect this harness surfaces. The empty-schema provider is where the
 * correct branch is pinned.
 */

test('the shell keeps the slug when the hash carries a query', async ({ page }) => {
  // Pins the `main.tsx` contract the whole OAuth hop depends on: the slug is
  // the hash's PATH, and anything after `?` belongs to the page.
  await page.goto('#/payments-provider-connect?oauth=consent');
  await expect(page.getByTestId('harness-page')).toHaveAttribute(
    'data-page',
    'payments-provider-connect',
  );
  await expect(page.getByTestId('admin-oauth-consent')).toBeVisible();
});

test('the full round trip: prepare, begin, consent, callback, connected', async ({ page }) => {
  await openPage(page, 'payments-provider-connect');
  await openAdminCase(page, 'connect');
  await openProvider(page, 'cerrado');

  // Non-empty schema beside a connect button: the manual fallback renders,
  // collapsed — its form (and the save button inside it) stays hidden.
  await expect(page.getByTestId('payments-manual-fallback')).toBeVisible();
  await expect(page.getByTestId('payments-save')).toBeHidden();

  await page.getByRole('button', { name: 'Conectar com Cerrado Pagamentos' }).click();

  // The provider hop: a fragment-only navigation onto the consent panel.
  await expect(page.getByTestId('admin-oauth-consent')).toBeVisible();
  await expect(page).toHaveURL(/oauth=consent/);

  await page.getByTestId('admin-oauth-authorize').click();

  // Back on the settings page: the host's banner, and the PROVIDER SCREEN —
  // not the list — via the land-once `initialProvider` handover.
  await expect(page.getByTestId('payments-connect-success')).toBeVisible();
  await expect(page.getByTestId('payments-provider-back')).toBeVisible();
  await expect(page.getByTestId('payments-provider-picker')).toBeHidden();

  // The host erased the outcome query, so a reload cannot replay it.
  await expect(page).toHaveURL(/#\/payments-provider-connect$/);

  // WHICH account is connected: identity, scope chip, sealed environment.
  await expect(page.getByTestId('payments-connected-account')).toBeVisible();
  await expect(page.getByTestId('payments-connected-account')).toContainText(
    'Loja Harness (cerrado)',
  );
  await expect(page.getByTestId('payments-connected-account')).toContainText(
    'Consultar pagamentos',
  );
  await expect(page.getByTestId('payments-connected-environment')).toHaveText('Sandbox (testes)');

  // The trip's order, as a SUBSEQUENCE — `GET /settings` also lands between
  // begin and the callback, and the final one is the post-callback refetch.
  await expectWireOrder(page, [
    'POST /oauth/prepare/cerrado 200',
    'POST /settings/providers/cerrado/oauth/begin 200',
    'POST /oauth/callback/cerrado 200',
    'GET /settings 200',
  ]);

  // One state minted, the same one consumed — the CSRF comparison had real
  // material on both sides.
  await expect(page.getByTestId('admin-oauth-state')).toHaveText('st_1');
  await expect(page.getByTestId('admin-oauth-consumed')).toHaveText('st_1');

  // Server truth: the published service wrote the tokens and the identity
  // keys into the blob (the masked view never shows them; the store does).
  await expect(page.getByTestId('admin-status-cerrado')).toHaveText('VERIFIED');
  await expect(page.getByTestId('admin-stored-cerrado-SANDBOX')).toContainText(
    'accessToken,accountId,accountLabel',
  );
  await expect(page.getByTestId('admin-stored-cerrado-SANDBOX')).toContainText(
    'connectedAt,refreshToken,scope',
  );

  // The card badge is the connection fact the list reports.
  await page.getByTestId('payments-provider-back').click();
  await expect(page.getByTestId('payments-provider-badge-cerrado')).toHaveText('Conectado');

  // And the library's own `completeOAuth` route answers 404 on this mount —
  // the callback is a HOST route here, exclusion working.
  await page.getByTestId('admin-probe-complete').click();
  await expect(page.getByTestId('admin-probe-complete-status')).toHaveText('404');
});

test('an empty schema means no manual fallback — and the honest status branch', async ({
  page,
}) => {
  await openPage(page, 'payments-provider-connect');
  await openAdminCase(page, 'no-fallback');
  await openProvider(page, 'dunas');

  // Connect button present, accordion ABSENT — the schema-length false arm.
  await expect(page.getByRole('button', { name: 'Conectar com Dunas Digital' })).toBeVisible();
  await expect(page.getByTestId('payments-manual-fallback')).toBeHidden();

  // Connect it: with no schema to mask, `anyCredentialStored` short-circuits
  // and the chip reads the connection for what it is.
  await page.getByRole('button', { name: 'Conectar com Dunas Digital' }).click();
  await expect(page.getByTestId('admin-oauth-consent')).toBeVisible();
  await page.getByTestId('admin-oauth-authorize').click();
  await expect(page.getByTestId('payments-connect-success')).toBeVisible();
  await expect(page.getByTestId('payments-status')).toHaveText('CONEXÃO OK');
});

test('prepareConnect omitted: the info alert and the bare form, no button', async ({ page }) => {
  await openPage(page, 'payments-provider-connect');
  await openAdminCase(page, 'no-prepare');
  await openProvider(page, 'cerrado');

  // Same provider as the round trip; the ONLY variable is the prop the branch
  // keys on. Info alert + bare form; no connect button, no accordion.
  await expect(page.getByText('o botão de conexão não está disponível')).toBeVisible();
  await expect(page.getByTestId('payments-save')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Conectar com/ })).toBeHidden();
  await expect(page.getByTestId('payments-manual-fallback')).toBeHidden();
});

test('reconnect required: out of rotation while enabled, back in with one authorize', async ({
  page,
}) => {
  await openPage(page, 'payments-provider-connect');
  await openAdminCase(page, 'reconnect');

  // The FUT-683 shape, before anything is touched: the owner never switched
  // it off (`enabled` true), but the dead grant took it out of rotation — the
  // exact disagreement between the two probe facts.
  await expect(page.getByTestId('admin-status-cerrado')).toHaveText('RECONNECT_REQUIRED');
  await expect(page.getByTestId('admin-enabled-cerrado')).toHaveText('true');
  await expect(page.getByTestId('admin-rotation')).toHaveText('(none)');
  await expect(page.getByTestId('admin-active-provider')).toHaveText('(none)');

  await openProvider(page, 'cerrado');
  await expect(page.getByText('A autorização expirou ou foi revogada.')).toBeVisible();
  await expect(page.getByTestId('payments-expiry-warning')).toBeVisible();
  await expect(page.getByTestId('payments-expiry-warning')).toContainText(
    'A autorização expirou em',
  );

  // One authorize heals it: banner and warning gone, VERIFIED again, and the
  // provider re-enters rotation with NO toggle pressed.
  await page.getByRole('button', { name: 'Reconectar' }).click();
  await expect(page.getByTestId('admin-oauth-consent')).toBeVisible();
  await page.getByTestId('admin-oauth-authorize').click();
  await expect(page.getByTestId('payments-connect-success')).toBeVisible();

  await expect(page.getByText('A autorização expirou ou foi revogada.')).toBeHidden();
  await expect(page.getByTestId('payments-expiry-warning')).toBeHidden();
  await expect(page.getByTestId('admin-status-cerrado')).toHaveText('VERIFIED');
  await expect(page.getByTestId('admin-rotation')).toHaveText('cerrado');
  await expect(page.getByTestId('admin-enabled-cerrado')).toHaveText('true');
});

test('disconnect asks first, then clears tokens, status, proof and enablement', async ({
  page,
}) => {
  await openPage(page, 'payments-provider-connect');
  await openAdminCase(page, 'disconnect');
  await openProvider(page, 'cerrado');

  // Cancelling the confirmation writes nothing.
  await page.getByTestId('payments-disconnect').click();
  await expect(page.getByTestId('payments-disconnect-confirm')).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByTestId('payments-disconnect-confirm')).toBeHidden();
  await expect(page.getByTestId('admin-wire-paths')).not.toContainText('oauth/disconnect');

  // Confirming disconnects: every environment's blob emptied, status back to
  // UNVERIFIED, the charge proof dropped, the chain rank gone — and the
  // button offers to connect again.
  await page.getByTestId('payments-disconnect').click();
  await page.getByTestId('payments-disconnect-confirm-action').click();
  await expectWireOrder(page, ['POST /settings/providers/cerrado/oauth/disconnect 200']);
  await expect(page.getByTestId('admin-stored-cerrado-SANDBOX')).toHaveText('(none)');
  await expect(page.getByTestId('admin-status-cerrado')).toHaveText('UNVERIFIED');
  await expect(page.getByTestId('admin-proof-cerrado')).toHaveText('(none)');
  await expect(page.getByTestId('admin-enabled-cerrado')).toHaveText('false');
  await expect(page.getByRole('button', { name: 'Conectar com Cerrado Pagamentos' })).toBeVisible();
});

test('a failing revoke is reported, and the disconnect still lands locally', async ({ page }) => {
  await openPage(page, 'payments-provider-connect');
  await openAdminCase(page, 'revoke-fails');
  await openProvider(page, 'dunas');

  await page.getByTestId('payments-disconnect').click();
  await page.getByTestId('payments-disconnect-confirm-action').click();

  // The provider never answered the revocation — the failure lands in the
  // reporter sink, visibly, and the merchant is NOT stranded: local cleanup
  // happened anyway.
  await expect(page.getByTestId('admin-revoke-failures')).toHaveText('dunas');
  await expect(page.getByTestId('admin-stored-dunas-SANDBOX')).toHaveText('(none)');
});

test('an expiring grant warns before it lapses', async ({ page }) => {
  await openPage(page, 'payments-provider-connect');
  await openAdminCase(page, 'expiring');
  await openProvider(page, 'cerrado');

  // The NEAR caption — "expira em", not "expirou em": renewal has been
  // failing quietly, and this line is the only warning before checkout
  // starts refusing.
  await expect(page.getByTestId('payments-expiry-warning')).toBeVisible();
  await expect(page.getByTestId('payments-expiry-warning')).toContainText(
    'A autorização expira em',
  );
});

test('no platform app registered: begin refuses with the package 409', async ({ page }) => {
  await openPage(page, 'payments-provider-connect');
  await openAdminCase(page, 'unregistered-app');
  await openProvider(page, 'cerrado');

  await page.getByRole('button', { name: 'Conectar com Cerrado Pagamentos' }).click();

  // The prepare succeeded — the refusal is the PACKAGE's, on `beginOAuth`.
  //
  // What the owner reads is no longer the wire envelope. It used to be:
  // `{"error":"CredentialsError","message":"No platform OAuth application
  // credentials configured for cerrado/SANDBOX"}`, in a red box under the
  // connect button, as the entire explanation of why nothing happened. An error
  // class name is not the store owner's problem, and this particular refusal is
  // not a fault they caused OR a dead end — the credentials path works and is
  // on the same screen, so it says that instead.
  const failure = page.getByTestId('payments-connect-failure');
  await expect(failure).toBeVisible();
  await expect(failure).toContainText('credenciais manualmente');
  await expect(failure).not.toContainText('CredentialsError');
  await expectWireOrder(page, [
    'POST /oauth/prepare/cerrado 200',
    'POST /settings/providers/cerrado/oauth/begin 409',
  ]);
});

test('consent denied: no code is ever spent, and no callback is made', async ({ page }) => {
  await openPage(page, 'payments-provider-connect');
  await openAdminCase(page, 'refusals');
  await openProvider(page, 'cerrado');

  await page.getByRole('button', { name: 'Conectar com Cerrado Pagamentos' }).click();
  await expect(page.getByTestId('admin-oauth-consent')).toBeVisible();
  await page.getByTestId('admin-oauth-deny').click();

  // The provider refused: there is no code, so the host calls NOTHING.
  await expect(page.getByTestId('payments-connect-error')).toBeVisible();
  await expect(page.getByTestId('payments-connect-error')).toContainText('access_denied');
  await expect(page.getByTestId('admin-wire-paths')).not.toContainText('/oauth/callback');
  await expect(page.getByTestId('admin-status-cerrado')).toHaveText('(none)');
});

test('a tampered state is refused by the host before any code is spent', async ({ page }) => {
  await openPage(page, 'payments-provider-connect');
  await openAdminCase(page, 'refusals');
  await openProvider(page, 'cerrado');

  await page.getByRole('button', { name: 'Conectar com Cerrado Pagamentos' }).click();
  await expect(page.getByTestId('admin-oauth-consent')).toBeVisible();
  await page.getByTestId('admin-oauth-tamper').click();

  // A state the world did not mint: 403 from the host's CSRF comparison —
  // the entire reason the callback is a host route and not `completeOAuth`.
  await expect(page.getByTestId('payments-connect-error')).toBeVisible();
  await expect(page.getByTestId('payments-connect-error')).toContainText('InvalidState');
  await expectWireOrder(page, ['POST /oauth/callback/cerrado 403']);
  await expect(page.getByTestId('admin-oauth-consumed')).toHaveText('harness-forged');
  await expect(page.getByTestId('admin-stored-cerrado-SANDBOX')).toHaveText('(none)');
  await expect(page.getByTestId('admin-status-cerrado')).toHaveText('(none)');
});

test('a refused code maps to 502 through the host guard', async ({ page }) => {
  await openPage(page, 'payments-provider-connect');
  await openAdminCase(page, 'refusals');
  await openProvider(page, 'cerrado');

  await page.getByRole('button', { name: 'Conectar com Cerrado Pagamentos' }).click();
  await expect(page.getByTestId('admin-oauth-consent')).toBeVisible();
  await page.getByTestId('admin-oauth-refuse').click();

  // The adapter's exchange threw a ProviderRequestError; the host's own error
  // mapping (extensions get none for free) turns it into the same 502 the
  // package's `errorStatus` would.
  await expect(page.getByTestId('payments-connect-error')).toBeVisible();
  await expect(page.getByTestId('payments-connect-error')).toContainText('ProviderRequestError');
  await expectWireOrder(page, ['POST /oauth/callback/cerrado 502']);
  await expect(page.getByTestId('admin-status-cerrado')).toHaveText('(none)');
});
