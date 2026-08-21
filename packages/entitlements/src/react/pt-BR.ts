import type { EntitlementsWebCopy } from './copy';

/**
 * The pt-BR pack — the exact sentences the screens compiled in until copy
 * became required config. The filename is what exempts this file from the
 * copy-portability gate: Portuguese may ship, it may not be silent.
 */
export const PT_BR_ENTITLEMENTS_WEB_COPY: EntitlementsWebCopy = {
  requestFailed: ({ status }) => `Falha na requisição (${status}).`,
  planPage: {
    title: 'Planos',
    currentPlanPrefix: 'Seu plano hoje é ',
    currentPlanDetail: ({ price }) => (price === null ? '.' : ` · ${price}.`),
    loadFailedTitle: 'Não foi possível carregar seu plano',
    requestReceived: ({ plan }) =>
      `Recebemos seu pedido para o plano ${plan}. Vamos entrar em contato para combinar os detalhes.`,
    statusHeading: 'Seu plano hoje',
    statusIntro: 'O que está ativo agora — e, quando não está, por quê.',
    statusEmpty: 'Nenhum recurso gerenciado por plano no momento.',
    ceilingUnlimited: 'ilimitado',
    ceilingUpTo: ({ limit }) => `até ${String(limit)}`,
    availableOn: ({ planLabel }) => `Disponível no plano ${planLabel}.`,
    openSwitch: ({ label }) => `Ativar em ${label}`,
    statusBadge: { enabled: 'Ativo', disabled: 'Indisponível' },
  },
  tierCards: {
    currentBadge: 'SEU PLANO',
    recommendedBadge: 'MELHOR OFERTA',
    priceUnpriced: 'Sob consulta',
    currentAction: 'Plano atual',
    requestAction: 'Quero este plano',
  },
  upsell: {
    reasons: {
      'not-entitled': {
        title: 'Recurso não incluído no seu plano',
        body: 'Seu plano atual não inclui este recurso.',
      },
      'quota-exceeded': {
        title: 'Limite do plano atingido',
        body: 'Você usou todo o limite que o seu plano inclui para este recurso.',
      },
      restricted: {
        title: 'Pagamento pendente',
        body: 'Há uma pendência de pagamento na assinatura, por isso este recurso está temporariamente indisponível. Regularize o pagamento para voltar a usá-lo.',
      },
      suspended: {
        title: 'Assinatura suspensa',
        body: 'A assinatura está suspensa e este recurso ficou indisponível. Regularize a assinatura ou fale com o nosso suporte.',
      },
      'disabled-by-tenant': {
        title: 'Recurso desativado',
        body: 'Este recurso está desativado nas configurações — não é uma questão de plano.',
      },
    },
    askAdmin: 'Peça a quem administra a conta para solicitar a mudança de plano.',
    requestReceived: ({ planName }) =>
      planName === null
        ? 'Recebemos seu pedido de mudança de plano. Vamos entrar em contato para combinar os detalhes.'
        : `Recebemos seu pedido para o plano ${planName}. Vamos entrar em contato para combinar os detalhes.`,
    requestAction: 'Quero este plano',
    openSwitch: ({ label }) => `Abrir ${label}`,
    quotaUsage: ({ used, limit }) => `Você está usando ${used} de ${limit}.`,
    planPitch: { prefix: 'Disponível no plano ', suffix: '.' },
    allPlansLink: 'Ver todos os planos',
  },
  pageLock: {
    reasons: {
      'not-entitled': {
        title: 'Recurso não incluído no seu plano',
        body: 'Seu plano atual não inclui esta área. Conheça as opções de plano para desbloqueá-la.',
      },
      'quota-exceeded': {
        title: 'Limite do plano atingido',
        body: 'Você usou todo o limite que o seu plano inclui para este recurso.',
      },
      restricted: {
        title: 'Pagamento pendente',
        body: 'Há uma pendência de pagamento na assinatura, por isso esta área está temporariamente indisponível.',
      },
      suspended: {
        title: 'Assinatura suspensa',
        body: 'A assinatura está suspensa e esta área ficou indisponível.',
      },
      // Never reached (disabled-by-tenant passes through to the page) —
      // present because the record is total over UpsellReason on purpose.
      'disabled-by-tenant': {
        title: 'Recurso desativado',
        body: 'Este recurso está desativado nas configurações.',
      },
    },
    learnMore: 'Saiba mais',
  },
};
