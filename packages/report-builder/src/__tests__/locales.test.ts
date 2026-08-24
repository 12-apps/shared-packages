import { assertLocaleParity } from '@12-apps/i18n/testing';
import { describe, expect, it } from 'vitest';

import {
  BLANK_BLOCK_TEMPLATE_COPY,
  REPORT_ENGINE_COPY,
  REPORT_SCREENS_COPY,
  REPORT_SERVER_MESSAGES,
} from '../locales';

/**
 * `tsc` already refuses a MISSING key. This covers the three drifts it cannot
 * see, plus the one thing in this package that is DERIVED rather than chosen
 * and therefore fails silently: `connectives`.
 *
 * `@12-apps/i18n` is a devDependency and this file never ships.
 */
describe('the locale packs', () => {
  it('speak both languages the same way', () => {
    assertLocaleParity('REPORT_ENGINE_COPY', REPORT_ENGINE_COPY);
    assertLocaleParity('REPORT_SERVER_MESSAGES', REPORT_SERVER_MESSAGES);
    assertLocaleParity('BLANK_BLOCK_TEMPLATE_COPY', BLANK_BLOCK_TEMPLATE_COPY);
    assertLocaleParity('REPORT_SCREENS_COPY', REPORT_SCREENS_COPY);
  });

  it('carries its own locale tag, which is what values are formatted with', () => {
    // The sentence under a chart and the numbers in it have to be written for
    // the same reader.
    expect(REPORT_ENGINE_COPY['pt-BR'].spec.locale).toBe('pt-BR');
    expect(REPORT_ENGINE_COPY['en-US'].spec.locale).toBe('en-US');
  });

  it('lists every phrase its own sentence joins with, longest first', () => {
    // `connectives` is DERIVED from the members above it and exists so the
    // surface can take a rendered sentence apart again. A phrase changed above
    // and not here reads as part of a field name — silently.
    for (const [locale, copy] of Object.entries(REPORT_ENGINE_COPY)) {
      const { spec } = copy;
      const rendered = spec.sentence({
        measures: 'M',
        entity: 'E',
        groupBy: 'G',
        splitBy: 'S',
        filters: 'F',
        limit: 5,
      });
      const joins = spec.connectives.filter((phrase) => rendered.includes(phrase));
      // Every clause the sentence added must be findable in the list.
      expect(joins.length, `${locale} sentence joins`).toBeGreaterThanOrEqual(4);

      // …and the ratio and list joins too.
      expect(spec.connectives.some((c) => spec.ratio('a', 'b').includes(c))).toBe(true);
      expect(spec.connectives.some((c) => spec.list(['a', 'b']).includes(c))).toBe(true);

      const lengths = spec.connectives.map((phrase) => phrase.length);
      expect(lengths, `${locale} connectives ordering`).toEqual(
        [...lengths].sort((left, right) => right - left),
      );
    }
  });

  it('keeps the two exit warnings saying different things', () => {
    // A PUBLISHED report still shows its published version to everyone else; a
    // draft shows nothing at all. One sentence for both would tell half the
    // readers something untrue about who can see their work.
    for (const copy of Object.values(REPORT_SCREENS_COPY)) {
      expect(copy.editor.exitPublishedBody).not.toBe(copy.editor.exitDraftBody);
      expect(copy.archive.archiveBodyFromList).not.toBe(copy.archive.archiveBodyFromViewer);
    }
  });

  it('keeps the field prefix the surface splits a name error on', () => {
    for (const messages of Object.values(REPORT_SERVER_MESSAGES)) {
      expect(messages.nameRequired.startsWith('name:')).toBe(true);
    }
  });
});
