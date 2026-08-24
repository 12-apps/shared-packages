/**
 * What a card says a tier ADDS.
 *
 * The vocabulary is a hall's rather than a shop's, for the same reason the
 * portability suites use one: a derivation that quietly assumed the shape of
 * the application this package came from would pass against its own fixtures
 * forever.
 */
import { describe, expect, it } from 'vitest';

import type { ComparisonSection, ComparisonTier } from '../../plan-wire';
import { tierHighlights } from '../tier-highlights';

function tier(name: string, sections: ComparisonSection[]): ComparisonTier {
  return {
    key: name.toLowerCase(),
    name,
    priceCents: 0,
    price: null,
    priceNote: null,
    pitch: '',
    headline: '',
    headlineUnit: '',
    current: false,
    upgrade: true,
    recommended: false,
    sections,
  };
}

/** Three tiers over one shared matrix, the way a host's builder emits them. */
function hall(): ComparisonTier[] {
  return [
    tier('Ensemble', [
      {
        title: 'Repertório',
        lines: [
          { label: 'Partituras', included: true, detail: 'até 25' },
          { label: 'Partes por naipe', included: false, detail: null },
        ],
      },
      {
        title: 'Ensaios',
        lines: [
          { label: 'Gravação de ensaios', included: false, detail: null },
          { label: 'Convites a solistas', included: false, detail: null },
        ],
      },
    ]),
    tier('Chamber', [
      {
        title: 'Repertório',
        lines: [
          { label: 'Partituras', included: true, detail: 'até 400' },
          { label: 'Partes por naipe', included: true, detail: null },
        ],
      },
      {
        title: 'Ensaios',
        lines: [
          { label: 'Gravação de ensaios', included: false, detail: null },
          { label: 'Convites a solistas', included: false, detail: null },
        ],
      },
    ]),
    tier('Philharmonic', [
      {
        title: 'Repertório',
        lines: [
          { label: 'Partituras', included: true, detail: 'ilimitado' },
          { label: 'Partes por naipe', included: true, detail: null },
        ],
      },
      {
        title: 'Ensaios',
        lines: [
          { label: 'Gravação de ensaios', included: true, detail: null },
          { label: 'Convites a solistas', included: true, detail: null },
        ],
      },
    ]),
  ];
}

const labels = (lines: { label: string }[]): string[] => lines.map((line) => line.label);

describe('what a tier adds over the one below it', () => {
  it('gives the entry tier its own included lines, and no inheritance line', () => {
    const { lines, inheritsFrom, more } = tierHighlights(hall(), 0, 4);
    expect(labels(lines)).toEqual(['Partituras']);
    // Nothing to build on — the card says "includes", not "everything in X".
    expect(inheritsFrom).toBeNull();
    expect(more).toBe(0);
  });

  it('names the cheaper tier COMMERCIALLY, never by key', () => {
    expect(tierHighlights(hall(), 1, 4).inheritsFrom).toBe('Ensemble');
    expect(tierHighlights(hall(), 2, 4).inheritsFrom).toBe('Chamber');
  });

  it('counts a raised ceiling as a difference, and an unchanged line as none', () => {
    const { lines } = tierHighlights(hall(), 1, 4);
    // "até 25" → "até 400" is the reason to move up and has to show; the two
    // rows Chamber does not change must not.
    expect(labels(lines)).toEqual(['Partes por naipe', 'Partituras']);
  });

  it('puts NEW capabilities ahead of raised ceilings', () => {
    // The ordering is the whole point of the distinction: a top tier whose
    // ceiling bumps came first would cut the capabilities only it has off the
    // bottom of a four-line list.
    const { lines } = tierHighlights(hall(), 2, 4);
    expect(labels(lines)).toEqual(['Gravação de ensaios', 'Convites a solistas', 'Partituras']);
  });

  it('trims to the limit and reports what it left out', () => {
    const { lines, more } = tierHighlights(hall(), 2, 2);
    expect(labels(lines)).toEqual(['Gravação de ensaios', 'Convites a solistas']);
    expect(more).toBe(1);
  });

  it('matches a label within its OWN section, not across the whole card', () => {
    // The same word can head a row under two different sections, and matching
    // on the label alone would compare unrelated rows.
    const cheap = tier('Cheap', [
      { title: 'A', lines: [{ label: 'Lugares', included: true, detail: 'até 4' }] },
      { title: 'B', lines: [{ label: 'Lugares', included: false, detail: null }] },
    ]);
    const dear = tier('Dear', [
      { title: 'A', lines: [{ label: 'Lugares', included: true, detail: 'até 4' }] },
      { title: 'B', lines: [{ label: 'Lugares', included: true, detail: null }] },
    ]);
    const { lines } = tierHighlights([cheap, dear], 1, 4);
    // Section A is unchanged; only B's row is new. One line, not two, and not
    // zero.
    expect(lines).toHaveLength(1);
  });

  it('treats a line the cheaper tier never mentions as added, rather than throwing', () => {
    const cheap = tier('Cheap', [{ title: 'A', lines: [] }]);
    const dear = tier('Dear', [
      { title: 'A', lines: [{ label: 'Camarim', included: true, detail: null }] },
    ]);
    expect(labels(tierHighlights([cheap, dear], 1, 4).lines)).toEqual(['Camarim']);
  });

  it('answers empty for an index no tier occupies', () => {
    expect(tierHighlights(hall(), 9, 4)).toEqual({ lines: [], more: 0, inheritsFrom: null });
  });
});
