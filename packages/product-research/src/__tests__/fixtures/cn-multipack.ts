/**
 * Recorded Google Shopping (SearchApi.io `google_shopping`) answer for the term
 * "coca cola 220ml", captured from LIVE production run
 * 6d942a66-add9-45a2-91d1-bf62d9ed27da (tenant future-drink, 2026-07-30) —
 * trimmed to the fields the SERP connector reads plus typical noise.
 *
 * The two offers FUT-497 is about are the first two, verbatim:
 *
 * 1. "Refri Coca Cola S/Açúcar 220ml C/12" (Nova Limp) at R$ 39,83 — a
 *    TWELVE-can box whose count is written only as "C/12". It ranked as a
 *    single R$ 39,83 can; the true unit price is 3983 / 12 = 332 cents.
 * 2. "Refrigerante Coca Cola Zero Açúcar 220ml" (Na Sua Casa Por Coca-Cola) at
 *    R$ 32,28 — the title carries NO count at all. The pack size exists only in
 *    the vendor's listing, so no parser can recover it: this is the offer the
 *    plausibility guard exists for.
 *
 * The rest are the same run's correctly-parsed offers, kept so the fixture has
 * a real median unit price (R$ 2,90) and so the shapes that already worked
 * ("FD 6 latas", "Pack com 12 unidades", "Embalagem com 12 unidades", "Kit 2",
 * plain cans) are pinned against regression by the same evidence.
 */

interface ShoppingResultFixture {
  title: string;
  seller: string;
  link: string;
  price: string;
  extracted_price: number;
  currency: string;
  delivery?: string;
  extensions?: string[];
}

export const CN_MULTIPACK_TITLE = 'Refri Coca Cola S/Açúcar 220ml C/12';
export const UNTITLED_PACK_TITLE = 'Refrigerante Coca Cola Zero Açúcar 220ml';

export const CN_MULTIPACK_FIXTURE: { shopping_results: ShoppingResultFixture[] } = {
  shopping_results: [
    {
      title: CN_MULTIPACK_TITLE,
      seller: 'Nova Limp',
      link: 'https://www.novalimp.com.br/produto/refri-coca-cola-s-acucar-220ml-c-12',
      price: 'R$ 39,83',
      extracted_price: 39.83,
      currency: 'BRL',
      delivery: 'Entrega grátis',
    },
    {
      title: UNTITLED_PACK_TITLE,
      seller: 'Na Sua Casa Por Coca-Cola',
      link: 'https://www.nasuacasa.com.br/refrigerante-coca-cola-zero-acucar-220ml',
      price: 'R$ 32,28',
      extracted_price: 32.28,
      currency: 'BRL',
      extensions: ['Em estoque'],
    },
    {
      title: 'Refrigerante Coca Cola Original Lata 220ml',
      seller: 'Mercado Mineiro',
      link: 'https://www.mercadomineiro.com.br/coca-cola-original-lata-220ml',
      price: 'R$ 2,90',
      extracted_price: 2.9,
      currency: 'BRL',
      delivery: 'Entrega em 2 dias',
    },
    {
      title: 'Refrigerante Coca Cola Zero Lata 220ml',
      seller: 'Sacolão do Povo',
      link: 'https://www.sacolaodopovo.com.br/coca-cola-zero-lata-220ml',
      price: 'R$ 2,79',
      extracted_price: 2.79,
      currency: 'BRL',
      extensions: ['Em estoque'],
    },
    {
      title: 'Refrigerante Coca Cola Lata 220ml FD 6 latas',
      seller: 'Distribuidora Sul',
      link: 'https://www.distribuidorasul.com.br/coca-cola-lata-220ml-fd-6-latas',
      price: 'R$ 17,40',
      extracted_price: 17.4,
      currency: 'BRL',
      delivery: 'Entrega grátis',
    },
    {
      title: 'Coca Cola Lata 220ml Pack com 12 unidades',
      seller: 'Atacadão Bebidas',
      link: 'https://www.atacadaobebidas.com.br/coca-cola-lata-220ml-pack-12',
      price: 'R$ 34,80',
      extracted_price: 34.8,
      currency: 'BRL',
      delivery: 'Entrega em 3 dias',
    },
    {
      title: 'Refrigerante Coca Cola 220ml Embalagem com 12 unidades',
      seller: 'Casa das Bebidas',
      link: 'https://www.casadasbebidas.com.br/coca-cola-220ml-embalagem-12',
      price: 'R$ 33,48',
      extracted_price: 33.48,
      currency: 'BRL',
      extensions: ['Em estoque'],
    },
    {
      title: 'Kit 2 Refrigerante Coca Cola Lata 220ml',
      seller: 'Empório Central',
      link: 'https://www.emporiocentral.com.br/kit-2-coca-cola-lata-220ml',
      price: 'R$ 5,80',
      extracted_price: 5.8,
      currency: 'BRL',
      delivery: 'Entrega em 4 dias',
    },
  ],
};
