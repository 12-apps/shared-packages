import type { MarketVocabulary } from './vocabulary';

/**
 * The Brazilian pack — a NAMED constant a host passes by hand, never a
 * default.
 *
 * The filename is what exempts this file from the copy-portability gate:
 * Portuguese may ship, it may not be silent. Every pattern is VERBATIM what
 * the readers used to hold privately, so a host adopting it parses exactly
 * what it parsed before — what changes is that the market is chosen in a diff.
 */
export const PT_BR_MARKET_VOCABULARY: MarketVocabulary = {
  outOfStock: /esgotado|fora de estoque|sem estoque|n[ãa]o dispon[ií]vel|indispon[ií]vel/i,
  inStock: /em estoque|pronta entrega|dispon[ií]vel/i,
  freeDelivery: /(?:frete|entrega|envio)\s+gratis/,
  conditionalFree: /\b(?:acima|a partir|para compras|minimo)\b/,
  installment: /\d+\s*x\b|sem\s+juros|parcela/i,
  sameDay: /\bhoje\b/,
  nextDay: /\bamanha\b/,
  headerAliases: {
    title: ['produto', 'descricao', 'descrição', 'item', 'nome', 'product', 'title'],
    price: ['preco', 'preço', 'valor', 'price', 'r$', 'preco unitario', 'preço unitário'],
    supplierName: ['fornecedor', 'distribuidor', 'supplier'],
    brand: ['marca', 'brand'],
    ean: ['ean', 'gtin', 'codigo de barras', 'código de barras', 'barcode'],
    packQuantity: ['embalagem', 'pack', 'qtd por caixa', 'unidades por caixa', 'fardo'],
    validUntil: ['validade', 'valido ate', 'válido até', 'valid until'],
  },
};
