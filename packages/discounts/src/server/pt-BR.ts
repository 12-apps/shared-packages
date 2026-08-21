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
};
