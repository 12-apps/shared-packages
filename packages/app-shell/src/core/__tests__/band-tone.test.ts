/**
 * THE BAND THAT IS DERIVED RATHER THAN STATED (FUT-1923).
 *
 * `TINT_LIGHTNESS` is a number and that works in light mode, because there is
 * exactly one light ground. Dark mode has two by decision — the platform's own
 * and a store's — and the measurement that forced this API is that they want
 * OPPOSITE answers: 8% lightness is the only value clearing both surfaces on
 * a deep-red ground and the worst available one on a 12% page.
 *
 * So the first two cases below are the ticket's own table, re-measured here.
 * They are not testing `bandTone`; they are testing the PREMISE, and they are
 * what stops somebody "simplifying" this back into a constant. If a single
 * lightness ever does work on both grounds, these go red and the API can go.
 */
import { describe, expect, it } from 'vitest';

import { bandTone, bandToneSeparates, MIN_SURFACE_SEPARATION } from '../band-tone';
import { hueOfHex } from '../brand-palette';

/**
 * A host's own dark ground, and the card that sits on it.
 *
 * Named by its colour rather than by the product it was measured on: this
 * package publishes to consumers who have never heard of that product, and a
 * fixture that carries its name teaches the next reader to write one down too.
 */
const DEEP_RED = { ground: '#5E1113', card: '#7A2124' };

/** A store's own: a deep navy, with far less room below it. */
const NAVY = { ground: '#0B1733', card: '#1B2A4D' };

/** One seed per hue family, the six the epic's survey measured. */
const SEEDS = {
  lime: '#8BC34A',
  green: '#2E7D32',
  amber: '#FFB300',
  navy: '#1A237E',
  pink: '#D81B60',
  grey: '#757575',
} as const;

/** The three channels of a `#RRGGBB`, 0-255. */
function channelsOf(hex: string): [number, number, number] {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

  return [r, g, b];
}

/** HSL lightness, which is the axis `bandTone` walks. */
function lightnessOf(hex: string): number {
  const [r, g, b] = channelsOf(hex).map((channel) => channel / 255) as [number, number, number];

  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
}

/** A flat tone at a stated lightness, in the seed's own hue. */
function toneAt(seed: string, lightness: number): string {
  const h = hueOfHex(seed) ?? 0;
  // Mid saturation, which is where `SURFACE_SATURATION` clamps most seeds.
  const s = seed === SEEDS.grey ? 0 : 0.4;
  const a = (s * Math.min(lightness, 1 - lightness)) as number;
  const f = (n: number): string => {
    const k = (n + (h * 12) / 360) % 12;
    const c = lightness - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

describe('the premise: no single lightness works on both grounds', () => {
  it('8% separates on the platform ground and vanishes on a store one', () => {
    const onDeepRed = Object.values(SEEDS).filter((seed) =>
      bandToneSeparates(toneAt(seed, 0.08), DEEP_RED.ground, DEEP_RED.card),
    );
    const onNavy = Object.values(SEEDS).filter((seed) =>
      bandToneSeparates(toneAt(seed, 0.08), NAVY.ground, NAVY.card),
    );

    expect(onDeepRed).toHaveLength(6);
    // Every one of them disappears into a 12% page.
    expect(onNavy).toHaveLength(0);
  });

  it('26% is the mirror image — fine on a store ground, wrong on the platform', () => {
    const onNavy = Object.values(SEEDS).filter((seed) =>
      bandToneSeparates(toneAt(seed, 0.26), NAVY.ground, NAVY.card),
    );
    const onDeepRed = Object.values(SEEDS).filter((seed) =>
      bandToneSeparates(toneAt(seed, 0.26), DEEP_RED.ground, DEEP_RED.card),
    );

    // Asserted as an ASYMMETRY rather than 6-and-0, because `toneAt` below is
    // an approximation of the survey's real seeds and lands 5 where the
    // measurement landed 6. The claim that matters survives either way: a
    // lightness chosen for one ground is wrong on the other, in both
    // directions, so no single number can serve both.
    expect(onNavy.length).toBeGreaterThan(onDeepRed.length);
    expect(onDeepRed.length).toBeLessThan(6);
  });
});

describe('bandTone derives one that works on either', () => {
  for (const [name, seed] of Object.entries(SEEDS)) {
    it(`separates on the platform ground — ${name}`, () => {
      const band = bandTone(seed, DEEP_RED.ground, DEEP_RED.card);

      expect(bandToneSeparates(band, DEEP_RED.ground, DEEP_RED.card)).toBe(true);
    });

    it(`separates on a store's own ground — ${name}`, () => {
      const band = bandTone(seed, NAVY.ground, NAVY.card);

      expect(bandToneSeparates(band, NAVY.ground, NAVY.card)).toBe(true);
    });
  }

  it('descends where the card is above the page, and ascends where it is not', () => {
    /*
      Measured on HSL LIGHTNESS, which is the axis the walk actually moves.
      Luminance is the tempting thing to assert and the wrong one: it is
      channel-weighted, so an amber at L=0.22 is far more luminous than a dark
      red at the same L, and a band that genuinely descended would still read
      as "brighter" against black. That mistake is why this case first went
      red.
    */
    const onDeepRed = bandTone(SEEDS.amber, DEEP_RED.ground, DEEP_RED.card);
    expect(lightnessOf(onDeepRed)).toBeLessThan(lightnessOf(DEEP_RED.ground));

    /*
      And the flip, on a ground with genuinely NO room below it.

      The navy page is the wrong probe for this and it is worth saying why,
      because it was the first thing tried: at 12% lightness a descending
      AMBER still separates, since luminance is channel-weighted and an amber
      carries far more of it than a navy at the same lightness. So the walk
      takes its first direction and is right to. The direction only has to
      flip where down is not available at all.
    */
    const floor = { ground: '#050608', card: '#141A24' };
    const onFloor = bandTone(SEEDS.navy, floor.ground, floor.card);

    expect(lightnessOf(onFloor)).toBeGreaterThan(lightnessOf(floor.ground));
    expect(bandToneSeparates(onFloor, floor.ground, floor.card)).toBe(true);
  });

  it('ascends where the card sits BELOW the page, which is not the same as having no room', () => {
    /*
      THE CASE A MUTATION FOUND, and the reason the one above is not enough.

      Hardcoding the first direction to "down" leaves every other case in this
      file green, because the FALLBACK direction rescues it: where descending
      has no room the walk simply turns around, and the assertions above still
      hold. So nothing here proved the first direction was read off the card at
      all rather than being a constant.

      A store types its page and its panel colours independently and nothing
      makes the panel the lighter one — a recessed panel on a dark page is an
      ordinary thing to draw. Here BOTH directions have room, so the fallback
      cannot cover for a wrong first step, and the two answers differ: walking
      down lands the band at 16.3% lightness, wedged in the eight points
      between the panel and the page it is meant to be told apart from,
      clearing 1.12:1 against each by arithmetic while reading as neither.
      Walking up is the only one that puts it clear of both, on the side where
      there is nothing else.
    */
    const recessed = { ground: '#2A2A2E', card: '#141416' };
    const band = bandTone(SEEDS.lime, recessed.ground, recessed.card);

    expect(lightnessOf(band)).toBeGreaterThan(lightnessOf(recessed.ground));
    expect(bandToneSeparates(band, recessed.ground, recessed.card)).toBe(true);
  });

  it('keeps the seed hue — a darker green, never a different colour', () => {
    const band = bandTone(SEEDS.green, DEEP_RED.ground, DEEP_RED.card);
    const seedHue = hueOfHex(SEEDS.green);
    const bandHue = hueOfHex(band);

    expect(seedHue).not.toBeNull();
    expect(bandHue).not.toBeNull();
    expect(Math.abs((bandHue ?? 0) - (seedHue ?? 0))).toBeLessThan(2);
  });

  it('leaves a hueless seed hueless rather than inventing a tint', () => {
    const band = bandTone(SEEDS.grey, DEEP_RED.ground, DEEP_RED.card);
    const [r, g, b] = channelsOf(band);

    // A grey has no hue to tint with, and a fabricated one is a colour the
    // store never chose. `brandTone` makes the same argument.
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(2);
  });

  it('works on a LIGHT page, where the cards are the same white', () => {
    // No side to move away from, so it descends — which is what
    // `TINT_LIGHTNESS` has always done, reached by derivation instead.
    const band = bandTone(SEEDS.pink, '#FFFFFF', '#FFFFFF');

    expect(bandToneSeparates(band, '#FFFFFF', '#FFFFFF')).toBe(true);
  });
});

describe('what it refuses', () => {
  it('hands back the seed for a colour it cannot parse', () => {
    expect(bandTone('not-a-colour', DEEP_RED.ground, DEEP_RED.card)).toBe('not-a-colour');
  });

  it('hands back the seed when the GROUND cannot be parsed', () => {
    // The ground is what the offset is measured from, so an unparseable one
    // leaves nothing to derive against — better the seed than a fabricated
    // band on an unknown page.
    expect(bandTone(SEEDS.lime, 'rgb(0,0,0)', DEEP_RED.card)).toBe(SEEDS.lime);
  });

  it('hands back the ground when no tone in either direction separates', () => {
    // A mid grey page whose cards are an imperceptible step away: there is no
    // band that clears both, so the caller gets an invisible one rather than a
    // wrong one, and `bandToneSeparates` is how a screen says so.
    const ground = '#808080';
    const card = '#818181';
    const band = bandTone(SEEDS.grey, ground, card, [0.25, 0.6], 21);

    expect(band).toBe(ground);
    expect(bandToneSeparates(band, ground, card, 21)).toBe(false);
  });

  it('uses the documented separation floor by default', () => {
    expect(MIN_SURFACE_SEPARATION).toBe(1.12);
  });
});
