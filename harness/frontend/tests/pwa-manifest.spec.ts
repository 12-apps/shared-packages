import { expect, test } from '@playwright/test';

/**
 * The manifest endpoint and the packaged worker, from a real browser (12-23).
 *
 * These two facts are the reason `@12-apps/pwa` grew a server half, and neither can
 * be established anywhere else:
 *
 *  - **one installable app per tenant.** The manifest is asked for as two
 *    different tenant domains on ONE deployment and answers two different
 *    documents. A static file could not; a bundle has one `index.html` for every
 *    tenant it serves.
 *  - **the worker is allowed to claim the root.** A worker's default scope is its
 *    script's own directory, and only the browser can say whether
 *    `Service-Worker-Allowed: /` was accepted. jsdom has no service worker, and a
 *    unit test asserting `register()` was called asserts the call, not the grant.
 */

const PAGE = '#/pwa-manifest';

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByTestId('pwa-manifest-page')).toBeVisible();
  await expect(page.getByTestId('pwa-manifest-probe')).toBeVisible();
});

test('one deployment answers a different app per tenant host', async ({ page }) => {
  await expect(page.getByTestId('manifest-a-name')).toHaveText('Loja da Ana Doces e Salgados');
  await expect(page.getByTestId('manifest-b-name')).toHaveText('Segunda Loja');

  // `id` is app IDENTITY to the browser: two ids is two installable apps, which is
  // the entire feature. One id would silently make them the same app.
  const idA = await page.getByTestId('manifest-a-id').textContent();
  const idB = await page.getByTestId('manifest-b-id').textContent();
  expect(idA).not.toBe(idB);
});

test('the document is the W3C shape, served as a manifest', async ({ page }) => {
  await expect(page.getByTestId('manifest-a-content-type')).toContainText(
    'application/manifest+json',
  );
  // Elided for a home screen, by the package rather than by each host.
  const shortName = (await page.getByTestId('manifest-a-short-name').textContent()) ?? '';
  expect(shortName.length).toBeGreaterThan(0);
  expect(shortName.length).toBeLessThanOrEqual(12);
});

test('a host the deployment does not serve gets a 404, not a default app', async ({ page }) => {
  // The 404 IS the gate — "installable" exists exactly where the host's own
  // domain rules say it does.
  await expect(page.getByTestId('manifest-unknown-status')).toHaveText('404');
});

test('the browser fetches the manifest linked from index.html', async ({ page }) => {
  // The real path: `<link rel="manifest">` at the SPA's own origin, answered by the
  // package's endpoint one hop away. A 404 here is an app the browser will not
  // offer to install at all.
  /* eslint-disable-next-line test-flakiness/no-unmocked-network --
     the unmocked network IS the subject: a mocked manifest would prove nothing
     about the endpoint that answers the browser. */
  const response = await page.request.get('/manifest.webmanifest');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/manifest+json');
});

test('the packaged worker registers and is granted the root scope', async ({ page }) => {
  await page.getByTestId('register-worker').click();

  await expect(page.getByTestId('worker-supported')).toHaveText('true');
  // Granted `/`, not `/sw.js`'s directory by accident — the header the package's
  // own route sets is what buys this, and only a browser can confirm it.
  await expect(page.getByTestId('worker-scope')).toHaveText('/');
  await expect(page.getByTestId('worker-error')).toHaveText('—');

  // Leave nothing claimed behind: a worker outliving its test would intercept the
  // next one's navigations.
  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  });
});
