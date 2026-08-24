import { assertLocaleParity } from '@12-apps/i18n/testing';
import { describe, expect, it } from 'vitest';

import { LIFECYCLE_WEB_COPY } from '../react/locales';
import { LIFECYCLE_MESSAGES } from '../server/locales';

/**
 * `tsc` already refuses a MISSING key. This covers the three drifts it cannot
 * see, plus the one this package can get wrong on its own: the purge dialog
 * asks the operator to TYPE a word and then matches on it, so the label and the
 * expected text have to stay the same string in every language.
 *
 * `@12-apps/i18n` is a devDependency and this file never ships.
 */
describe('the locale packs', () => {
  it('speak both languages the same way', () => {
    assertLocaleParity('LIFECYCLE_WEB_COPY', LIFECYCLE_WEB_COPY);
    assertLocaleParity('LIFECYCLE_MESSAGES', LIFECYCLE_MESSAGES);
  });

  it('asks the operator to type exactly what the purge dialog matches on', () => {
    for (const copy of Object.values(LIFECYCLE_WEB_COPY)) {
      const { purgeConfirmText, purgeTypeToConfirmLabel } = copy.recycleBin;
      expect(purgeTypeToConfirmLabel(purgeConfirmText)).toContain(purgeConfirmText);
    }
  });

  it('keeps the four not-found answers distinct', () => {
    // Which of a version, a draft, a bin entry and a request is missing is what
    // tells an operator whether someone else finished the job or whether they
    // are looking at a stale tab. Collapsing them into one sentence loses that.
    for (const messages of Object.values(LIFECYCLE_MESSAGES)) {
      const notFound = [
        messages.entityNotFound,
        messages.versionNotFound,
        messages.entryNotFound,
        messages.draftNotFound,
        messages.requestNotFound,
      ];
      expect(new Set(notFound).size).toBe(notFound.length);
    }
  });
});
