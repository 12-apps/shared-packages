import { assertLocaleParity } from '@12-apps/i18n/testing';
import { describe, expect, it } from 'vitest';

import { STORAGE_MESSAGES, STORAGE_UNAUTHENTICATED } from '../locales';
import { WEB_STORAGE_MESSAGES } from '../react/locales';

/**
 * These packs hold FACTORIES, so parity has to be asserted on what they
 * RETURN. Comparing the factories themselves would only prove both take one
 * argument — every missing sentence inside would pass.
 */
const SERVER_CONTEXT = { limit: '5 MB' };
const WEB_CONTEXT = { limit: '5 MB' };

const called = <C, T>(pack: { 'pt-BR': (c: C) => T; 'en-US': (c: C) => T }, context: C) => ({
  'pt-BR': pack['pt-BR'](context),
  'en-US': pack['en-US'](context),
});

describe('the locale packs', () => {
  it('speak both languages the same way', () => {
    assertLocaleParity('STORAGE_MESSAGES', called(STORAGE_MESSAGES, SERVER_CONTEXT));
    assertLocaleParity('WEB_STORAGE_MESSAGES', called(WEB_STORAGE_MESSAGES, WEB_CONTEXT));
    assertLocaleParity('STORAGE_UNAUTHENTICATED', STORAGE_UNAUTHENTICATED);
  });

  it('interpolates the host ceiling rather than naming a number', () => {
    // The commonest way this copy goes stale is a translation that inlines the
    // limit it was written against; a host raising `maxBytes` then ships a
    // sentence quoting the old one.
    for (const messages of Object.values(called(STORAGE_MESSAGES, { limit: '9 MB' }))) {
      expect(messages.file_too_large).toContain('9 MB');
    }
    for (const messages of Object.values(called(WEB_STORAGE_MESSAGES, { limit: '9 MB' }))) {
      expect(messages.file_too_large).toContain('9 MB');
      expect(messages.pageIntro).toContain('9 MB');
    }
  });
});
