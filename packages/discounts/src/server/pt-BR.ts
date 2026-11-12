import type { CompleteDiscountsServerCopy } from "./copy";

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
export const PT_BR_DISCOUNTS_SERVER_COPY: CompleteDiscountsServerCopy = {
  invalidQuery: "Parâmetros de consulta inválidos.",
  notFound: "Desconto não encontrado.",
  invalidPercent: "Informe uma porcentagem maior que 0 e no máximo 100.",
  invalidAmount: "Informe um valor de desconto maior que zero.",
  codeRequired: "Informe o código do cupom que o cliente vai digitar.",
  categoryTargetRequired: "Selecione ao menos uma categoria para este desconto.",
  itemTargetRequired: "Selecione ao menos um produto para este desconto.",
  invalidDate: "Data inválida. Use o formato AAAA-MM-DD.",
  endsBeforeStarts: "A data de término deve ser posterior à data de início.",
  endsBeforeStartDay: "A data de término não pode ser anterior à data de início.",
  datesNeedKnownZone:
    "Não foi possível salvar estas datas: o fuso horário da loja não foi reconhecido. Corrija o fuso horário e tente de novo.",
  keepWindowWithDates:
    "Não dá para manter as datas salvas e mudar as datas no mesmo envio. Envie só um dos dois.",
  windowChanged: "A promoção mudou enquanto você editava. Abra de novo e salve.",
  invalidSchedule: "Horários da promoção inválidos. Escolha ao menos um dia e um horário de início e fim diferentes.",
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
  foreignTarget: "Selecione categorias e produtos desta loja.",
  bulk: {
    activated: "Ativado.",
    deactivated: "Desativado.",
    extended: "Validade estendida.",
    revived: "Estava encerrado: voltou a valer.",
    extendedPaused: "Estava encerrado e pausado: validade estendida, continua desativado.",
    restored: "Voltou ao que era antes do lote.",
    alreadyActive: "Já estava ativo.",
    alreadyInactive: "Já estava desativado.",
    alreadyEndsThen: "Já termina nesse dia.",
    alreadyRestored: "Já estava como antes do lote.",
    noEndDate: "Sem data de fim: não há o que estender.",
    notLater: "A nova data não é depois do fim atual.",
    stillEnded: "A nova data ainda está no passado: continuaria encerrado.",
    zoneUnknown: "O fuso horário da loja não foi reconhecido: as datas não mudam agora.",
    zoneOff: "O desconto conta dias inteiros e a loja não está contando agora: as datas não mudam.",
    notFound: "O desconto não existe mais.",
    changedSince: "Mudou depois do lote: foi deixado como está.",
    changedDuringBatch: "Mudou durante o lote. Tente de novo.",
    failed: "Não foi possível alterar este desconto.",
    tooManyIds: "No máximo {max} descontos por vez. Filtre a lista e tente de novo.",
    atomicRefused: "Nada foi gravado: {count} descontos não podem receber a mudança.",
  },
};
