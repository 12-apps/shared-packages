import { describe, expect, it } from 'vitest';

import * as attention from '../index';
import * as attentionReact from '../react';

/**
 * The root suite (`src/__tests__/portability.test.ts`) inspects the root
 * entry's exports only. The attention entries ship on their own subpaths, so
 * the same line is held here: no copy table a host could inherit by accident.
 */
describe("the attention entries ship nobody else's words", () => {
  it.each([
    ['./attention', attention],
    ['./attention/react', attentionReact],
  ])('%s exports no DEFAULT_ copy table', (_entry, exports) => {
    const names = Object.keys(exports);
    expect(names.length).toBeGreaterThan(5);
    expect(names.filter((name) => /^DEFAULT_.*MESSAGES?$/.test(name))).toEqual([]);
    expect(names.filter((name) => /(MESSAGES?|LABELS?|COPY|CATEGORIES)$/.test(name))).toEqual([]);
  });
});
