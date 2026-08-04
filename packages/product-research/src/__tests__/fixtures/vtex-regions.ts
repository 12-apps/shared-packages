/**
 * Recorded VTEX regionalization answers, captured live on 2026-07-29 and
 * trimmed to the fields the parser reads plus typical noise.
 *
 * - Regions API (`/api/checkout/pub/regions?country=BRA&postalCode=…`):
 *   a store that regionalizes by seller answers with a serving seller; a store
 *   that does NOT answers with a region carrying an empty sellers list. That
 *   second answer was long read as "does not deliver here" and does not mean it
 *   (FUT-514) — see `GIGA_REGIONS_NO_SELLERS`.
 * - Intelligent-search API (`/api/io/_v/api/intelligent-search/product_search`
 *   with `regionId`): Atacadão prices the SAME can (EAN 7894900010015) at
 *   R$ 3,79 for the São Paulo region and R$ 3,99 for the Rio region, and one
 *   Zero SKU sold in São Paulo comes back Price 0 / quantity 0 in Rio — the
 *   regional price AND assortment differences this feature exists to honor.
 */

export const GIGA_REGIONS_SERVED = [
  {
    id: 'v2.B4F9FF8D620B741A59BA5A1EF2946104',
    sellers: [
      {
        id: 'gigavc901',
        name: 'gigavc901',
        logo: 'https://gigavc.vtexassets.com/assets/vtex.file-manager-graphql/images/e33691b7.png',
      },
    ],
  },
];

/**
 * A region with NO sellers — VTEX's "this store does not regionalize by seller"
 * answer, NOT a refusal to deliver (FUT-514). The id is verbatim from live
 * traffic and is the tell: Apoio Entrega returns this exact body for a CEP it
 * demonstrably delivers to AND for one 3000 km away, and Giga Atacado returns
 * the SAME id — which no two real regions could share.
 */
export const GIGA_REGIONS_NO_SELLERS = [
  { id: 'v2.1BB18CE648B5111D0933734ED83EC783', sellers: [] },
];

const atacadaoProduct = (price: number, available: number) => ({
  productId: '38118',
  productName: 'Refrigerante Coca-Cola 350ml',
  brand: 'Coca-Cola',
  linkText: 'refrigerante-coca-cola-lata-com-350ml-7699',
  items: [
    {
      itemId: '38118',
      name: 'Refrigerante Coca-Cola 350ml',
      ean: '7894900010015',
      images: [{ imageUrl: 'https://atacadaobr.vtexassets.com/arquivos/ids/972134/g.jpg' }],
      sellers: [
        {
          sellerId: '1',
          sellerName: 'ATACADAO SA',
          commertialOffer: { Price: price, ListPrice: price, AvailableQuantity: available },
        },
      ],
    },
  ],
});

const atacadaoZeroSku = (price: number, available: number) => ({
  productId: '3965',
  productName: 'Refrigerante Coca-Cola Zero Açúcar 350ml',
  brand: 'Coca-Cola',
  linkText: 'refrigerante-coca-cola-zero-acucar-40669',
  items: [
    {
      itemId: '3965',
      name: 'Refrigerante Coca-Cola Zero Açúcar 350ml',
      ean: '40669964',
      images: [{ imageUrl: 'https://atacadaobr.vtexassets.com/arquivos/ids/1357329/g.jpg.jpg' }],
      sellers: [
        {
          sellerId: '1',
          sellerName: 'ATACADAO SA',
          commertialOffer: { Price: price, ListPrice: price, AvailableQuantity: available },
        },
      ],
    },
  ],
});

/** São Paulo region: the can at R$ 3,79, the Zero SKU sold at R$ 3,67. */
export const ATACADAO_IS_SAO_PAULO = {
  products: [atacadaoProduct(3.79, 10000), atacadaoZeroSku(3.67, 10000)],
};

/** Rio region: the SAME can at R$ 3,99; the Zero SKU not sold there (0/0). */
export const ATACADAO_IS_RIO = {
  products: [atacadaoProduct(3.99, 10000), atacadaoZeroSku(0, 0)],
};
