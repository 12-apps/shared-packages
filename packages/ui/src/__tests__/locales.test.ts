import { assertLocaleParity } from '@12-apps/i18n/testing';
import { describe, expect, it } from 'vitest';

import * as locales from '../locales';

/**
 * `tsc` already refuses a MISSING key — every pack is typed against the same
 * interface on both sides. This covers the three drifts it cannot see: an
 * optional key present in one locale only, a nested object stubbed `{}`, and an
 * interpolating function whose translation dropped a parameter.
 *
 * It walks EVERY exported pack rather than naming them, so a family added to
 * `locales.ts` is checked without anyone remembering to extend this list — the
 * completeness property, in the one place it can be asserted cheaply.
 *
 * `@12-apps/i18n` is a devDependency and this file never ships (`files`
 * excludes `__tests__`), so the package keeps no runtime dependency on it.
 */
const PACKS = Object.entries(locales);

describe('the locale packs', () => {
  it('covers every family this package renders', () => {
    // A floor rather than an exact count: it fails if `locales.ts` is gutted,
    // and does not need editing when a component family is added.
    expect(PACKS.length).toBeGreaterThanOrEqual(22);
  });

  it.each(PACKS)('%s speaks both languages the same way', (name, pack) => {
    assertLocaleParity(name, pack as Parameters<typeof assertLocaleParity>[1]);
  });

  it('keeps the confirm-action word the HOST chose, in both', () => {
    // The reader has to type this word for the dialog to accept it, so it is
    // interpolated rather than translated: a dialog that asks for one word and
    // matches on another can never be confirmed.
    for (const copy of Object.values(locales.CONFIRM_ACTION_COPY)) {
      expect(copy.typeToConfirm('DELETE')).toContain('DELETE');
    }
  });

  it('gives each language its own date mask', () => {
    // The mask is what the reader TYPES. A translated label above an unchanged
    // mask is the shape that gets a date entered backwards.
    expect(locales.DATA_VIEWS_COPY['pt-BR'].filters.dayMask).toBe('dd/mm/aaaa');
    expect(locales.DATA_VIEWS_COPY['en-US'].filters.dayMask).toBe('mm/dd/yyyy');
  });
});
