import { assertLocaleParity } from '@12-apps/i18n/testing';
import { describe, expect, it } from 'vitest';

import { RESEARCH_MESSAGES } from '../locales';

/**
 * `tsc` already refuses a MISSING key. This covers the three drifts it cannot
 * see, and one property specific to this surface: four of these sentences are
 * WARNINGS about what the engine could not verify, and their hedged register is
 * load-bearing rather than stylistic. A translation that firmed them up would
 * assert a cause the guard cannot know.
 *
 * `@12-apps/i18n` is a devDependency and this file never ships.
 */
describe('the locale pack', () => {
  it('speaks both languages the same way', () => {
    assertLocaleParity('RESEARCH_MESSAGES', RESEARCH_MESSAGES);
  });

  it('keeps each warning hint hedged and actionable', () => {
    // Every one of the four says what is missing AND what to check. The floor
    // is crude on purpose — it catches a hint replaced by a bare label, which
    // is what "tidying" a long sentence usually produces.
    for (const messages of Object.values(RESEARCH_MESSAGES)) {
      for (const hint of [
        messages.truncatedHint,
        messages.outsideAreaHint,
        messages.suspectUnitPriceHint,
        messages.shippingUnknownHint,
      ]) {
        expect(hint.length).toBeGreaterThan(80);
      }
    }
  });

  it('carries the counts into the per-source status lines', () => {
    for (const messages of Object.values(RESEARCH_MESSAGES)) {
      expect(messages.statusOk(3)).toContain('3');
      expect(messages.statusCachedTruncated(7)).toContain('7');
      expect(messages.relevance(84)).toContain('84');
    }
  });
});
