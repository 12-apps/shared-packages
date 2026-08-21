import type { DiscountsServerCopy } from "./copy";

/**
 * The pt-BR pack — a NAMED export a host passes by hand
 * (`copy: PT_BR_DISCOUNTS_SERVER_COPY`), never a default. The filename is what
 * exempts this file from the copy-portability gate: Portuguese may ship, it
 * may not be silent.
 *
 * Every sentence names what the operator must change, because these are form
 * errors: the route reports them with the offending FIELD alongside, so an
 * admin form can paint that input rather than only flashing a banner.
 */
export const PT_BR_DISCOUNTS_SERVER_COPY: DiscountsServerCopy = {
  invalidQuery: "Parâmetros de consulta inválidos.",
  notFound: "Desconto não encontrado.",
  invalidPercent: "Informe uma porcentagem maior que 0 e no máximo 100.",
  invalidAmount: "Informe um valor de desconto maior que zero.",
  codeRequired: "Informe o código do cupom que o cliente vai digitar.",
  categoryTargetRequired: "Selecione ao menos uma categoria para este desconto.",
  itemTargetRequired: "Selecione ao menos um produto para este desconto.",
  invalidDate: "Data inválida. Use o formato AAAA-MM-DD.",
  endsBeforeStarts: "A data de término deve ser posterior à data de início.",
  invalidMinSubtotal: "O pedido mínimo deve ser maior que zero (ou deixe em branco).",
  invalidUsageLimit: "O limite de usos deve ser maior que zero (ou deixe em branco).",
  invalidPerBuyerLimit: "O limite por cliente deve ser maior que zero (ou deixe em branco).",
  comboScopeRequired: "Preço de combo e itens grátis só valem para descontos do tipo combo.",
  invalidComboSlots: "Um combo precisa de pelo menos um grupo de itens.",
  comboTargetRequired: "Selecione ao menos um produto ou categoria para cada grupo do combo.",
  invalidComboQuantity: "Informe uma quantidade maior que zero para cada grupo do combo.",
  invalidBundlePrice: "Informe o preço do combo, maior que zero.",
  invalidFreeUnits: "Informe quantos itens saem de graça, maior que zero.",
  freeUnitsExceedCombo: "O combo precisa cobrar por pelo menos um item.",
  invalidMaxComboApplications:
    "O limite de combos por carrinho deve ser maior que zero (ou deixe em branco).",
};
