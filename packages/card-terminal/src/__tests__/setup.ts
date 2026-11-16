/**
 * The async budget every `findBy*`/`waitFor` in this package gets.
 *
 * Testing Library defaults `asyncUtilTimeout` to **1000ms**, which is a
 * wall-clock budget written for a machine running one suite. CI runs 31
 * packages at once: on the run that broke publishing, this package reported
 * `collect 167.39s` against ~57s locally, and the very first render in a jsdom
 * file — the one paying module init for React, MUI and Emotion — blew straight
 * through the second.
 *
 * The margin was never comfortable. `oauth-panel.test.tsx`'s first case takes
 * ~380ms on an idle box, so the default left it a factor of 2.6 before it went
 * red; the runner spent more than that. It failed as
 * `Unable to find an element by: [data-testid="payments-setup-section-habilitar"]`
 * over a DOM whose fetch had simply not landed yet — a green assertion arriving
 * late, not a broken one — and because `Release` needs the unit-test job, the
 * repo stopped publishing on it.
 *
 * 15s is ~39x that observed cost, so starvation stops being expressible. It is
 * paid ONLY by a query that never resolves: a passing one returns the moment
 * its element appears, so the suite does not get slower for having room.
 *
 * `testTimeout` in `vitest.config.ts` is raised past this on purpose. Vitest's
 * own 5s default would fire FIRST and report "Test timed out in 5000ms" —
 * true, useless, and without the rendered DOM. Keeping the case budget above
 * the query budget is what makes the Testing Library error the one you read.
 *
 * Guarded on `document` because this package defaults to the node environment
 * and opts into jsdom per file; there is nothing to configure in a node worker,
 * and no reason to load React into one.
 */
if (typeof document !== 'undefined') {
  const { configure } = await import('@testing-library/react');
  configure({ asyncUtilTimeout: 15_000 });
}
