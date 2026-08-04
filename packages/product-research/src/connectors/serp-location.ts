/**
 * CEP → canonical SearchApi `location`, split out of serp.ts (FUT-518). The
 * tables below are DATA, not connector logic, and they are the file's bulk —
 * the same cut vtex-regions.ts already made off vtex.ts.
 *
 * SearchApi resolves `location` against Google's geo-target list, which is
 * CITY-level. The more precise the name we send, the closer the offers are to
 * the buyer, so a state name is a real loss of precision: it prices Belo
 * Horizonte and a town 600 km away inside Minas Gerais identically.
 *
 * WHAT IS AND IS NOT DERIVABLE OFFLINE — read this before extending the city
 * table. A CEP does not encode its municipality in any decodable way; the
 * authoritative CEP→localidade mapping is Correios' DNE, a licensed product
 * with no free, complete, redistributable equivalent. So there is no honest
 * way to answer "which city is this CEP" for all 5.570 municipalities here.
 * What IS published, and stable, is the contiguous prefix block Correios
 * allocates to each STATE CAPITAL — a capital's block is a single range
 * precisely because the plan grows outward from it.
 *
 * CEP_CITY_RANGES therefore holds capitals ONLY, and only those where two
 * independent published faixa-de-CEP tables state the SAME range
 * (ruacep.com.br/ddd/uf/capitais and cadcobol.com.br/faixa_de_ceps_do_brasil,
 * read 2026-07). Where the two disagreed the entry is narrowed to the range
 * they BOTH claim; where they disagreed on the block itself (Porto Velho) or
 * one table was self-evidently corrupt (Florianopolis) the capital is omitted
 * and keeps its state answer. Every retained range was additionally spot-
 * probed against a public CEP database and produced no CEP belonging to a
 * different municipality. That is weaker than DNE and the table is sized to
 * that confidence: it is not exhaustive and does not pretend to be.
 *
 * DELIBERATELY NOT DONE: a runtime CEP lookup (ViaCEP/BrasilAPI + SearchApi's
 * Locations API would give exact city names for free, but that is two extra
 * HTTP calls in the paid hot path, two new failure modes and an unbudgeted
 * third-party dependency — a vendor decision with its own ticket). Also not
 * done: `uule`, which SearchApi derives from `location` anyway and which still
 * needs the canonical name we would be missing.
 *
 * Non-capital CEPs, and capitals not listed here, keep exactly the state-level
 * answer they had before — this table can only make a location MORE precise,
 * never less.
 */

/** `[from, to, location]`, both bounds inclusive, matched on the CEP's first five digits. */
type CepRange = readonly [from: number, to: number, location: string];

/**
 * State-capital prefix blocks. The location string is the Google canonical
 * name minus its `,Brazil` tail, in the vendor's ASCII forms.
 *
 * Brasilia is absent ON PURPOSE and is not a gap: the Federal District is a
 * single municipality, so the state row below is already city-precise.
 */
const CEP_CITY_RANGES: readonly CepRange[] = [
  [1000, 5999, 'Sao Paulo,State of Sao Paulo'],
  [20000, 23799, 'Rio de Janeiro,State of Rio de Janeiro'],
  [29000, 29099, 'Vitoria,State of Espirito Santo'],
  [30000, 31999, 'Belo Horizonte,State of Minas Gerais'],
  [40000, 41999, 'Salvador,State of Bahia'],
  [49000, 49099, 'Aracaju,State of Sergipe'],
  [50000, 52999, 'Recife,State of Pernambuco'],
  [57000, 57099, 'Maceio,State of Alagoas'],
  [58000, 58099, 'Joao Pessoa,State of Paraiba'],
  [59000, 59099, 'Natal,State of Rio Grande do Norte'],
  [60000, 60999, 'Fortaleza,State of Ceara'],
  [64000, 64099, 'Teresina,State of Piaui'],
  [65000, 65099, 'Sao Luis,State of Maranhao'],
  [66000, 66999, 'Belem,State of Para'],
  [68900, 68914, 'Macapa,State of Amapa'],
  [69000, 69099, 'Manaus,State of Amazonas'],
  [69300, 69339, 'Boa Vista,State of Roraima'],
  [69900, 69920, 'Rio Branco,State of Acre'],
  [74000, 74894, 'Goiania,State of Goias'],
  [77000, 77270, 'Palmas,State of Tocantins'],
  [78000, 78109, 'Cuiaba,State of Mato Grosso'],
  [79000, 79129, 'Campo Grande,State of Mato Grosso do Sul'],
  [80000, 82999, 'Curitiba,State of Parana'],
  [90000, 91999, 'Porto Alegre,State of Rio Grande do Sul'],
];

/**
 * The state fallback. The official CEP plan allocates the first five digits by
 * state, so this table is a fixed fact, not a heuristic. Names are the
 * vendor's canonical ASCII forms.
 */
const CEP_STATE_RANGES: readonly CepRange[] = [
  [1000, 19999, 'State of Sao Paulo'],
  [20000, 28999, 'State of Rio de Janeiro'],
  [29000, 29999, 'State of Espirito Santo'],
  [30000, 39999, 'State of Minas Gerais'],
  [40000, 48999, 'State of Bahia'],
  [49000, 49999, 'State of Sergipe'],
  [50000, 56999, 'State of Pernambuco'],
  [57000, 57999, 'State of Alagoas'],
  [58000, 58999, 'State of Paraiba'],
  [59000, 59999, 'State of Rio Grande do Norte'],
  [60000, 63999, 'State of Ceara'],
  [64000, 64999, 'State of Piaui'],
  [65000, 65999, 'State of Maranhao'],
  [66000, 68899, 'State of Para'],
  [68900, 68999, 'State of Amapa'],
  [69000, 69299, 'State of Amazonas'],
  [69300, 69399, 'State of Roraima'],
  [69400, 69899, 'State of Amazonas'],
  [69900, 69999, 'State of Acre'],
  [70000, 72799, 'Federal District'],
  [72800, 72999, 'State of Goias'],
  [73000, 73699, 'Federal District'],
  [73700, 76799, 'State of Goias'],
  [76800, 76999, 'State of Rondonia'],
  [77000, 77999, 'State of Tocantins'],
  [78000, 78899, 'State of Mato Grosso'],
  [78900, 78999, 'State of Rondonia'],
  [79000, 79999, 'State of Mato Grosso do Sul'],
  [80000, 87999, 'State of Parana'],
  [88000, 89999, 'State of Santa Catarina'],
  [90000, 99999, 'State of Rio Grande do Sul'],
];

const matchRange = (ranges: readonly CepRange[], prefix: number): string | undefined =>
  ranges.find(([from, to]) => prefix >= from && prefix <= to)?.[2];

/**
 * The `location` for a region the pipeline passes: a Brazilian CEP maps to the
 * most specific place we can name for it — its capital when the prefix falls
 * in a capital's block, otherwise its state. Anything else (a generic host
 * passing a city) goes through verbatim; absent stays absent — gl=br still
 * localizes.
 */
export const regionToLocation = (region: string | undefined): string | undefined => {
  const trimmed = region?.trim();
  if (!trimmed) return undefined;
  const cep = /^(\d{5})(-?\d{3})?$/.exec(trimmed);
  if (!cep) return trimmed;
  const prefix = Number(cep[1]);
  // Most specific wins, and the state table is a total fallback, so no CEP can
  // come out of here with a WORSE location than it had before this table.
  const place = matchRange(CEP_CITY_RANGES, prefix) ?? matchRange(CEP_STATE_RANGES, prefix);
  return place === undefined ? undefined : `${place},Brazil`;
};
