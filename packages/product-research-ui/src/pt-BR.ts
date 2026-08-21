import type { ResearchMessages } from './messages';

/**
 * The pt-BR pack — the exact strings the screens defaulted to before copy
 * became required config, now a NAMED export a host passes by hand. The
 * filename is what exempts this file from the copy-portability gate:
 * Portuguese may ship, it may not be silent.
 */
export const PT_BR_RESEARCH_MESSAGES: ResearchMessages = {
  formTitle: 'O que você precisa comprar?',
  formTermLabel: 'Produto',
  formTermPlaceholder: 'Coca-Cola Original Lata 350ml',
  formBrandLabel: 'Marca',
  formQuantityLabel: 'Quantidade',
  formRegionLabel: 'CEP de entrega',
  formSubmit: 'Pesquisar preços',
  formSubmitBusy: 'Iniciando…',
  formTermRequired: 'Diga o que pesquisar (mínimo 2 letras).',
  formStartFailed: 'Não foi possível iniciar a pesquisa.',

  statusTitle: 'Fontes consultadas',
  statusQuerying: 'consultando…',
  statusOk: (offerCount) => `${offerCount} oferta(s)`,
  statusCached: (offerCount) => `${offerCount} oferta(s) · cache`,
  statusOkOutsideArea: (offerCount) => `${offerCount} oferta(s) · outra região`,
  statusCachedOutsideArea: (offerCount) => `${offerCount} oferta(s) · outra região · cache`,
  statusOkTruncated: (offerCount) => `${offerCount} oferta(s) · busca interrompida`,
  statusCachedTruncated: (offerCount) => `${offerCount} oferta(s) · busca interrompida · cache`,
  // Says what happened, what it costs the buyer, and what to do — in that
  // order. The delivery sentence is the load-bearing half: a VTEX search cut
  // before its simulation tier returns catalog offers with NO delivery flag,
  // which is indistinguishable on screen from offers we verified.
  truncatedHint:
    'Esta fonte atingiu o tempo limite da pesquisa e parou antes de terminar. As ofertas ' +
    'abaixo valem, mas a lista pode estar incompleta e a entrega no CEP informado não foi ' +
    'verificada. Refaça a pesquisa se precisar da lista completa desta loja.',
  statusFailed: 'indisponível',
  statusBudget: 'limite de consultas atingido',
  statusSkipped: 'não consultada',
  statusFailureReason: (reason) => `Motivo: ${reason}`,
  statusReasonUnknown:
    'A fonte não informou o motivo. Tente novamente; se persistir, revise a configuração da fonte.',

  runQueued: 'Pesquisa na fila…',
  runRunning: 'Consultando as fontes…',
  runFailedTitle: 'A pesquisa falhou',
  degradedTitle: 'Resultados podem estar incompletos',
  degradedBody:
    'Uma ou mais fontes não responderam nesta pesquisa. Os preços abaixo valem, mas pode haver oferta melhor na fonte que faltou.',

  bestOfferTitle: 'Melhor preço',
  unitPriceSuffix: '/un',
  totalFor: (quantity) => `total para ${quantity} un`,
  packMath: (totalLabel, packQuantity, unitLabel) =>
    `${totalLabel} ÷ ${packQuantity} un = ${unitLabel}`,
  openOffer: 'Comprar na loja',
  relevance: (percent) => `${percent}% relevante`,
  availabilityInStock: 'em estoque',
  availabilityOutOfStock: 'sem estoque',
  availabilityUnknown: 'estoque não informado',
  etaDays: (days) => `entrega ~${days} dia(s)`,
  outsideAreaBadge: 'Fora da área de entrega',
  outsideAreaHint:
    'Esta loja não entrega no CEP informado. O preço é o da região padrão da loja e pode não ser entregável aqui — use como referência.',
  suspectUnitPriceBadge: 'Preço unitário suspeito',
  // Hedged on purpose: the guard compares prices, not products, so it cannot
  // tell an unlabelled multipack from a genuinely bigger or premium item. It
  // says what it measured and hands the buyer the check to make.
  suspectUnitPriceHint:
    'Este anúncio diz 1 unidade, mas o preço é muitas vezes maior que o preço unitário típico desta pesquisa. Pode ser um pacote cuja quantidade não aparece no título, ou um produto de tamanho maior. Confira a embalagem na loja antes de comparar.',
  shippingUnknownBadge: 'Frete não informado',
  // Same hedged register as the hint above: say what is MISSING and what the
  // buyer should check, never assert a cause and never guess a value. "pode
  // somar" and not "vai somar" — a store with free delivery that simply did not
  // say so is also in this set, and calling its total understated would be a
  // second wrong claim replacing the first.
  shippingUnknownHint:
    'Esta loja não informou o valor do frete. O total mostrado é só o preço dos produtos — o frete pode somar. Confira o frete para o seu CEP na loja antes de comparar com as outras ofertas.',

  offersTitle: 'Todas as ofertas',
  offersPartialTitle: 'Ofertas encontradas até agora',
  offersPartialNote:
    'Algumas fontes ainda estão respondendo. A ordem já é a definitiva — ofertas mais baratas podem aparecer acima destas. O card de melhor preço e os avisos de preço unitário só aparecem quando a pesquisa termina.',
  offersEmptyTitle: 'Nenhuma oferta encontrada',
  offersEmptyBody:
    'Tente um termo mais genérico, confira a embalagem (lata, pet, fardo) ou importe a tabela do seu distribuidor como fonte manual.',
  columnRank: '#',
  columnSupplier: 'Fornecedor',
  columnSource: 'Fonte',
  columnProduct: 'Produto',
  columnPack: 'Emb.',
  columnUnitPrice: 'R$/un',
  columnTotal: 'Total',
  columnAvailability: 'Disponibilidade',
  columnRelevance: 'Relevância',
  columnLink: 'Loja',
  packUnits: (units) => `${units} un`,

  widgetTitle: 'Melhores preços atuais',
  widgetEmpty: 'Nenhuma pesquisa recente para este produto.',
  widgetSearch: 'Pesquisar preços',
  widgetOpen: 'Ver pesquisa completa',
  widgetFreshness: (stamp) => `preços de ${stamp}`,

  historyTitle: 'Pesquisas recentes',
  historyEmpty: 'Nenhuma pesquisa ainda — a primeira leva segundos.',
  historyOpen: 'Abrir',
  historyRepeat: 'Repetir',
  historyRepeatRunningHint: 'Esta pesquisa ainda está em andamento — abra para acompanhá-la.',
  historyViewAll: 'Ver todas',
  historyQuantity: (quantity) => `${quantity} un`,
  historyStatusDone: 'concluída',
  historyStatusRunning: 'em andamento',
  historyStatusFailed: 'falhou',
  historyStatusNone: 'na fila',
};
