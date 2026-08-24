import { assertLocaleParity } from '@12-apps/i18n/testing';
import { describe, expect, it } from 'vitest';

import { ONBOARDING_MESSAGES, ONBOARDING_UNAUTHENTICATED } from '../server/locales';

/**
 * `tsc` already refuses a MISSING key — both packs are typed against
 * `OnboardingMessages`. This covers the drifts it cannot see, and the 401 body,
 * which travels separately because the router answers it before any context
 * exists.
 *
 * `@12-apps/i18n` is a devDependency and this file never ships.
 */
describe('the locale packs', () => {
  it('speak both languages the same way', () => {
    assertLocaleParity('ONBOARDING_MESSAGES', ONBOARDING_MESSAGES);
    assertLocaleParity('ONBOARDING_UNAUTHENTICATED', ONBOARDING_UNAUTHENTICATED);
  });

  it('answers the 401 with a sentence in every language', () => {
    for (const body of Object.values(ONBOARDING_UNAUTHENTICATED)) {
      expect(body.length).toBeGreaterThan(0);
    }
  });
});
