import { assertLocaleParity } from '@12-apps/i18n/testing';
import { describe, expect, it } from 'vitest';

import { RBAC_WEB_COPY } from '../react/locales';
import { RBAC_MESSAGES } from '../server/locales';

/**
 * `tsc` already refuses a MISSING key — both packs are typed against their
 * interface. This covers the three drifts it cannot see: an optional key
 * present in one locale only, a nested object stubbed `{}`, and an
 * interpolating function whose translation dropped a parameter.
 *
 * `@12-apps/i18n` is a devDependency and this file never ships.
 */
describe('the locale packs', () => {
  it('speak both languages the same way', () => {
    assertLocaleParity('RBAC_WEB_COPY', RBAC_WEB_COPY);
    assertLocaleParity('RBAC_MESSAGES', RBAC_MESSAGES);
  });

  it('carries the role and member names into the sentences that name them', () => {
    // Facts travel as arguments so each language can place them where its own
    // grammar wants: "Roles for X" against "Papéis de X".
    for (const copy of Object.values(RBAC_WEB_COPY)) {
      expect(copy.rolesList.dialogTitles.edit('Gerente')).toContain('Gerente');
      expect(copy.teamRoleDialog.title('Ana')).toContain('Ana');
      expect(copy.rolesList.dialogTitles.override('Gerente')).toContain('Gerente');
    }
  });

  it('keeps every governance refusal unspecific about what was missing', () => {
    // Naming the absent grant tells a caller which one to go and acquire. Both
    // languages have to hold that line, so it is asserted rather than trusted.
    for (const messages of Object.values(RBAC_MESSAGES)) {
      for (const sentence of Object.values(messages.governance)) {
        expect(sentence).not.toMatch(/[a-z]+:[a-z]+/);
      }
    }
  });
});
