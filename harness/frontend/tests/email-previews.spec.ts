import { expect, test } from '@playwright/test';

/**
 * The e-mail preview console, driven the way an operator drives it — through
 * the published React surface, against the REAL catalogue served by
 * `harness/backend` over a proxied `/api`.
 *
 * That crossing is the point. The screen and the routes are two halves of one
 * package, and a spec that stubbed the fetch would prove each against its own
 * idea of the other. Here the document rendered in the frame is the document
 * the vendor would be handed, produced by the layout, carried over a socket
 * and put in front of a person — which is the only arrangement in which the
 * claim "a preview is honest" means anything.
 */

const PAGE = '#/email-previews';

test.beforeEach(async ({ page }) => {
  await page.goto(`/${PAGE}`);
  await expect(page.getByTestId('page-email-previews')).toBeVisible();
});

test('groups the catalogue by the owner that words each message', async ({ page }) => {
  // "Which parts of this system send mail" is a question most hosts cannot
  // otherwise answer at all, and the owner grouping IS that answer.
  await expect(page.getByTestId('email-preview-owner-@12-apps/auth')).toBeVisible();
  await expect(page.getByTestId('email-preview-row-account.verify')).toBeVisible();
  await expect(page.getByTestId('email-preview-row-account.reset')).toBeVisible();
});

test('renders the picked message into a sandboxed frame', async ({ page }) => {
  await page.getByTestId('email-preview-row-account.verify').click();
  const frame = page.getByTestId('email-preview-frame');
  await expect(frame).toBeVisible();

  // `srcdoc` + a sandbox: the preview is UNTRUSTED to the console. It is a
  // whole HTML document with its own styles, and rendering it inline would let
  // a mail restyle the screen around it.
  await expect(frame).toHaveAttribute('sandbox', /.*/);

  const body = frame.contentFrame().locator('body');
  // The HEADING, not the subject: the subject is the document's `<title>` and
  // its hidden preheader (the inbox-list line), neither of which a reader sees
  // in the body. The console shows the subject in its own row above the frame.
  await expect(body).toContainText('Falta um passo');
  // The host's brand, which the package may never supply for itself.
  await expect(body).toContainText('Harness Mail');
  // The bulletproof CTA, and the fallback line under it: a mail client that
  // drops the button must still leave the address reachable.
  await expect(body).toContainText('Confirmar');
  await expect(body).toContainText('https://harness.example/verify?t=abc');
});

test('shows the plain-text twin on its own tab', async ({ page }) => {
  await page.getByTestId('email-preview-row-account.verify').click();
  await expect(page.getByTestId('email-preview-frame')).toBeVisible();

  await page.getByTestId('email-preview-tabs').getByRole('button', { name: /text/i }).click();
  const view = page.getByTestId('email-preview-view');
  // The half that gets forgotten and that every major spam filter scores: a
  // `text/html` part with no `text/plain` twin. Rendered here so a person can
  // see it exists and reads correctly.
  await expect(view).toContainText('Confirme este endereço');
  await expect(view).not.toContainText('<table');
});

test('follows the language the operator picks, subject and all', async ({ page }) => {
  await page.getByTestId('email-preview-row-account.verify').click();
  await expect(page.getByTestId('email-preview-subject')).toContainText('Confirme seu e-mail');

  await page.getByTestId('email-preview-locale').getByRole('button', { name: 'en-US' }).click();
  await expect(page.getByTestId('email-preview-subject')).toContainText('Confirm your e-mail');
});

test('filters the list without losing the selection', async ({ page }) => {
  await page.getByTestId('email-preview-row-account.verify').click();
  await page.getByTestId('email-preview-filter').fill('reset');

  await expect(page.getByTestId('email-preview-row-account.reset')).toBeVisible();
  await expect(page.getByTestId('email-preview-row-account.verify')).toBeHidden();
  // The text stays put. It did not always: picking a row used to refetch the
  // catalogue, and the loader blanked the list while the request was in flight
  // — which unmounts the column and takes the filter with it. Fast locally,
  // visible on a slower connection, and this is the assertion that says so.
  await expect(page.getByTestId('email-preview-filter')).toHaveValue('reset');
  // The document stays on screen: filtering the CATALOGUE is not choosing a
  // different mail, and clearing the pane would make the filter feel like a
  // navigation.
  await expect(page.getByTestId('email-preview-frame')).toBeVisible();
});

test('says so when the source reports a gap, rather than looking complete', async ({ page }) => {
  // A catalogue that quietly omits a message looks exactly like a product that
  // does not send it. The backend's source declares `account.invite` missing.
  const coverage = page.getByTestId('email-preview-coverage');
  await expect(coverage).toBeVisible();
  await expect(coverage).toContainText('account.invite');
});

test('puts the selection in the URL, so one mail is a shareable link', async ({ page }) => {
  await page.getByTestId('email-preview-row-account.reset').click();
  await expect(page.getByTestId('email-preview-subject')).toContainText('Redefina sua senha');
  await expect(page).toHaveURL(/id=account\.reset/);
  // The hash survives the query patch — a host routing on `location.hash`
  // would otherwise be navigated off this screen by its own locale switch.
  await expect(page).toHaveURL(/#\/email-previews/);
});
