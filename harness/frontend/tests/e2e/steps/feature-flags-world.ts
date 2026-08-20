import { expect, type Page } from '@playwright/test';
import { defineFeatureFlagsWorld } from '@12-apps/feature-flags/e2e';

/**
 * THIS APP'S half of the packaged beta-cohort journeys (FUT-884) — the
 * report-builder arrangement: the scenarios and their steps ship inside
 * `@12-apps/feature-flags`; none of them is copied here, and none of them
 * knows what a harness page is. What is host-specific is exactly what this
 * file supplies: which URL the flags surface lives at, how the cohort gets
 * back to its seeded state, and which of this app's own betas and people a
 * scenario may name.
 *
 * It lives in the `steps` glob on purpose: playwright-bdd imports every step
 * file before any scenario runs, so the `defineFeatureFlagsWorld` call below
 * lands in every worker before the first Given executes.
 */

/** The harness page that mounts the surface — see `src/pages/feature-flags.tsx`. */
const FLAGS_URL = '#/feature-flags';

defineFeatureFlagsWorld({
  /**
   * Back to the seeded cohort: Ana enrolled in the delivery beta, nobody
   * else anywhere. Served by the same backend the surface talks to, through
   * the same Vite proxy — deliberately NOT under `/api`, so nothing can
   * mistake it for part of the package's surface.
   */
  reset: async (page: Page) => {
    const response = await page.request.post('/__harness/feature-flags/reset');
    // A silent failure here is a journey that starts from whatever the last
    // one left behind — visible only as an unrelated scenario going red later.
    expect(response.status()).toBe(204);
  },

  openFlags: async (page: Page) => {
    await page.goto(FLAGS_URL);
    await expect(page.getByTestId('ff-flag-list')).toBeVisible();
  },

  /**
   * This app's own seed (`feature-flags-host.ts` / `feature-flags-db.ts`),
   * named once here so no feature file ever carries a harness fixture as
   * though it were everybody's.
   */
  fixtures: {
    seededFlag: { key: 'delivery-beta' },
    emptyFlag: { key: 'novo-dashboard' },
    seededTester: { email: 'ana@harness.dev', userId: 'u-ana' },
    newTester: { email: 'bruno@harness.dev', userId: 'u-bruno' },
    strangerEmail: 'quem@harness.dev',
    operatorEmail: 'root@harness.dev',
  },
});
