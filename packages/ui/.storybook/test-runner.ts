import assert from 'node:assert/strict';

import { getStoryContext } from '@storybook/test-runner';
import type { TestRunnerConfig } from '@storybook/test-runner';
import type { Page } from 'playwright';

/**
 * A real, OS-level "trusted" click at an element's centre — via
 * `page.mouse`, exactly like the FUT-2776 adversarial probe that measured
 * this bug, not `locator.click()` (which is equivalent under the hood, but
 * this spells out the exact mechanism the bug depends on: a click a script
 * dispatches, even from inside a real browser, is NOT trusted, and cannot
 * reproduce it).
 */
const trustedClick = async (page: Page, testId: string) => {
  const box = await page.getByTestId(testId).boundingBox();
  assert.ok(box, `trustedClick: no bounding box for [data-testid="${testId}"]`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
};

/**
 * FUT-2776, third review: the production bug — a real user picking an
 * option in the card's own nested `Select` closes the card — only shows
 * under TRUSTED pointer input. Chromium runs a microtask queued by a
 * capture-phase `document` listener BEFORE the rest of that same capture
 * dispatch when the event is trusted, so a microtask-based deferral in
 * `useClickAway` read `useCardOwnership`'s marker before it was set; a
 * script-dispatched event (`fireEvent`, `userEvent`, even from inside a real
 * browser's `play` function) always finishes the WHOLE dispatch — marker
 * included — before any microtask runs, so no unit test or `play`-driven
 * story interaction can exercise this at all. Driven from here, with
 * `page.mouse`, instead of from a `play` function. See
 * `HoverCard.test.stories.tsx`'s `TrustedPointerNestedSelectClickAway`,
 * whose `parameters.trustedPointerRegression` selects it below; every other
 * story is untouched by this hook.
 */
const runTrustedPointerNestedSelectRegression = async (page: Page) => {
  const trigger = page.getByTestId('hover-card-trigger');
  await trigger.hover();

  const content = page.locator('body').getByText('Preferências');
  await content.waitFor({ state: 'visible', timeout: 2000 });

  await trustedClick(page, 'trusted-nested-select');
  const option = page.getByTestId('trusted-nested-select-option-b');
  await option.waitFor({ state: 'visible', timeout: 2000 });
  await trustedClick(page, 'trusted-nested-select-option-b');

  // Give useClickAway's deferred close its turn (a macrotask under the fix,
  // a microtask under the regression) and the Select's own menu-close
  // animation a moment to settle before asserting either way.
  await page.waitForTimeout(300);
  assert.equal(
    await content.isVisible(),
    true,
    'FUT-2776: a TRUSTED press on the card\'s own nested Select option closed the card — ' +
      'the ownership marker was read before useCardOwnership had set it',
  );

  // The Select's own menu is ALSO part of the card's React tree (that is the
  // whole point of the fix), so its exit transition — including its own
  // invisible backdrop — is still "inside" until it is actually gone. A
  // press that lands on that lingering backdrop is correctly attributed to
  // the card, not to whatever is underneath it; waiting for the listbox to
  // fully detach keeps the NEXT click aimed unambiguously at the outside
  // button, rather than racing the Select's own close animation.
  await page.waitForSelector('[role="listbox"]', { state: 'detached', timeout: 2000 });

  // Closing is the thing that SHOULD happen here, so wait for it rather than
  // sampling once after a fixed delay: the deferred close decision plus the
  // card's own exit transition outran 300ms on a loaded CI runner (FUT-2882).
  await trustedClick(page, 'trusted-nested-outside');
  const closed = await content
    .waitFor({ state: 'hidden', timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  assert.equal(closed, true, 'a TRUSTED press truly outside the card must still close it');
};

// CodeEditor's Monaco now loads from this package's own `monaco-editor`
// dependency, bundled by whatever Vite entry calls `configureCodeEditor`
// (`.storybook/preview.tsx`, and any host — see CodeEditor.md), instead of
// `@monaco-editor/react`'s default CDN loader (FUT-2697). Aborting the CDN
// host here is the proof: a story that still depended on it would time out
// waiting for `.monaco-editor` to mount, rather than pass by accident on a
// runner that happens to reach the network.
const config: TestRunnerConfig = {
  async preVisit(page) {
    await page.route('**/cdn.jsdelivr.net/**', (route) => route.abort());

    // FUT-2774: LazyImage's `.test.stories.tsx` probes two real-browser sizing
    // claims. `always-errors` aborts at once, so the <img> fires `error` on the
    // first frame with nothing to wait on. `never-resolves` is intercepted and
    // never told to `abort`/`continue`/`fulfill`, so the request stays pending
    // for the run's whole life — `isLoading` never flips, and the loading
    // indicator (what's under test) stays up deterministically instead of
    // racing the real network.
    await page.route('https://lazyimage-fut2774.invalid/always-errors.png', (route) => route.abort());
    await page.route('https://lazyimage-fut2774.invalid/never-resolves.png', () => {
      // Intentionally does not resolve the route.
    });

    // FUT-2805 follow-up: one retry-transition story needs a request that
    // fails the FIRST time and succeeds on the cache-busted retry
    // (`?retry=N`, `useLazyImage`'s own convention) — `always-errors` always
    // fails and `never-resolves` never settles, so neither can stand in for
    // "goes from error to loaded". A tiny inline PNG, not a real fetch: real
    // networking is exactly what every other route here exists to avoid.
    const TINY_PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAHgAAABQCAIAAABd+SbeAAAAg0lEQVR42u3QQQ0AAAgEoOtkScMZyhbOBxsJSPVwIApEi0a0aNEWRItGtGjRFkSLRrRo0YgWjWjRohEtGtGiRSNaNKJFi0a0aESLFo1o0YgWLRrRohEtWjSiRSNatGhEi0a0aNGIFo1o0aIRLRrRokUjWjSiRYtGtGhEixaNaNGI/mMBAXhJ2KHxSr8AAAAASUVORK5CYII=',
      'base64',
    );
    await page.route('https://lazyimage-fut2805.invalid/fails-then-loads.png*', (route) => {
      const isRetry = route.request().url().includes('retry=');
      if (isRetry) {
        route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG });
      } else {
        route.abort();
      }
    });
  },

  async postVisit(page, context) {
    const storyContext = await getStoryContext(page, context);
    if (!storyContext.parameters?.trustedPointerRegression) return;

    await runTrustedPointerNestedSelectRegression(page);
  },
};

export default config;
