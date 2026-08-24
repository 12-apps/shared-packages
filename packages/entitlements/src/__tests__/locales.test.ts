import { assertLocaleParity } from '@12-apps/i18n/testing';
import { describe, expect, it } from 'vitest';

import { ENTITLEMENTS_WEB_COPY } from '../react/locales';
import { ENTITLEMENTS_MESSAGES, ENTITLEMENTS_PERMISSION_LABELS } from '../server/locales';

/**
 * `tsc` already refuses a MISSING key. This covers the three drifts it cannot
 * see, plus the two properties of this surface that a translation could break
 * without breaking a type.
 *
 * `@12-apps/i18n` is a devDependency and this file never ships.
 */
describe('the locale packs', () => {
  it('speak both languages the same way', () => {
    assertLocaleParity('ENTITLEMENTS_MESSAGES', ENTITLEMENTS_MESSAGES);
    assertLocaleParity('ENTITLEMENTS_PERMISSION_LABELS', ENTITLEMENTS_PERMISSION_LABELS);
    assertLocaleParity('ENTITLEMENTS_WEB_COPY', ENTITLEMENTS_WEB_COPY);
  });

  it('drops the upsell clause when no tier would clear the ceiling', () => {
    // A wrong upsell is the single most damaging thing the plan screen can
    // print: it sells a tier that would not lift the limit. The null branch has
    // to survive translation in every language.
    for (const messages of Object.values(ENTITLEMENTS_MESSAGES)) {
      const withUpsell = messages.overQuotaNote({ limit: 5, used: 9, nextPlanLabel: 'Pro' });
      const without = messages.overQuotaNote({ limit: 5, used: 9, nextPlanLabel: null });
      expect(withUpsell).toContain('Pro');
      expect(without).not.toContain('Pro');
      expect(without.length).toBeLessThan(withUpsell.length);
    }
  });

  it("keeps the tenant's own switch distinct from a plan refusal", () => {
    // Saying "not included in your plan" here would send someone to buy a tier
    // that changes nothing — the switch is theirs, and no plan fixes it.
    for (const messages of Object.values(ENTITLEMENTS_MESSAGES)) {
      expect(messages.featureNotes['disabled-by-tenant']).not.toBe(
        messages.featureNotes['not-entitled'],
      );
    }
    for (const copy of Object.values(ENTITLEMENTS_WEB_COPY)) {
      expect(copy.upsell.reasons['disabled-by-tenant'].body).not.toBe(
        copy.upsell.reasons['not-entitled'].body,
      );
    }
  });

  it('interpolates the ceiling rather than naming a number', () => {
    for (const messages of Object.values(ENTITLEMENTS_MESSAGES)) {
      expect(messages.overQuotaNote({ limit: 42, used: 99, nextPlanLabel: null })).toContain('42');
    }
  });
});
