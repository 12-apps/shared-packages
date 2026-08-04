/**
 * Recorded Giga Atacado catalog answer — the shape captured from the live
 * `https://www.giga.com.vc/api/catalog_system/pub/products/search` API on
 * 2026-07-28, trimmed to the fields the parser reads plus typical noise.
 *
 * Shared evidence: the connector unit suite parses it, and the pipeline
 * fixture run (FUT-416) proves ranked offers come back for the seeded drink
 * catalog with no live network anywhere in CI.
 */
export const GIGA_FIXTURE = [
  {
    productId: '5613',
    productName: 'Coca-Cola Original 350Ml',
    brand: 'Coca-Cola',
    linkText: 'coca-cola-original-350ml',
    link: 'https://www.giga.com.vc/coca-cola-original-350ml/p',
    categories: ['/Bebidas/Refrigerantes/'],
    items: [
      {
        itemId: '5613',
        name: 'Coca-Cola Original 350Ml',
        ean: '7894900011517',
        images: [{ imageUrl: 'https://giga.vteximg.com.br/arquivos/ids/1/coca350.png' }],
        sellers: [
          {
            sellerId: '1',
            sellerName: 'Giga Atacado',
            commertialOffer: { Price: 3.59, ListPrice: 3.99, AvailableQuantity: 99999 },
          },
        ],
      },
    ],
  },
  {
    productId: '9911',
    productName: 'Refrigerante Coca-Cola Pet 2.5L',
    brand: 'Coca-Cola',
    linkText: 'refrigerante-coca-cola-pet-25l',
    items: [
      {
        itemId: '9911',
        name: 'Refrigerante Coca-Cola Pet 2.5L',
        ean: '7894900027013',
        images: [],
        sellers: [
          {
            sellerId: '1',
            sellerName: 'Giga Atacado',
            commertialOffer: { Price: 11.99, ListPrice: 11.99, AvailableQuantity: 12 },
          },
        ],
      },
    ],
  },
  {
    productId: '7777',
    productName: 'Coca-Cola Esgotada 310Ml',
    linkText: 'coca-cola-esgotada',
    items: [
      {
        itemId: '7777',
        name: 'Coca-Cola Esgotada 310Ml',
        sellers: [
          { sellerId: '1',
            sellerName: 'Giga Atacado', commertialOffer: { Price: 4.29, AvailableQuantity: 0 } },
        ],
      },
    ],
  },
];
