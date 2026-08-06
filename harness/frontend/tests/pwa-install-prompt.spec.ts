import { expect, test, type Page } from '@playwright/test';

/**
 * The install prompt against the ordering that actually happens.
 *
 * A manifest and a service worker make a site installABLE. They do not make it
 * ask. Chromium announces its willingness by firing `beforeinstallprompt`
 * exactly once, during page load, and will not reissue it — so unless
 * something calls `preventDefault()` in that instant and keeps the handle, the
 * page can never install itself.
 *
 * The trap is that the listener is almost always too late. In a real app the
 * component that wants the event is behind a route, in a lazily-loaded chunk,
 * mounting long after the browser offered. Neither a jsdom test nor a
 * Storybook story can catch that: both dispatch the event at a component that
 * is already listening, which is the one sequence a browser never produces. A
 * suite full of them passes against a component that cannot work.
 *
 * These specs reproduce the real sequence using the harness's own routing —
 * fire the offer while a DIFFERENT page is mounted, then navigate to the one
 * that shows the prompt. That is precisely the storefront's menu → checkout
 * journey, run against the PUBLISHED tarball in a real Chromium.
 */

/** Somewhere that is not the install page, so nothing is listening yet. */
const ELSEWHERE = '#/payments-provider-settings';
const INSTALL_PAGE = '#/pwa-install-prompt';

/**
 * Chromium's event, which no test can make the browser emit for real: headless
 * Chrome does not run the install heuristics. The stand-in carries the same
 * shape and the same one-shot `prompt()`, which is all the page consumes.
 */
async function fireInstallOffer(page: Page): Promise<void> {
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, {
      platforms: ['web'],
      userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
      prompt: () => Promise.resolve(),
    });
    window.dispatchEvent(event);
  });
}

test('the host snippet is present, or nothing below can pass', async ({ page }) => {
  // Guards the wiring itself. If index.html loses the inline capture every
  // other spec here fails with a confusing "prompt not visible" instead of
  // naming the cause.
  await page.goto(INSTALL_PAGE);

  await expect(page.getByTestId('state-capture-present')).toHaveText('true');
});

test('an offer made before the component mounts still reaches it', async ({ page }) => {
  // THE regression. The offer arrives while the user is elsewhere — on the
  // menu, in the real app — and the prompt only mounts later, at checkout.
  await page.goto(ELSEWHERE);
  await expect(page.getByTestId('harness-page')).toHaveAttribute('data-page', 'payments-provider-settings');

  await fireInstallOffer(page);

  await page.goto(INSTALL_PAGE);

  await expect(page.getByTestId('state-event-held')).toHaveText('true');
  await expect(page.getByTestId('install-prompt')).toBeVisible();
  await expect(page.getByTestId('state-can-install')).toHaveText('true');
});

test('no offer means no prompt', async ({ page }) => {
  // The other half of the assertion above: the prompt must not appear merely
  // because the page was visited, or the first spec proves nothing.
  await page.goto(INSTALL_PAGE);

  await expect(page.getByTestId('state-event-held')).toHaveText('false');
  await expect(page.getByTestId('install-prompt')).toBeHidden();
});

test('an offer made while the component is mounted is adopted', async ({ page }) => {
  // A browser re-evaluating installability with the app already running. The
  // capture holds the event and announces it; the mounted hook adopts it.
  await page.goto(INSTALL_PAGE);
  await expect(page.getByTestId('install-prompt')).toBeHidden();

  await fireInstallOffer(page);

  await expect(page.getByTestId('install-prompt')).toBeVisible();
});

test('an app installed before the component mounts is offered nothing', async ({ page }) => {
  await page.goto(ELSEWHERE);
  await fireInstallOffer(page);
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));

  await page.goto(INSTALL_PAGE);

  await expect(page.getByTestId('state-is-installed')).toHaveText('true');
  await expect(page.getByTestId('install-prompt')).toBeHidden();
});

test('the adopted offer is a working handle, not a flag', async ({ page }) => {
  // Proves the captured event survives the handoff intact. A version that only
  // set a boolean would render this button and do nothing when pressed,
  // passing every visibility assertion above.
  //
  // Asserted through behaviour rather than a spy: the handle is single-use, so
  // the hook spends it and stops offering. That transition can ONLY happen if
  // `prompt()` and `userChoice` both resolved on a real event — with no handle
  // the click returns "unavailable" early and the affordance stays put.
  await page.goto(ELSEWHERE);
  await fireInstallOffer(page);
  await page.goto(INSTALL_PAGE);

  // Asserted on the component, NOT on the page's state panel: the panel is a
  // second, independent `usePwaInstall()` instance, and spending the handle in
  // one instance does not clear the other's ref.
  await expect(page.getByTestId('install-prompt')).toBeVisible();

  await page.getByTestId('install-prompt-install').click();

  await expect(page.getByTestId('install-prompt')).toBeHidden();
});
