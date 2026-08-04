/**
 * Every user-facing string of the research screens, overridable per screen
 * via `messages?: Partial<ResearchMessages>` — pt-BR by default, so another
 * product can rebrand or translate without forking a component (FUT-420's
 * acceptance criterion; the first messages layer in this repo).
 *
 * Functions rather than template strings where a value is interpolated, so a
 * translation can reorder freely.
 */

export interface ResearchMessages {
  formTitle: string;
  formTermLabel: string;
  formTermPlaceholder: string;
  formBrandLabel: string;
  formQuantityLabel: string;
  formRegionLabel: string;
  formSubmit: string;
  formSubmitBusy: string;
  formTermRequired: string;
  formStartFailed: string;

  statusTitle: string;
  statusQuerying: string;
  statusOk: (offerCount: number) => string;
  statusCached: (offerCount: number) => string;
  /**
   * A source that answered with ANOTHER region's prices because it does not
   * deliver to this CEP (FUT-491) — a distinct reading from a plain OK, so the
   * buyer sees where the numbers came from without opening a row.
   */
  statusOkOutsideArea: (offerCount: number) => string;
  statusCachedOutsideArea: (offerCount: number) => string;
  /**
   * A source cut short by the per-source time ceiling (FUT-516). It ANSWERED,
   * so these offers are real — but the list may be shorter than the store's,
   * and the count must not read like a complete one.
   */
  statusOkTruncated: (offerCount: number) => string;
  statusCachedTruncated: (offerCount: number) => string;
  /** Its tooltip: what was cut short, and what was therefore NOT checked. */
  truncatedHint: string;
  statusFailed: string;
  statusBudget: string;
  statusSkipped: string;
  /**
   * WHY a source failed (FUT-495) — the connector's recorded reason, shown
   * under the row and carried in the chip's accessible description. "A fonte
   * não respondeu" answers nothing; "a loja recusou nosso acesso (HTTP 403)"
   * is the difference between guessing and fixing.
   */
  statusFailureReason: (reason: string) => string;
  /** A failed source that recorded no reason at all — still say something. */
  statusReasonUnknown: string;

  runQueued: string;
  runRunning: string;
  runFailedTitle: string;
  degradedTitle: string;
  degradedBody: string;

  bestOfferTitle: string;
  unitPriceSuffix: string;
  totalFor: (quantity: number) => string;
  packMath: (totalLabel: string, packQuantity: number, unitLabel: string) => string;
  openOffer: string;
  relevance: (percent: number) => string;
  availabilityInStock: string;
  availabilityOutOfStock: string;
  availabilityUnknown: string;
  etaDays: (days: number) => string;
  /** Compact badge on an offer priced for the store's default region. */
  outsideAreaBadge: string;
  /** Its tooltip — why the price is there and what it does NOT promise. */
  outsideAreaHint: string;
  /** Compact badge on a one-unit price that looks like a whole multipack. */
  suspectUnitPriceBadge: string;
  /** Its tooltip — what the suspicion is and what the buyer should check. */
  suspectUnitPriceHint: string;
  /** Compact badge on a total the source gave no shipping cost for (FUT-518). */
  shippingUnknownBadge: string;
  /** Its tooltip — that the total is a minimum, and where to confirm it. */
  shippingUnknownHint: string;

  offersTitle: string;
  /** Heading over the offers already found while the run is still in flight. */
  offersPartialTitle: string;
  /**
   * What the partial table does and does NOT promise (FUT-519) — that sources
   * are still answering, that the order shown is already the final one, and
   * that the hero card and the unit-price caveats wait for the end.
   */
  offersPartialNote: string;
  offersEmptyTitle: string;
  offersEmptyBody: string;
  columnRank: string;
  columnSupplier: string;
  columnSource: string;
  columnProduct: string;
  columnPack: string;
  columnUnitPrice: string;
  columnTotal: string;
  columnAvailability: string;
  columnRelevance: string;
  columnLink: string;
  packUnits: (units: number) => string;

  widgetTitle: string;
  widgetEmpty: string;
  widgetSearch: string;
  widgetOpen: string;
  widgetFreshness: (stamp: string) => string;

  historyTitle: string;
  historyEmpty: string;
  historyOpen: string;
  /** Re-runs a past research from its stored query (FUT-494). */
  historyRepeat: string;
  /** Why the repeat is disabled while the request's run is still in flight. */
  historyRepeatRunningHint: string;
  /** Leaves the bounded block for the full, filterable history page. */
  historyViewAll: string;
  historyQuantity: (quantity: number) => string;
  historyStatusDone: string;
  historyStatusRunning: string;
  historyStatusFailed: string;
  historyStatusNone: string;
}

export const DEFAULT_MESSAGES: ResearchMessages = {
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

/** The defaults with a screen's overrides folded in. */
export function resolveMessages(overrides?: Partial<ResearchMessages>): ResearchMessages {
  return overrides === undefined ? DEFAULT_MESSAGES : { ...DEFAULT_MESSAGES, ...overrides };
}
