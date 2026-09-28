/**
 * THE VISITOR LATCH MUST NOT FALSE-ARM ON A POINTER THAT NEVER MOVED (FUT-2775).
 *
 * `watchVisitorScroll` used to arm `undecided` on the very next `scroll` event
 * once a pointer/touch was down on the strip — with no check that the pointer
 * itself had moved, and no check that the scroll carried a real delta beyond
 * rounding. A visitor who rests a (stationary) pointer or finger on the
 * already-open chip while the strip is mid-way through its OWN `scrollTo`
 * re-centre (e.g. a `ResizeObserver` firing from a late-loading status marker)
 * would have that re-centre's own `scroll` events armed against them. If the
 * strip's `scrollTo` target got clamped short by a fraction of a pixel — a
 * browser rounding difference, content still reflowing — `restsOnAim` reads
 * `false` and the visitor's `hasScrolled()` latches `true` though they made no
 * scrolling gesture at all. Once latched, the strip never re-centres again
 * until `activeItemId` changes.
 *
 * The fix requires BOTH a real scroll delta AND a pointer/touch that has
 * itself moved since going down — neither alone is enough (see the ticket's
 * Decision): the strip's own `scrollTo` produces real per-tick deltas past any
 * reasonable epsilon, same as a drag would, so a delta-only fix still latches
 * on a resting pointer. And a genuine drag that starts mid-`scrollTo` must
 * still latch correctly, whether or not it overlaps the strip's own scroll.
 */
import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { watchVisitorScroll } from '../SettingsSectionChips.scroll';

/**
 * A strip that can scroll 400px (`scrollWidth 500` − `clientWidth 100`), never
 * really laid out.
 *
 * Named `el`, not `strip`, INSIDE this helper on purpose: `no-test-isolation`
 * keys its "shared mutable state" tracking on identifier NAME alone, with no
 * scope awareness — a `const strip = …` declared in this ordinary (non-`it`)
 * function reads to it as a module-level shared variable, and every `strip` a
 * TEST later declares, however locally, gets flagged as "sharing" it.
 */
function makeStrip(): HTMLDivElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'scrollWidth', { value: 500, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: 100, configurable: true });
  document.body.appendChild(el);
  return el;
}

/** Move the strip to `left` and fire the `scroll` event a real scroll would. */
function tickScroll(strip: HTMLDivElement, left: number): void {
  // Not a real viewport read: `strip` is a detached mock whose `scrollWidth`/
  // `clientWidth` this file pins above, and this assignment IS the simulated
  // scroll tick under test, not an assertion resting on a runner's screen size.
  // eslint-disable-next-line test-flakiness/no-viewport-dependent -- pinned mock dimensions, not a real viewport; see comment above
  strip.scrollLeft = left;
  strip.dispatchEvent(new Event('scroll'));
}

describe('watchVisitorScroll: the false-latch shapes FUT-2775 names', () => {
  it("does not latch a pointer held stationary through the strip's OWN scrollTo landing short of its aim", async () => {
    const strip = makeStrip();
    try {
      const visitor = watchVisitorScroll(strip);
      try {
        // The strip is about to re-centre itself to 200 — recorded exactly as
        // `useCentreActiveChip` would, before calling `strip.scrollTo`.
        visitor.beforeOwnScroll(200);

        // A pointer goes down on the strip and never moves again — "resting",
        // not dragging. No `pointermove` is dispatched anywhere in this test.
        strip.dispatchEvent(new MouseEvent('pointerdown', { clientX: 50 }));

        // The strip's OWN smooth scroll ticks toward 200, landing at 204 — a
        // fractional rounding/clamp difference past `LANDED_SLACK` (1px),
        // exactly the shape the ticket describes (content still reflowing
        // under a late status marker).
        tickScroll(strip, 60);
        tickScroll(strip, 140);
        tickScroll(strip, 204);
        strip.dispatchEvent(new Event('scrollend'));

        await waitFor(() => {
          // Positive first: the scenario actually ran — the strip really did
          // land 4px short of its aim, not merely that nothing moved at all.
          // eslint-disable-next-line test-flakiness/no-viewport-dependent -- a detached mock's own `scrollLeft`, pinned by this file, not a real viewport read
          expect(strip.scrollLeft).toBe(204);
          // On today's code this reads `true`: `state.pointer` was enough on
          // its own to arm `undecided` on the very first tick, and
          // `restsOnAim` then reads `false` for a strip resting 4px short of
          // its 200 aim — latching a gesture nobody made.
          expect(visitor.hasScrolled()).toBe(false);
        });
      } finally {
        // Clears the quiet-spell timer the manual `scrollend` dispatch above
        // leaves pending, so this case does not hold the process open for
        // `QUIET_BEFORE_SETTLED_MS` after its assertion has already run.
        visitor.detach();
      }
    } finally {
      strip.remove();
    }
  });

  it('still latches a genuine drag that starts mid-scrollTo', async () => {
    const strip = makeStrip();
    try {
      const visitor = watchVisitorScroll(strip);
      try {
        visitor.beforeOwnScroll(200);
        strip.dispatchEvent(new MouseEvent('pointerdown', { clientX: 50 }));

        // The strip's own scroll starts ticking, same as above — the pointer
        // is still just resting so far.
        tickScroll(strip, 60);

        // Now the visitor actually drags: the pointer travels, and the strip
        // scrolls further than the strip's own re-centre ever aimed for.
        strip.dispatchEvent(new MouseEvent('pointermove', { clientX: 90 }));
        tickScroll(strip, 260);
        strip.dispatchEvent(new Event('scrollend'));

        // Resting 60px past the 200 aim is unmistakably the visitor's, and it
        // must still read that way even though it began under the same
        // `scrollTo`.
        await waitFor(() => {
          // eslint-disable-next-line test-flakiness/no-viewport-dependent -- a detached mock's own `scrollLeft`, pinned by this file, not a real viewport read
          expect(strip.scrollLeft).toBe(260);
          expect(visitor.hasScrolled()).toBe(true);
        });
      } finally {
        visitor.detach();
      }
    } finally {
      strip.remove();
    }
  });

  it('does not latch a scroll event that carries no real delta, even with the pointer down and moved', async () => {
    const strip = makeStrip();
    try {
      const visitor = watchVisitorScroll(strip);
      try {
        visitor.beforeOwnScroll(200);
        strip.dispatchEvent(new MouseEvent('pointerdown', { clientX: 50 }));
        strip.dispatchEvent(new MouseEvent('pointermove', { clientX: 90 }));

        // A `scroll` event with the strip already exactly where it started —
        // no real motion for either signal to attribute to the pointer.
        tickScroll(strip, 0);
        strip.dispatchEvent(new Event('scrollend'));

        await waitFor(() => {
          // Positive: the tick really ran (the mock's own wiring, not the
          // fix, is what would leave `scrollLeft` untouched otherwise).
          // eslint-disable-next-line test-flakiness/no-viewport-dependent -- a detached mock's own `scrollLeft`, pinned by this file, not a real viewport read
          expect(strip.scrollLeft).toBe(0);
          expect(visitor.hasScrolled()).toBe(false);
        });
      } finally {
        visitor.detach();
      }
    } finally {
      strip.remove();
    }
  });
});

/**
 * A KEY PRESS THE STRIP'S OWN SCROLL FINISHED UNDER (FUT-2848).
 *
 * A visitor presses an arrow key on the strip; before the scroll it causes has
 * ticked once, a resize re-centres the strip — and on a busy main thread that
 * re-centre's smooth scroll can be COMPLETE by its first tick, so it comes to
 * rest on its own aim and is judged the strip's own. That verdict used to
 * disarm the key press, and the key's scroll — still to come — went unclaimed:
 * the next resize re-centred the strip away from where the visitor put it.
 */
/**
 * A BARE KEYDOWN MUST NOT ARM THE LOCK (FUT-2862).
 *
 * `onKeydown` used to be `nudge` itself — every keydown that bubbled to the
 * strip armed `nudged`, `Tab`/`Enter`/`Space` included, though none of them
 * scrolls this strip. Reusing the exact fixture the pointer case above
 * constructs on purpose (`beforeOwnScroll(200)`, then the strip's own smooth
 * scroll ticking short of its aim by more than `LANDED_SLACK`): a keydown for
 * a NON-scrolling key must leave `hasScrolled()` `false`, the same as a
 * resting pointer does. `ArrowLeft`, the one verified strip-scrolling key
 * (`ChipStripKeepsKeyScrollARecentreRaced`), must still arm it — the guard
 * that the fix does not remove real arrow-key scroll detection.
 */
describe('watchVisitorScroll: a keydown only arms the lock for a strip-scrolling key (FUT-2862)', () => {
  // Three explicit `it(...)` calls, not `it.each`: `eslint-plugin-test-flakiness`'s
  // `no-test-isolation` rule only recognises `it(...)`/`test(...)`/`specify(...)` —
  // a CallExpression whose callee is a plain Identifier. `it.each([...])(...)`'s
  // outer callee is itself a CallExpression, so the rule misreads every `const`
  // this callback declares as DESCRIBE-scoped shared state, not test-scoped
  // local state, and false-flags `strip`/`visitor` throughout the file.
  for (const key of ['Tab', 'Enter', 'Space']) {
    it(`does not latch on a bare '${key}' keydown through the strip's OWN scrollTo landing short of its aim`, async () => {
      const strip = makeStrip();
      try {
        const visitor = watchVisitorScroll(strip);
        try {
          visitor.beforeOwnScroll(200);
          strip.dispatchEvent(new KeyboardEvent('keydown', { key }));

          tickScroll(strip, 60);
          tickScroll(strip, 140);
          tickScroll(strip, 204);
          strip.dispatchEvent(new Event('scrollend'));

          await waitFor(() => {
            // Positive first: the scenario really ran, 4px short of aim.
            // eslint-disable-next-line test-flakiness/no-viewport-dependent -- a detached mock's own `scrollLeft`, pinned by this file, not a real viewport read
            expect(strip.scrollLeft).toBe(204);
            // On today's (unfixed) code this reads `true`: `onKeydown` armed
            // `nudged` unconditionally, so `restsOnAim` reading `false` for a
            // strip 4px short of its 200 aim latches a gesture nobody made.
            expect(visitor.hasScrolled()).toBe(false);
          });
        } finally {
          visitor.detach();
        }
      } finally {
        strip.remove();
      }
    });
  }

  it("still latches a real ArrowLeft through the strip's OWN scrollTo landing short of its aim", async () => {
    const strip = makeStrip();
    try {
      const visitor = watchVisitorScroll(strip);
      try {
        visitor.beforeOwnScroll(200);
        strip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));

        tickScroll(strip, 60);
        tickScroll(strip, 140);
        tickScroll(strip, 204);
        strip.dispatchEvent(new Event('scrollend'));

        await waitFor(() => {
          // eslint-disable-next-line test-flakiness/no-viewport-dependent -- a detached mock's own `scrollLeft`, pinned by this file, not a real viewport read
          expect(strip.scrollLeft).toBe(204);
          expect(visitor.hasScrolled()).toBe(true);
        });
      } finally {
        visitor.detach();
      }
    } finally {
      strip.remove();
    }
  });
});

describe('watchVisitorScroll: a key press outlives an own scroll judged under it', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("claims the key's scroll that follows a re-centre which rested on its aim", async () => {
    const strip = makeStrip();
    try {
      const visitor = watchVisitorScroll(strip);
      try {
        strip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
        // The re-centre, already at rest by its first tick.
        visitor.beforeOwnScroll(113);
        tickScroll(strip, 113);
        strip.dispatchEvent(new Event('scrollend'));
        await waitFor(() => expect(visitor.isUndecided()).toBe(false));
        // Judged the strip's own, rightly.
        expect(visitor.hasScrolled()).toBe(false);

        // Then the key's own scroll, back to the start.
        tickScroll(strip, 60);
        tickScroll(strip, 0);
        strip.dispatchEvent(new Event('scrollend'));

        await waitFor(() => expect(visitor.hasScrolled()).toBe(true));
      } finally {
        visitor.detach();
      }
    } finally {
      strip.remove();
    }
  });

  it('lets a key press go once it is stale, so a later clamp is not read as the visitor', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-27T12:00:00.000Z'));
    const strip = makeStrip();
    try {
      const visitor = watchVisitorScroll(strip);
      try {
        strip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
        visitor.beforeOwnScroll(113);
        tickScroll(strip, 113);
        strip.dispatchEvent(new Event('scrollend'));
        await waitFor(() => expect(visitor.isUndecided()).toBe(false));

        // Long after the key press, the browser clamps the strip short of its
        // aim (its content shrank). Nobody touched it.
        vi.setSystemTime(new Date('2026-09-27T12:00:05.000Z'));
        tickScroll(strip, 90);
        strip.dispatchEvent(new Event('scrollend'));

        await waitFor(() => expect(visitor.isUndecided()).toBe(false));
        expect(visitor.hasScrolled()).toBe(false);
      } finally {
        visitor.detach();
      }
    } finally {
      strip.remove();
    }
  });
});

