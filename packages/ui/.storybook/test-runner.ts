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

/**
 * Poll `read()` until it stops changing for `quietMs`, or give up at
 * `timeoutMs` and return whatever it last read. A POSITIVE wait — for an
 * in-flight animation (the strip's own smooth `scrollTo`) to finish — belongs
 * here, polling, rather than behind one fixed delay plus a single sample:
 * FUT-2882 found that exact shape flakes under a loaded CI runner, because
 * the animation's real length is outside this file's control.
 */
async function waitForSettled(read: () => Promise<number>, timeoutMs = 5000, quietMs = 200): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let last = await read();
  let lastChangedAt = Date.now();
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop -- polling is sequential by nature: each read must follow the previous
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    // eslint-disable-next-line no-await-in-loop -- see above
    const current = await read();
    if (current !== last) {
      last = current;
      lastChangedAt = Date.now();
    } else if (Date.now() - lastChangedAt >= quietMs) {
      return last;
    }
  }
  return last;
}

/** Whether `chipTestId`'s element ends up fully inside `stripTestId`'s visible box, polled. */
async function waitForChipInside(page: Page, stripTestId: string, chipTestId: string): Promise<boolean> {
  return page
    .waitForFunction(
      ({ stripTestId: sid, chipTestId: cid }) => {
        const strip = document.querySelector(`[data-testid="${sid}"]`);
        const chip = document.querySelector(`[data-testid="${cid}"]`);
        if (!(strip instanceof HTMLElement) || !(chip instanceof HTMLElement)) return false;
        const stripBox = strip.getBoundingClientRect();
        const chipBox = chip.getBoundingClientRect();
        return chipBox.left >= stripBox.left - 1 && chipBox.right <= stripBox.right + 1;
      },
      { stripTestId, chipTestId },
      { timeout: 5000 },
    )
    .then(() => true)
    .catch(() => false);
}

/**
 * `mode: 'ArrowLeft'` half of {@link runTrustedKeydownRegression} (split out
 * for `max-lines-per-function`). Presses it several times (a real browser's
 * own per-press step is small — this file does not assume its exact size, so
 * one press might not clear measurement noise), then widens the content and
 * asserts the strip did NOT move again — widening would otherwise re-centre
 * it onto the open chip, exactly the latch this key must produce. Whether it
 * moved AGAIN is a NEGATIVE claim (no "it happened" state to poll for), so
 * this keeps one short, commented fixed wait; everything else here polls.
 */
async function runTrustedArrowLeftRegression(page: Page, strip: ReturnType<Page['getByTestId']>) {
  const stripScrollLeft = () => strip.evaluate((el) => el.scrollLeft);
  const before = await stripScrollLeft();
  for (let i = 0; i < 15; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- each press must land before the next; a real key repeat is sequential, not concurrent
    await page.keyboard.press('ArrowLeft');
  }
  const afterArrow = await waitForSettled(stripScrollLeft);
  assert.notEqual(afterArrow, before, 'FUT-2862: ArrowLeft did not move the strip at all — precondition failed');

  await page.getByTestId('resolve-profile').click();
  // NEGATIVE claim (the strip must NOT move again) — nothing to poll for, so
  // one short, generous, explained fixed wait: long enough for the re-centre
  // this content widening would otherwise cause to have started and moved
  // the strip at least once, if the latch had failed to hold.
  await page.waitForTimeout(800);
  const final = await stripScrollLeft();
  assert.equal(
    final,
    afterArrow,
    `FUT-2862: a TRUSTED ArrowLeft did not latch — the strip moved from ${afterArrow} to ${final} after the content widened`,
  );
}

/** One key, pressed once, asserted not to move `stripScrollLeft()` after a short settle (a NEGATIVE claim). */
async function assertKeyDoesNotScroll(
  page: Page,
  key: string,
  stripScrollLeft: () => Promise<number>,
  focusedWhat: string,
) {
  const before = await stripScrollLeft();
  await page.keyboard.press(key);
  await page.waitForTimeout(300);
  const after = await stripScrollLeft();
  assert.equal(after, before, `FUT-2862: '${key}' moved the strip (${focusedWhat}) — the allow-list assumes it never does`);
}

/**
 * `mode: 'NonScrollingKeys'` half of {@link runTrustedKeydownRegression}:
 * locks the allow-list's own premise. Presses `Home`, `End`, `PageUp` and
 * `PageDown` — verified live, in a throwaway Chromium probe, to have NO
 * default scroll action on this `overflowY: hidden` strip — first on a
 * focused chip, then (if it can even take focus — this strip carries no
 * `tabIndex`) on the strip itself, and asserts `scrollLeft` never moves. If a
 * future Chromium starts scrolling the inline axis on one of these keys,
 * this fails loudly instead of quietly re-breaking the fix's own premise.
 */
async function runTrustedNonScrollingKeysRegression(page: Page, strip: ReturnType<Page['getByTestId']>) {
  const stripScrollLeft = () => strip.evaluate((el) => el.scrollLeft);
  const nonScrollingKeys = ['Home', 'End', 'PageUp', 'PageDown'];
  for (const key of nonScrollingKeys) {
    // eslint-disable-next-line no-await-in-loop -- one key at a time, sequential by nature
    await assertKeyDoesNotScroll(page, key, stripScrollLeft, 'chip focused');
  }

  // This strip carries no `tabIndex` (`SettingsSectionChips.tsx`), so it is
  // not itself keyboard-focusable in today's markup — `.focus()` on it is a
  // no-op and `document.activeElement` stays the chip. Skip the strip-focus
  // half rather than assert against markup this file does not own; the
  // moment the strip DOES become focusable, this starts covering it too.
  const stripTookFocus = await strip.evaluate((el) => {
    el.focus();
    return document.activeElement === el;
  });
  if (!stripTookFocus) return;

  for (const key of nonScrollingKeys) {
    // eslint-disable-next-line no-await-in-loop -- one key at a time, sequential by nature
    await assertKeyDoesNotScroll(page, key, stripScrollLeft, 'strip itself focused');
  }
}

/**
 * FUT-2862: the SettingsLayout chip strip's visitor lock must arm only for a
 * key whose BROWSER DEFAULT ACTION actually scrolls the strip. A script
 * dispatch (`fireEvent`/`userEvent`, even inside a real browser) never has a
 * default action to begin with, so no `play` function can prove which keys
 * genuinely move it — only a real, OS-level key press through Chromium's own
 * input pipeline can. Driven here with `page.keyboard`, on the
 * `ChipStripKeepsKeyScrollARecentreRaced` fixture (`opensOn="hours"`,
 * `SettingsLayout.test.stories.tsx`): the strip settles on its own mount
 * re-centre first, then the story focuses the strip's first chip.
 *
 * `mode` is `parameters.trustedKeydownRegression` on the story: `'ArrowLeft'`
 * and `'NonScrollingKeys'` are handled by the two helpers above; anything
 * else (`'Tab'`) is pressed once (a focus change, no scroll) here, then the
 * content widens and this polls for the open ("hours") chip to land back in
 * view — proving the key armed nothing and the re-centre ran normally.
 */
const runTrustedKeydownRegression = async (page: Page, mode: string) => {
  const strip = page.getByTestId('settings-chips');
  const stripScrollLeft = () => strip.evaluate((el) => el.scrollLeft);

  // The strip's own mount re-centre starts, then runs to rest — both polled,
  // not sampled once after a fixed delay (FUT-2882).
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="settings-chips"]');
    return el instanceof HTMLElement && el.scrollLeft > 0;
  });
  await waitForSettled(stripScrollLeft);

  // Focus the first chip — same target the untrusted story dispatches its
  // keydown on (`strip.firstElementChild`) — so a real key's default action
  // has a scrollable ancestor (this strip) to apply to.
  await strip.locator(':scope > *').first().focus();

  if (mode === 'ArrowLeft') {
    await runTrustedArrowLeftRegression(page, strip);
    return;
  }
  if (mode === 'NonScrollingKeys') {
    await runTrustedNonScrollingKeysRegression(page, strip);
    return;
  }

  await page.keyboard.press(mode);
  await page.getByTestId('resolve-profile').click();
  const chipReCentred = await waitForChipInside(page, 'settings-chips', 'settings-chip-hours');
  assert.equal(
    chipReCentred,
    true,
    `FUT-2862: a TRUSTED '${mode}' false-latched the strip — it did not re-centre onto the open chip`,
  );
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
    if (storyContext.parameters?.trustedPointerRegression) {
      await runTrustedPointerNestedSelectRegression(page);
      return;
    }

    const trustedKeydownKey = storyContext.parameters?.trustedKeydownRegression;
    if (typeof trustedKeydownKey === 'string') {
      await runTrustedKeydownRegression(page, trustedKeydownKey);
    }
  },
};

export default config;
