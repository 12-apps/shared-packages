import { normalizeText, volumeTokenToMl, tokenize } from './text';

export interface PackInfo {
  units: number;
  unitVolumeMl?: number;
}

const UNIT_WORDS = 'un|und|unid|unidades?|latas?|garrafas?|pacotes?|itens|pcs?|rolos?|ovos|saches?|capsulas?';

// Container words that precede a count in pt-BR commerce titles, including the
// wholesale abbreviations (cx/fd/pct/emb) atacado listings glue onto "c/ N".
const PACK_WORDS =
  'fardos?|caixas?|cx|fd|packs?|pct|pacotes?|kits?|cartelas?|engradados?|grades?|embalage(?:m|ns)|emb|displays?|bandejas?|lotes?|combos?|sacos?|sacolas?|leve';

// A count immediately followed by a measure is a container size, not a unit
// count: "fardo 30kg" is one 30kg bale, "caixa 2l" one 2-litre carton, and
// "kit 2 em 1" one product. Without this veto those would price 30x/2x off.
//
// The SPELLED-OUT and spec measures earn their place next to the abbreviations:
// "c/ 30 metros" is a roll length, "c/ 8gb" a spec, "c/ 220v" a voltage, and
// none of them is a pack of 30, 8 or 220. `m\b` never covered "metros" (no
// boundary between the m and the e), so "c/30m" was rejected while "c/ 30
// metros" sailed through — and the same hole let "caixa 100 metros" read as a
// 100-pack long before this arm existed.
const MEASURE_VETO =
  '(?!\\s*(?:ml|l|lts?|litros?|g|gr|gramas?|kg|quilos?|cm|mm|m|metros?|mts?|pol|polegadas?|gb|mb|tb|kw|w|v|k|btus?|em)\\b)';

/**
 * A BARE "c/ N" — the pt-BR abbreviation for "com N" — with no container word
 * in front of it: "… 220ml C/12" (FUT-497, live Google Shopping). Read against
 * the RAW title on purpose: `normalizeText` turns the slash into a space, and
 * that slash is the only thing separating "C/12" (twelve units) from a stray
 * letter C ("Vitamina C 1000mg", "Ácido Fólico c 500"). The compound forms
 * ("cx c/12", "fd c/6", "caixa c/ 24") already parse through the PACK_WORDS
 * arm, which keeps its precedence — this arm only covers the naked one.
 *
 * It is the WEAKEST evidence in the vocabulary — "com N" introduces whatever
 * the seller thought worth mentioning, and only sometimes a pack count — so it
 * runs LAST (after the unit-word arm) and is fenced on every side:
 *
 * - a digit is required, so "C/ML", "C/KG" and a bare "C/" never match;
 * - MEASURE_VETO applies, so "C/2L" stays one 2-litre item and "C/ 8GB",
 *   "C/ 220V", "C/ 30 metros" stay one item with a spec;
 * - a "%" after the number is rejected ("c/ 10% off" is a discount), as is a
 *   decimal or thousands separator ("c/ 3,25% de gordura", "c/1.000");
 * - the count must END the phrase — nothing but punctuation or the end of the
 *   title may follow it. Any other word after "c/ N" makes N that word's
 *   quantity, not the product's: "C/ 2 Abraçadeiras" is a hose with two clamps
 *   in the bag, "C/ 30 Metros" a single roll. This allow-list is why the arm
 *   cannot swallow a measure we forgot to enumerate above;
 * - THREE digits max, and no more than `MAX_BARE_PACK_COUNT`.
 *
 * Both ceilings bias the same way on purpose. Under-counting shows a per-unit
 * price that is too HIGH, which loses a ranking place and can be caught by the
 * plausibility guard; over-counting shows one that is too LOW, which WINS
 * cheapest-first and is presented to the buyer as the recommendation.
 */
const BARE_WITH_COUNT = new RegExp(
  `(?:^|[^\\p{L}\\p{N}])c\\s*/\\s*(\\d{1,3})(?!\\d)(?![.,]\\d)${MEASURE_VETO}(?!\\s*%)(?=\\s*(?:$|[^\\p{L}\\p{N}\\s]))`,
  'iu',
);

/**
 * The most a bare "c/ N" may claim: a gross (twelve dozen), the largest count
 * pt-BR retail actually packs. Past it a three-digit number with no pack or
 * unit word beside it is an implied volume ("Vinho Tinto Seco C/750") or a
 * supplier code far more often than a 750-unit pack. Counts with such a word
 * keep the \d{1,4} ceiling of their own arm — "1000 un" still reads 1000.
 */
const MAX_BARE_PACK_COUNT = 144;

/** The bare arm's verdict: its count, or 1 when it declines to guess. */
const bareWithCount = (title: string): number => {
  const match = BARE_WITH_COUNT.exec(title);
  const count = match === null ? 0 : Number(match[1]);
  return count > 0 && count <= MAX_BARE_PACK_COUNT ? count : 1;
};

/**
 * How many sellable units an offer title describes, and the unit volume when
 * stated — the input for unit-price normalization so "fardo 12x350ml" competes
 * with a single 350ml can on the same axis.
 *
 * Recognized shapes (pt-BR commerce, verified against live wholesale VTEX
 * listings): "12x350ml", "27x200g", "fardo com 12", "cx c/ 6", "fd c/ 15",
 * "pct c/ 100", "pack com 6 unidades", "engradado c/ 24", "display c/ 16",
 * "bandeja com 30 ovos", "meia dúzia", "2 dúzias", "leve 12", "1000 un",
 * "220ml C/12" (a bare "com N", FUT-497).
 */
export const parsePack = (title: string): PackInfo => {
  const text = normalizeText(title);

  // Count × per-unit size. Grams count units too ("27x200g" is 27 sachets),
  // but only liquid volumes yield a comparable unitVolumeMl.
  const nxv = /(\d{1,4})\s*x\s*(\d+(?:[.,]\d+)?)\s*(ml|l|g|kg)\b/.exec(text);
  if (nxv) {
    const units = Number(nxv[1]);
    const unitVolumeMl = volumeTokenToMl(`${nxv[2]}${nxv[3]}`);
    if (units > 0) return { units, unitVolumeMl: unitVolumeMl ?? undefined };
  }

  const units = parseWordCount(text, title);

  const volume = tokenize(title)
    .map(volumeTokenToMl)
    .find((ml) => ml !== null);

  return { units: units > 0 ? units : 1, unitVolumeMl: volume ?? undefined };
};

/**
 * `text` is the normalized title (the arms below are written against it);
 * `title` is the raw one, which the bare "c/ N" arm needs for its slash.
 */
const parseWordCount = (text: string, title: string): number => {
  // "meia dúzia" must run before the dozen arm, which would read it as 12.
  if (/\bmeia\s+duzia\b/.test(text)) return 6;

  const dozens = /\b(\d{1,2})?\s*duzias?\b/.exec(text);
  if (dozens) return (dozens[1] === undefined ? 1 : Number(dozens[1])) * 12;

  const withWords = new RegExp(
    `\\b(?:${PACK_WORDS})\\s*(?:com|c)?\\s*(\\d{1,4})${MEASURE_VETO}(?:\\s*(?:${UNIT_WORDS}))?\\b`,
  ).exec(text);
  if (withWords) return Number(withWords[1]);

  const nUnits = new RegExp(`\\b(\\d{1,4})\\s*(?:${UNIT_WORDS})\\b`).exec(text);
  if (nUnits) return Number(nUnits[1]);

  // LAST. An explicit unit count outranks a bare "com N", because a title that
  // states both is describing the pack with the first and its contents with the
  // second: "12 Rolos C/ 30 Metros" is twelve rolls of thirty metres, and the
  // arm that reads 30 there understates the per-roll price 30-fold. Only titles
  // with no count of their own — the FUT-497 shape, "… 220ml C/12" — reach here.
  return bareWithCount(title);
};
