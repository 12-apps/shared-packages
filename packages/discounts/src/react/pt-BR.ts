import type { DiscountsWebCopy } from "./copy";

/**
 * The pt-BR pack for the discounts admin screens.
 *
 * A NAMED PACK a host passes by hand, never a default: choosing a language is a
 * line in the adopter's diff. See `./copy` for why the port has this many keys.
 *
 * Doubles as the SHAPE `missingWebCopy` walks, which is the only reason this
 * module is imported by `createWebDiscounts` — the key names travel, the words
 * do not.
 */
export const PT_BR_DISCOUNTS_WEB_COPY: DiscountsWebCopy = {
  screen: {
    title: "Descontos",
    aboutTitle: "Sobre os descontos",
    aboutBody:
      "Crie promoções automáticas ou cupons com código, para o pedido inteiro, uma categoria, produtos específicos ou um combo.",
    create: "Novo desconto",
    empty: "Nenhum desconto cadastrado.",
    exportFileName: "descontos",
    loading: "Carregando descontos…",
    loadFailed: "Não foi possível carregar os descontos",
    retry: "Tentar novamente",
    columns: {
      name: "Nome",
      value: "Desconto",
      type: "Tipo",
      scope: "Abrangência",
      trigger: "Ativação",
      window: "Vigência",
      code: "Código",
      usageCount: "Usos",
      active: "Ativo",
    },
    yes: "Sim",
    no: "Não",
  },
  labels: {
    type: {
      PERCENTAGE: "Porcentagem",
      FIXED_AMOUNT: "Valor fixo",
      BUNDLE_PRICE: "Preço de combo",
      FREE_UNITS: "Itens grátis",
    },
    scope: {
      ORDER: "Pedido",
      CATEGORY: "Categoria",
      ITEM: "Item",
      COMBO: "Combo",
    },
    trigger: {
      AUTOMATIC: "Automático",
      CODE: "Código",
    },
    window: {
      RUNNING: "Vigente",
      SCHEDULED: "Agendado",
      ENDED: "Encerrado",
    },
  },
  window: {
    always: "Sem prazo",
    from: "A partir de {date}",
    until: "Até {date}",
    between: "{from} a {to}",
  },
  form: {
    createTitle: "Novo desconto",
    editTitle: "Editar desconto",
    submitCreate: "Criar desconto",
    submitEdit: "Salvar alterações",
    name: "Nome da promoção",
    type: "Tipo",
    percentOff: "Desconto (%)",
    percentPlaceholder: "10",
    amountOff: "Valor do desconto",
    bundlePrice: "Preço do combo",
    freeUnits: "Itens grátis",
    freeUnitsHint:
      "Quantas unidades do combo saem de graça. Em um grupo de 3, deixar 1 grátis é o clássico \"leve 3, pague 2\".",
    trigger: "Ativação",
    code: "Código do cupom",
    codePlaceholder: "BEMVINDO10",
    scope: "Abrangência",
    startsAt: "Início",
    endsAt: "Término",
    minSubtotal: "Pedido mínimo",
    usageLimit: "Limite de usos",
    perBuyerLimit: "Limite por cliente",
    maxComboApplications: "Combos por pedido",
    maxComboApplicationsHint: "Deixe em branco para valer quantas vezes couber no carrinho.",
    active: "Ativo",
    activeHint: "Desligue para pausar a promoção sem excluí-la.",
    stackable: "Acumulável",
    stackableHint:
      "Quando desligado, esta promoção é exclusiva: se vencer, nenhuma outra é aplicada.",
    reviewFields: "Revise os campos destacados.",
    saveFailed: "Não foi possível salvar o desconto",
    nameRequired: "Informe o nome da promoção.",
    invalidPercent: "Informe uma porcentagem maior que 0 e no máximo 100.",
    invalidAmount: "Informe um valor de desconto maior que zero.",
    invalidBundlePrice: "Informe o preço do combo, maior que zero.",
    invalidFreeUnits: "Informe quantos itens saem de graça, a partir de 1.",
    freeUnitsExceedCombo:
      "O combo tem {units} itens; deixe grátis no máximo {max} para ainda ser uma promoção.",
    codeRequired: "Informe o código do cupom que o cliente vai digitar.",
    categoryTargetRequired: "Selecione ao menos uma categoria para este desconto.",
    itemTargetRequired: "Selecione ao menos um produto para este desconto.",
    comboSlotsRequired: "Monte o combo: adicione ao menos um grupo de itens.",
    comboSlotTargetRequired: "Escolha o que pode entrar em cada grupo do combo.",
    invalidComboQuantity: "Informe quantas unidades cada grupo leva, a partir de 1.",
    invalidMaxComboApplications: "Informe quantos combos cabem por pedido, a partir de 1.",
    endsBeforeStarts: "A data de término deve ser posterior à data de início.",
  },
  combo: {
    title: "Monte o combo",
    hint: "Cada grupo é uma parte do combo: quantas unidades leva e o que pode entrar nela.",
    addSlot: "Adicionar grupo",
    removeSlot: "Remover o grupo {position}",
    slot: "Grupo {position}",
    quantity: "Quantidade",
    pick: "{collection} deste grupo",
    empty: "Nenhum grupo ainda. Adicione o primeiro para montar o combo.",
    summary: "O combo leva {units} itens em {groups} grupos.",
  },
  targets: {
    pick: "{collection} com desconto",
    search: "Buscar em {collection}…",
    required: "Selecione ao menos uma opção.",
  },
  actions: {
    menu: "Ações",
    edit: "Editar",
    delete: "Excluir",
    deleteTitle: "Excluir o desconto?",
    deleteDescription: "O desconto para de valer na vitrine e não pode ser restaurado.",
    deleteManyTitle: "Excluir {count} descontos?",
    deleteManyDescription: "Deixam de valer na vitrine e não podem ser restaurados.",
    deleteFailed: "Não foi possível excluir o desconto.",
    actionFailed: "Não foi possível concluir a ação",
  },
  card: {
    paused: "Pausado",
    ruleHeading: "Regra",
    targetsHeading: "Alvos",
    wholeOrder: "pedido inteiro",
    oneTarget: "1 alvo",
    manyTargets: "{count} alvos",
    withCode: "código {code}",
    noTargets: "Nenhum alvo",
    usage: "Usos",
    minSubtotal: "Pedido mínimo",
    perBuyerLimit: "Limite por cliente",
    unlimited: "Sem limite",
  },
};
