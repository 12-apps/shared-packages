import { describe, expect, it } from 'vitest';

import { publishGuardError } from '../builder-model';

/**
 * FUT-307 review follow-up: role-based sharing with an empty allowlist is
 * blocked pre-save (a failed roles fetch must not silently publish a
 * document nobody beyond author+admins can see).
 */
describe('publishGuardError', () => {
  it('blocks role-based sharing with an empty allowlist', () => {
    expect(
      publishGuardError({ status: 'published', visibility: 'roles', visibilityRoles: [] }),
    ).toContain('ao menos uma função');
  });

  it('passes role-based sharing with roles, and every other visibility', () => {
    expect(
      publishGuardError({ status: 'draft', visibility: 'roles', visibilityRoles: ['r1'] }),
    ).toBeNull();
    expect(
      publishGuardError({ status: 'published', visibility: 'tenant', visibilityRoles: [] }),
    ).toBeNull();
    expect(
      publishGuardError({ status: 'published', visibility: 'private', visibilityRoles: [] }),
    ).toBeNull();
  });
});
