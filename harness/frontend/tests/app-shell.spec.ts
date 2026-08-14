import { expect, test, type Page } from '@playwright/test';

/**
 * `@12-apps/app-shell` from a real browser, against a real mount (12-18).
 *
 * Everything here is a claim the package's own jsdom suite cannot make, because each of
 * them is about the BUILT, PUBLISHED artefact:
 *
 *  - **the two halves agree.** The gate builds its URLs from the same constants the
 *    descriptors declare, but they are two tarballs meeting over a socket. The consent
 *    round trip below crosses Vite's proxy into the package's own Hono router, so a
 *    path or an envelope that drifted fails here rather than in a host's production.
 *  - **the theme resolves against the published design system.** `createAppTheme` runs
 *    inside the bundle, against the installed `@12-apps/ui`, so the legibility
 *    correction is observed rather than asserted against a hex.
 *  - **the boundary catches a real render crash and REPORTS it.** `window.onerror`
 *    never sees one, so this is the failure mode that blanks a screen; an empty `#root`
 *    is what a broken boundary looks like, and only a browser can tell them apart.
 *  - **`lazyRoute` still loads a chunk a bundler emitted.** The unit suite drives the
 *    failure path against a rejected promise. Whether a real `import()` inside the
 *    published factory produces and renders a real chunk is a fact about a build.
 */

const PAGE = '#/app-shell';

/** The suite's control plane — deliberately not under `/api`. */
async function control(page: Page, path: string, body: unknown): Promise<void> {
  /* eslint-disable-next-line test-flakiness/no-unmocked-network -- driving the real
     backend is the point of this harness: these are the suite's own controls on the
     server the browser is talking to, and mocking them would leave nothing under test. */
  const response = await page.request.post(`/__harness/app-shell/${path}`, { data: body });
  expect(response.ok()).toBe(true);
}

async function reset(page: Page): Promise<void> {
  /* eslint-disable-next-line test-flakiness/no-unmocked-network -- see `control`. */
  const response = await page.request.post('/__harness/reset');
  expect(response.ok()).toBe(true);
}

/**
 * Act as one of the seeded users. The cookie is the only identity a browser has, and the
 * page seeds it only when absent — so setting it here before navigating is what picks a
 * vantage.
 */
async function actAs(page: Page, userId: string): Promise<void> {
  await page
    .context()
    .addCookies([{ name: 'harness-consent', value: userId, url: new URL(page.url()).origin }]);
}

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await reset(page);
  // `reload`, never a second `goto(PAGE)`. The URL is already `#/app-shell`, so an
  // identical `goto` is a same-DOCUMENT hash navigation: nothing re-evaluates, no
  // module re-runs and no mount-time fetch re-fires. A case relying on it would assert
  // against the state of the load BEFORE the one it set up.
  await page.reload();
  await expect(page.getByTestId('harness-page')).toHaveAttribute('data-page', 'app-shell');
});

test('the provider tower mounts: session, brand and the host query client', async ({ page }) => {
  // `unauthenticated` rather than `loading`: the provider resolved. This harness has no
  // auth surface, so a signed-out app is the honest state — and it is still the claim
  // that `useSession` resolved at all, which it cannot do outside its provider.
  await expect(page.getByTestId('session-status')).toHaveText('unauthenticated');
  await expect(page.getByTestId('brand-name')).toHaveText('Ferragens Norte');
});

test('a tenant colour nobody can read comes back legible, hue intact', async ({ page }) => {
  const main = await page.getByTestId('palette-main').textContent();
  const light = await page.getByTestId('palette-light').textContent();

  // The exact swatch is kept for decoration…
  expect(light).toBe('#7ED957');
  // …and `main` — the token every component reaches for — is not it.
  expect(main).not.toBe('#7ED957');

  // Still green: the hue is the brand and is never touched. Compared as channels
  // rather than as a hex, because the guarantee is "same colour, darker" and not
  // "this tone".
  const [r, g, b] = channelsOf(main ?? '');
  expect(g).toBeGreaterThan(r);
  expect(g).toBeGreaterThan(b);

  // A seed that only set `primary` leaves the platform secondary alone.
  await expect(page.getByTestId('palette-secondary')).toHaveText('#8B5CF6');
  // And the four meanings are anchored, never derived from the tenant.
  await expect(page.getByTestId('palette-error')).toHaveText('#d32f2f');
});

test('the framework-free formatters ship and run in the browser', async ({ page }) => {
  // A regular space, not the narrow no-break one `Intl` emits — so a label formatted
  // here and one pre-formatted by a backend cannot differ by an invisible character.
  await expect(page.getByTestId('format-money')).toHaveText('R$ 1.234,56');
  await expect(page.getByTestId('format-minutes')).toHaveText('11 min');
  await expect(page.getByTestId('format-minutes-unset')).toHaveText('null');
});

test('lazyRoute loads a chunk the bundler emitted', async ({ page }) => {
  await expect(page.getByTestId('lazy-loaded')).toBeVisible();
});

test('a crashed page renders the error state and reports the crash', async ({ page }) => {
  await expect(page.getByTestId('crash-idle')).toBeVisible();
  await expect(page.getByTestId('crash-count')).toHaveText('0');

  await page.getByTestId('crash-now').click();

  // Not a blank screen: the fallback the shell configured, carrying the error's own
  // message rather than a generic apology.
  await expect(page.getByTestId('route-error')).toBeVisible();
  await expect(page.getByTestId('route-error')).toContainText('a página explodiu');
  // …and it left the browser through the HOST's reporter, which is the half
  // `window.onerror` cannot supply.
  await expect(page.getByTestId('crash-count')).toHaveText('1');
  // The chrome above it is still there — a crashed page stayed a crashed page.
  await expect(page.getByTestId('session-status')).toBeVisible();
});

test('a caller who never accepted anything is asked, and accepting clears it', async ({ page }) => {
  await actAs(page, 'novo');
  await page.reload();

  const dialog = page.getByTestId('terms-consent-dialog');
  await expect(dialog).toBeVisible();
  // Says WHY. The failure this replaces stopped the user without telling them anything
  // they could act on.
  await expect(dialog).toContainText('Sua conta segue ativa');

  await page.getByTestId('terms-consent-accept').click();
  await expect(dialog).toBeHidden();

  // It stays cleared across a reload, which is the difference between a dismissed
  // dialog and a recorded acceptance.
  await page.reload();
  await expect(page.getByTestId('session-status')).toBeVisible();
  await expect(page.getByTestId('terms-consent-dialog')).toBeHidden();
});

test('a caller who is up to date is never asked', async ({ page }) => {
  await expect(page.getByTestId('session-status')).toBeVisible();
  await expect(page.getByTestId('terms-consent-dialog')).toBeHidden();
});

/**
 * THE production failure. A version bump ships as a deploy: the user stays signed in,
 * avatar and cart intact, and before this surface existed the first thing they heard was
 * a bare `401` at the payment step with a retry that could never succeed.
 *
 * The tab here is ALREADY OPEN when the bump lands, which is the case the mount-time
 * fetch cannot cover — so this is also the accelerator's proof: the hint carries no
 * consent state, the gate re-ASKS, and the server's answer is the only thing that
 * decides.
 */
test('a bump reaches a tab that is already open, through the signal seam', async ({ page }) => {
  await expect(page.getByTestId('terms-consent-dialog')).toBeHidden();

  await control(page, 'bump', { version: '2026-12-01' });
  // Still nothing: a bump alone changes no browser state, which is exactly the bug.
  await expect(page.getByTestId('terms-consent-dialog')).toBeHidden();

  await page.getByTestId('consent-signal').click();
  await expect(page.getByTestId('consent-signal-count')).toHaveText('1');

  await expect(page.getByTestId('terms-consent-dialog')).toBeVisible();

  await page.getByTestId('terms-consent-accept').click();
  await expect(page.getByTestId('terms-consent-dialog')).toBeHidden();
});

/**
 * A 204 over a failed write would tell the user they accepted while every guard keeps
 * refusing them — the original dead end, one level deeper, and this time with the prompt
 * cleared so nothing would ever ask again. So the endpoint answers 500 and the gate
 * keeps asking.
 */
test('the prompt stays when the server could not record the acceptance', async ({ page }) => {
  await actAs(page, 'novo');
  await page.reload();
  await expect(page.getByTestId('terms-consent-dialog')).toBeVisible();

  await control(page, 'fail-writes', { fails: true });
  await page.getByTestId('terms-consent-accept').click();

  await expect(page.getByTestId('terms-consent-dialog')).toBeVisible();
  await expect(page.getByTestId('terms-consent-accept')).toBeEnabled();
});

/** `#RRGGBB` → channels, so "still green" is a comparison and not a pinned hex. */
function channelsOf(hex: string): [number, number, number] {
  const at = (index: number): number => Number.parseInt(hex.slice(index, index + 2), 16);
  return [at(1), at(3), at(5)];
}
