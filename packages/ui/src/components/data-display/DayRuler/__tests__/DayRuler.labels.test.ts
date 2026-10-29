import { assertLocaleParity } from '@12-apps/i18n/testing';
import { describe, expect, it } from 'vitest';

import { EN_US_UI_LABELS } from '../../../../en-US.labels';
import { DAY_RULER_LABELS } from '../DayRuler.labels';

/**
 * `DayRuler`'s words are not in `locales.ts` (they load only with the component,
 * FUT-3831), so the parity walk over `locales.ts` does not reach them: this
 * file is that walk for the one pack.
 */
describe('DAY_RULER_LABELS', () => {
  it('speaks both languages the same way', () => {
    assertLocaleParity('DAY_RULER_LABELS', DAY_RULER_LABELS as Parameters<typeof assertLocaleParity>[1]);
  });

  it('is not carried by the shared labels pack eager components import', () => {
    expect(Object.keys(EN_US_UI_LABELS)).not.toContain('dayRuler');
  });
});
