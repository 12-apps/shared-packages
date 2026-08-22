import { describe, expect, it } from 'vitest';

import { publishGuardError } from '../builder-model';
import { PT_BR_REPORT_SCREENS_COPY } from '../pt-BR';

const BUILDER = PT_BR_REPORT_SCREENS_COPY.builder;

/**
 * FUT-307 review follow-up: role-based sharing with an empty allowlist is
 * blocked pre-save (a failed roles fetch must not silently publish a
 * document nobody beyond author+admins can see).
 */
describe('publishGuardError', () => {
  it('blocks role-based sharing with an empty allowlist', () => {
    expect(
      publishGuardError({ status: 'published', visibility: 'roles', visibilityRoles: [] }, BUILDER),
    ).toContain('ao menos uma função');
  });

  it('passes role-based sharing with roles, and every other visibility', () => {
    expect(
      publishGuardError({ status: 'draft', visibility: 'roles', visibilityRoles: ['r1'] }, BUILDER),
    ).toBeNull();
    expect(
      publishGuardError({ status: 'published', visibility: 'tenant', visibilityRoles: [] }, BUILDER),
    ).toBeNull();
    expect(
      publishGuardError({ status: 'published', visibility: 'private', visibilityRoles: [] }, BUILDER),
    ).toBeNull();
  });
});
