import { describe, expect, it } from 'vitest';

import { heightSegments } from '../block-height-picker';
import { PT_BR_REPORT_SCREENS_COPY } from '../pt-BR';

const BUILDER = PT_BR_REPORT_SCREENS_COPY.builder;

/**
 * `Altura`, the counterpart to `Largura` (FUT-755): "we have largura, we could
 * have also altura".
 *
 * The rule the whole feature rests on is the FIRST case below. `Auto` is a real
 * option and the default, and it stores nothing — which is what keeps every
 * report saved before this control existed measuring exactly what it measures
 * today.
 */
describe('heightSegments', () => {
  it('leads with Auto, which stores NO height at all', () => {
    const [first] = heightSegments(BUILDER);
    expect(first).toEqual({ height: undefined, label: 'Auto' });
  });

  it('offers Auto plus the three tiers, in order', () => {
    expect(heightSegments(BUILDER)).toEqual([
      { height: undefined, label: 'Auto' },
      { height: 1, label: 'Baixa' },
      { height: 2, label: 'Média' },
      { height: 3, label: 'Alta' },
    ]);
  });

  it('offers every height the schema stores — no tier is ever missing', () => {
    // Unlike a width, which may be stored at any of twelve values and so needs
    // a fallback segment, a height IS the tier. Every storable value therefore
    // already has a segment, so the only argument this control takes is the
    // COPY — it stopped shipping its own labels in FUT-760, and the arity is
    // pinned here so a second argument cannot appear without being argued.
    const offered = heightSegments(BUILDER).map((segment) => segment.height);
    expect(offered).toEqual([undefined, 1, 2, 3]);
    expect(heightSegments.length).toBe(1);
  });

  it('names the heights rather than measuring them', () => {
    // Same register as `Largura`: a store owner deciding how tall a chart
    // should be has no view about viewport units, exactly as they have none
    // about twelfths.
    for (const segment of heightSegments(BUILDER)) {
      expect(segment.label).not.toMatch(/linha|px|vh|\d/);
    }
  });
});
