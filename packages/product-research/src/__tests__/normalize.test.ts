import { describe, expect, it } from 'vitest';
import { parseMoneyToCents } from '../normalize/money';
import { parsePack } from '../normalize/pack';
import { shippingCentsFromText } from '../normalize/shipping';
import { normalizeText, tokenize, volumeTokenToMl } from '../normalize/text';
import { PT_BR_MARKET_VOCABULARY } from '../normalize/pt-BR';

describe('normalizeText / tokenize', () => {
  it('folds accents and case', () => {
    expect(normalizeText('Guaraná Antárctica')).toBe('guarana antarctica');
  });

  it('canonicalizes volume tokens', () => {
    expect(tokenize('Coca-Cola Lata 350 ml')).toContain('350ml');
    expect(tokenize('Refrigerante 2,5 L')).toContain('2,5l');
  });

  it('converts volume tokens to millilitres', () => {
    expect(volumeTokenToMl('350ml')).toBe(350);
    expect(volumeTokenToMl('2,5l')).toBe(2500);
    expect(volumeTokenToMl('1l')).toBe(1000);
    expect(volumeTokenToMl('abc')).toBeNull();
  });
});

describe('parseMoneyToCents', () => {
  it('parses pt-BR formatted prices', () => {
    expect(parseMoneyToCents('R$ 1.234,56')).toBe(123456);
    expect(parseMoneyToCents('R$4,29')).toBe(429);
    expect(parseMoneyToCents('1234,56')).toBe(123456);
  });

  it('parses en-US formatted and numeric prices', () => {
    expect(parseMoneyToCents('1,234.56')).toBe(123456);
    expect(parseMoneyToCents(11.99)).toBe(1199);
  });

  it('refuses non-prices', () => {
    expect(parseMoneyToCents('consulte')).toBeNull();
    expect(parseMoneyToCents(Number.NaN)).toBeNull();
  });
});

// FUT-518. The tri-state is the whole contract: 0 means the merchant SAID
// free, a number means the merchant QUOTED it, and undefined means the
// merchant said nothing a parser can trust. Only the third one is allowed to
// be reached by guessing.
describe('shippingCentsFromText', () => {
  it('reads free delivery in every casing, accent and verb the vendors send', () => {
    expect(shippingCentsFromText(['Entrega grátis'], PT_BR_MARKET_VOCABULARY)).toBe(0);
    expect(shippingCentsFromText(['Frete grátis'], PT_BR_MARKET_VOCABULARY)).toBe(0);
    expect(shippingCentsFromText(['FRETE GRATIS'], PT_BR_MARKET_VOCABULARY)).toBe(0);
    expect(shippingCentsFromText(['Envio grátis para todo o Brasil'], PT_BR_MARKET_VOCABULARY)).toBe(0);
    expect(shippingCentsFromText(['Entrega GRÁTIS: amanhã'], PT_BR_MARKET_VOCABULARY)).toBe(0);
  });

  it('reads a stated BRL amount, in the shapes a delivery line actually uses', () => {
    expect(shippingCentsFromText(['Frete: R$ 9,90'], PT_BR_MARKET_VOCABULARY)).toBe(990);
    expect(shippingCentsFromText(['+ R$ 12,00'], PT_BR_MARKET_VOCABULARY)).toBe(1200);
    expect(shippingCentsFromText(['Entrega por R$ 12,90'], PT_BR_MARKET_VOCABULARY)).toBe(1290);
    expect(shippingCentsFromText(['Frete: R$ 1.234,56'], PT_BR_MARKET_VOCABULARY)).toBe(123456);
  });

  it('leaves a delivery-time promise, a pickup line and silence unknown', () => {
    // A date is not a price, an in-store pickup is not a shipping statement,
    // and "consulte" is the merchant declining to say.
    expect(shippingCentsFromText(['Entrega em 2 dias'], PT_BR_MARKET_VOCABULARY)).toBeUndefined();
    expect(shippingCentsFromText(['Retirada na loja'], PT_BR_MARKET_VOCABULARY)).toBeUndefined();
    expect(shippingCentsFromText(['Consulte o frete'], PT_BR_MARKET_VOCABULARY)).toBeUndefined();
    expect(shippingCentsFromText([], PT_BR_MARKET_VOCABULARY)).toBeUndefined();
    expect(shippingCentsFromText([null, undefined, ''], PT_BR_MARKET_VOCABULARY)).toBeUndefined();
  });

  it('never reads an installment price as freight', () => {
    // The defect this ticket exists to remove: "R$ 3,79 em 12x" is a financing
    // term. Reporting 379 cents of shipping would invent a cost the merchant
    // never quoted — worse than reporting none.
    expect(shippingCentsFromText(['R$ 3,79 em 12x'], PT_BR_MARKET_VOCABULARY)).toBeUndefined();
    expect(shippingCentsFromText(['12x de R$ 3,20 sem juros'], PT_BR_MARKET_VOCABULARY)).toBeUndefined();
    expect(shippingCentsFromText(['em 3 parcelas de R$ 10,00'], PT_BR_MARKET_VOCABULARY)).toBeUndefined();
  });

  it('prefers a free-delivery claim over an amount stated beside it', () => {
    // A merchant showing both is running a promotion over its table price, and
    // the promotion is what the buyer pays today.
    expect(shippingCentsFromText(['Frete: R$ 19,90', 'Frete grátis nesta compra'], PT_BR_MARKET_VOCABULARY)).toBe(0);
  });

  /**
   * The understatement this ticket exists to remove, in its commonest live
   * shape. "Free above R$ 79" is not free for the single unit a price search
   * usually prices: the buyer meets the real freight at checkout, after the
   * offer has already won cheapest-first. Unknown can be caveated on the
   * surface; a confident zero cannot.
   */
  it('treats free-above-a-minimum as UNKNOWN, never as free', () => {
    expect(shippingCentsFromText(['Frete GRÁTIS em pedidos acima de R$ 79'], PT_BR_MARKET_VOCABULARY)).toBeUndefined();
    expect(shippingCentsFromText(['Frete grátis a partir de R$ 199'], PT_BR_MARKET_VOCABULARY)).toBeUndefined();
    expect(shippingCentsFromText(['Entrega grátis para compras acima de R$ 100'], PT_BR_MARKET_VOCABULARY)).toBeUndefined();
    expect(shippingCentsFromText(['Frete grátis (pedido mínimo R$ 50)'], PT_BR_MARKET_VOCABULARY)).toBeUndefined();
    // A conditional claim must not be rescued by an amount stated beside it —
    // that amount is the MINIMUM, not the freight.
    expect(
      shippingCentsFromText(['Frete grátis acima de R$ 79', 'Frete: R$ 14,90'], PT_BR_MARKET_VOCABULARY),
    ).toBeUndefined();
    // ...and the guard must not swallow an UNCONDITIONAL claim that merely
    // names a region.
    expect(shippingCentsFromText(['Frete grátis para todo o Brasil'], PT_BR_MARKET_VOCABULARY)).toBe(0);
  });
});

describe('parsePack', () => {
  it('reads NxV packs', () => {
    expect(parsePack('Coca-Cola Fardo 12x350ml')).toEqual({ units: 12, unitVolumeMl: 350 });
    expect(parsePack('Cerveja 6 x 269 ml')).toEqual({ units: 6, unitVolumeMl: 269 });
  });

  it('reads word packs', () => {
    expect(parsePack('Guaraná caixa com 24 latas 350ml').units).toBe(24);
    expect(parsePack('Energético pack com 6 unidades 473ml').units).toBe(6);
  });

  it('defaults to a single unit with the stated volume', () => {
    expect(parsePack('Coca-Cola Original Lata 350ml')).toEqual({ units: 1, unitVolumeMl: 350 });
    expect(parsePack('Água mineral')).toEqual({ units: 1, unitVolumeMl: undefined });
  });

  // FUT-436 vocabulary breadth: realistic pt-BR pack phrasings, each shape a
  // store was actually seen using.
  it('reads a bare "fardo 12x350ml" (no "com")', () => {
    expect(parsePack('fardo 12x350ml')).toEqual({ units: 12, unitVolumeMl: 350 });
  });

  it('reads "Pack com 6 Unidades" case-insensitively', () => {
    expect(parsePack('Pack com 6 Unidades').units).toBe(6);
  });

  it('reads a bare "6 unidades" with no pack word at all', () => {
    expect(parsePack('6 unidades').units).toBe(6);
  });

  it('reads "caixa com 12 latas"', () => {
    expect(parsePack('caixa com 12 latas').units).toBe(12);
  });

  it('reads engradado shapes — counted, abbreviated and NxV', () => {
    expect(parsePack('Engradado com 24 garrafas 600ml')).toEqual({ units: 24, unitVolumeMl: 600 });
    // "c/" collapses to "c" in normalization; engradado is a pack word too.
    expect(parsePack('Engradado c/ 24').units).toBe(24);
    expect(parsePack('Engradado Coca-Cola Retornável 24x600ml')).toEqual({
      units: 24,
      unitVolumeMl: 600,
    });
  });

  it('is not fooled by the "Leve Mais Pague Menos" marketing suffix', () => {
    // The FUT-436 production title: "leve" is marketing, "6 unidades" is the pack.
    expect(
      parsePack(
        'Refrigerante sem Açúcar Coca-Cola Lata 6 Unidades 350ml Cada Leve Mais Pague Menos',
      ),
    ).toEqual({ units: 6, unitVolumeMl: 350 });
    // No pack stated at all: the suffix must not invent one.
    expect(parsePack('Coca-Cola Lata 350ml Leve Mais Pague Menos')).toEqual({
      units: 1,
      unitVolumeMl: 350,
    });
  });

  // Vocabulary broadening below: every shape was harvested from live wholesale
  // VTEX listings (Atacadão catalog API, 2026-07-29) or is its standard
  // grocery variant — not invented phrasings.
  it('reads NxV packs measured in grams — count without a liquid volume', () => {
    // Live: "Creme de Leite Nestlé 27x200g" — previously parsed as 1 unit,
    // pricing the sachet 27x too high.
    expect(parsePack('Creme de Leite Nestlé 27x200g')).toEqual({
      units: 27,
      unitVolumeMl: undefined,
    });
    expect(parsePack('Leite em Pó Ninho Integral 24x380g').units).toBe(24);
    expect(parsePack('Açúcar Cristal Minissachê 400x5g').units).toBe(400);
  });

  it('reads wholesale abbreviations cx/fd/pct/emb', () => {
    expect(parsePack('Cerveja Lata 350ml CX C/ 15').units).toBe(15);
    expect(parsePack('Refrigerante 2LT FD C/ 6').units).toBe(6);
    expect(parsePack('Copo Descartável 180ml PCT C/ 100').units).toBe(100);
    expect(parsePack('Papel Toalha EMB C/ 2 rolos').units).toBe(2);
  });

  // FUT-497: "c/" is the abbreviation for "com". The compound forms already
  // parsed through the container-word arm; the BARE one did not, and shipped a
  // 12-can box as a single R$ 39,83 can in live production data.
  it('reads a bare "C/N" with no container word in front of it', () => {
    expect(parsePack('Refri Coca Cola S/Açúcar 220ml C/12')).toEqual({
      units: 12,
      unitVolumeMl: 220,
    });
    expect(parsePack('Refrigerante Coca Cola Lata 220ml c/ 12').units).toBe(12);
    expect(parsePack('Refrigerante Coca Cola Lata 220ml c/12').units).toBe(12);
    expect(parsePack('Copo Descartável 180ml C / 100').units).toBe(100);
  });

  it('reads the compound "cx/fd/caixa c/N" forms beside it', () => {
    expect(parsePack('Refrigerante Coca Cola 220ml CX C/12').units).toBe(12);
    expect(parsePack('Refrigerante Coca Cola 2LT FD C/6').units).toBe(6);
    expect(parsePack('Cerveja Lata 350ml Caixa C/ 24').units).toBe(24);
  });

  it('does not let a bare "C/" swallow a size, a code or a discount', () => {
    // No number at all — nothing to count.
    expect(parsePack('Detergente Neutro C/ML').units).toBe(1);
    expect(parsePack('Sabão em Pó C/KG').units).toBe(1);
    expect(parsePack('Guardanapo Folha Dupla C/').units).toBe(1);
    // A measure after the count is a container size, not a unit count.
    expect(parsePack('Água Sanitária C/2L')).toEqual({ units: 1, unitVolumeMl: 2000 });
    expect(parsePack('Arroz Branco C/ 5kg').units).toBe(1);
    // Four digits with no pack or unit word: a product code, not a 1234-pack.
    expect(parsePack('Filtro de Papel Melitta C/1234').units).toBe(1);
    // A percentage is a discount, and a decimal is a specification.
    expect(parsePack('Refrigerante Lata 350ml c/ 10% off').units).toBe(1);
    expect(parsePack('Leite Integral c/ 3,25% de gordura').units).toBe(1);
    // A stray letter C is not the abbreviation — the slash is what makes it one.
    expect(parsePack('Vitamina C 1000mg').units).toBe(1);
    expect(parsePack('Ácido Fólico Vitamina C 500 comprimidos').units).toBe(1);
  });

  it('keeps the container-word arm ahead of the bare one', () => {
    // "Kit 2" is the pack; the trailing "c/12" describes the kit's contents.
    expect(parsePack('Kit 2 Refrigerante Coca Cola Lata 220ml c/12').units).toBe(2);
  });

  it('keeps the UNIT-word arm ahead of the bare one too', () => {
    // An explicit unit count describes the pack; the "c/ N" after it describes
    // what is IN each one. Reading the second understates the per-unit price by
    // the whole factor — 30x for the bobina below — and an understated unit
    // price WINS cheapest-first, so this precedence is the load-bearing half of
    // the bare arm.
    expect(parsePack('Papel Higiênico Neve Folha Dupla 12 Rolos C/ 30 Metros').units).toBe(12);
    expect(parsePack('Papel Toalha Bobina 2 Rolos C/ 200 Metros').units).toBe(2);
    expect(parsePack('Fita Adesiva 6 Unidades C/ 50 Metros').units).toBe(6);
    // Where the two agree, the answer is the same through either arm.
    expect(parsePack('Refrigerante Coca Cola Lata 220ml C/ 24 Unidades').units).toBe(24);
  });

  it('does not let a bare "C/" swallow a spelled-out or spec measure', () => {
    // Titles with NO unit count of their own, so precedence cannot save them:
    // the number after "c/" is a length, a spec or a voltage.
    expect(parsePack('Filme PVC Esticável C/ 30 Metros').units).toBe(1);
    expect(parsePack('Fio Dental C/ 50 Metros').units).toBe(1);
    expect(parsePack('Corda de Nylon C/ 10 mts').units).toBe(1);
    expect(parsePack('Notebook Dell Inspiron 15 C/ 8GB RAM').units).toBe(1);
    expect(parsePack('Pen Drive C/ 64GB').units).toBe(1);
    expect(parsePack('Smart TV 50" C/ 4K').units).toBe(1);
    expect(parsePack('Cabo de Força C/ 220V').units).toBe(1);
    expect(parsePack('Micro-ondas C/ 1400W').units).toBe(1);
    expect(parsePack('Ar Condicionado C/ 12000 BTUs').units).toBe(1);
  });

  it('takes a bare count only when nothing but punctuation follows it', () => {
    // The count must end the phrase. Another word after "c/ N" makes N that
    // word's quantity: two clamps in the bag, not two hoses.
    expect(parsePack('Mangueira de Gás 1,20m C/ 2 Abraçadeiras').units).toBe(1);
    // Conservative by design: an unrecognized noun after the count yields 1
    // (a per-unit price that is too high, and visible) rather than a guess.
    expect(parsePack('Guardanapo C/ 50 Folhas').units).toBe(1);
    // Trailing punctuation and a supplier suffix are not "another word".
    expect(parsePack('Refri Coca Cola S/Açúcar 220ml C/12 - Nova Limp').units).toBe(12);
  });

  it('caps a bare count at a gross, above which it reads as a volume', () => {
    // 750 with no pack or unit word beside it is the bottle, not 750 bottles.
    expect(parsePack('Vinho Tinto Seco C/750').units).toBe(1);
    expect(parsePack('Refrigerante C/600').units).toBe(1);
    // A gross itself still counts, and so does everything below it.
    expect(parsePack('Saquinho de Pão C/144').units).toBe(144);
    expect(parsePack('Copo Descartável 180ml C/100').units).toBe(100);
    // The 4-digit ceiling stays on the arms that HAVE a pack or unit word.
    expect(parsePack('Toalha Interfolhada 1000 un').units).toBe(1000);
  });

  it('vetoes a spelled-out measure after a container word as well', () => {
    // The widened veto tightens the pre-existing container arm for free: a box
    // of 100-metre wire is one box, not a hundred.
    expect(parsePack('Fio Flexível 2,5mm Caixa 100 Metros').units).toBe(1);
  });

  it('reads display / bandeja / grade / lote / embalagem / saco counts', () => {
    expect(parsePack('Chiclete Display c/ 16').units).toBe(16);
    expect(parsePack('Ovos Brancos Bandeja com 30 ovos').units).toBe(30);
    expect(parsePack('Cerveja 600ml Grade com 24 garrafas').units).toBe(24);
    expect(parsePack('Energético Lote 10 unidades').units).toBe(10);
    expect(parsePack('Água Mineral Embalagem com 12').units).toBe(12);
    expect(parsePack('Copo Bolha 770ml Saco c/ 50').units).toBe(50);
  });

  it('reads dúzia phrasings', () => {
    expect(parsePack('Ovos Caipira Meia Dúzia').units).toBe(6);
    expect(parsePack('Ovos Brancos Dúzia').units).toBe(12);
    expect(parsePack('Ovos Vermelhos 2 Dúzias').units).toBe(24);
  });

  it('reads counts above 999', () => {
    // Live: "Toalha de Papel Extrusa-Pack Interfolhadas Branca 1000 un".
    expect(parsePack('Toalha de Papel Interfolhada Branca 1000 un').units).toBe(1000);
  });

  it('does not read a measure after the count as a pack size', () => {
    // "fardo 30kg" is one 30kg bale, not 30 units.
    expect(parsePack('Arroz Branco Fardo 30kg').units).toBe(1);
    expect(parsePack('Suco de Uva Caixa 2l')).toEqual({ units: 1, unitVolumeMl: 2000 });
    // "2 em 1" is a product type, not a 2-pack.
    expect(parsePack('Shampoo Kit 2 em 1 350ml').units).toBe(1);
  });

  it('is not fooled by physical dimensions in titles', () => {
    // Live: napkin listings state sheet dimensions and then the real count.
    expect(parsePack('Guardanapo de Papel Snob 32x30cm 50 un').units).toBe(50);
    expect(parsePack('Guardanapo Residence 30x29,5cm 50 un').units).toBe(50);
  });
});
