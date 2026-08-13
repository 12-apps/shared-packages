/**
 * Every sentence this package can say to a USER, in one table.
 *
 * pt-BR by default because that is the product copy the surface shipped with
 * (future-pay's storefront and backoffice are Brazilian); a host in another
 * market passes `messages` and overrides the subset it cares about. The copy
 * lives HERE rather than in each screen so the api half and the react half can
 * never disagree about a sentence — the 401 body the wire returns and the
 * error the panel renders come from the same key.
 */
export interface NotificationMessages {
  // --- the wire ------------------------------------------------------------
  unauthenticated: string;
  invalidBody: string;
  operationFailed: string;
  /** `POST /notifications/mark-read` with neither `ids` nor `all`. */
  markReadTargetRequired: string;

  // --- the inbox panel -----------------------------------------------------
  panelTitle: string;
  markAllRead: string;
  loading: string;
  loadMore: string;
  loadingMore: string;
  loadFailedTitle: string;
  loadFailedBody: string;
  retry: string;
  emptyTitle: string;
  emptyBody: string;
  openBell: string;
  /** `(count) => 'Abrir notificações (3 não lidas)'`. */
  openBellWithUnread: (count: number) => string;
  unreadSuffix: string;
  deleteOne: (title: string) => string;

  // --- relative timestamps -------------------------------------------------
  justNow: string;
  minutesAgo: (minutes: number) => string;
  hoursAgo: (hours: number) => string;
  daysAgo: (days: number) => string;
  /** Locale for the fallback absolute date on rows older than a week. */
  dateLocale: string;

  // --- the preferences screen ---------------------------------------------
  preferencesTitle: string;
  preferencesLead: string;
  channelLabels: Record<string, string>;
  channelUnavailableHints: Record<string, string>;
  categoryLabels: Record<string, { title: string; description: string }>;
  /** Fallback title for a category the host added but did not label. */
  categoryFallbackTitle: (category: string) => string;
  devicePushTitle: string;
  devicePushIdle: string;
  devicePushOn: string;
  devicePushDenied: string;
  devicePushFailed: string;
  devicePushEnable: string;
  devicePushEnabling: string;
}

/** future-pay's exact copy — the product default. */
export const DEFAULT_NOTIFICATION_MESSAGES: NotificationMessages = {
  unauthenticated: 'Não autenticado.',
  invalidBody: 'Dados inválidos.',
  operationFailed: 'Não foi possível concluir a operação.',
  markReadTargetRequired: 'Informe `ids` ou `all: true` (exatamente um).',

  panelTitle: 'Notificações',
  markAllRead: 'Marcar todas como lidas',
  loading: 'Carregando notificações...',
  loadMore: 'Carregar mais',
  loadingMore: 'Carregando...',
  loadFailedTitle: 'Não foi possível carregar',
  loadFailedBody: 'Tente novamente em instantes.',
  retry: 'Tentar novamente',
  emptyTitle: 'Nenhuma notificação',
  emptyBody: 'Você está em dia — novidades aparecem aqui.',
  openBell: 'Abrir notificações',
  openBellWithUnread: (count) => `Abrir notificações (${count} não lidas)`,
  unreadSuffix: 'não lida',
  deleteOne: (title) => `Excluir notificação: ${title}`,

  justNow: 'agora',
  minutesAgo: (minutes) => `há ${minutes} min`,
  hoursAgo: (hours) => `há ${hours} h`,
  daysAgo: (days) => (days === 1 ? 'há 1 dia' : `há ${days} dias`),
  dateLocale: 'pt-BR',

  preferencesTitle: 'Notificações',
  preferencesLead:
    'Escolha como quer ser avisado, por tipo de assunto. O sino do app sempre recebe tudo.',
  channelLabels: {
    EMAIL: 'E-mail',
    SMS: 'SMS',
    WHATSAPP: 'WhatsApp',
    WEB_PUSH: 'Navegador',
  },
  channelUnavailableHints: {
    EMAIL: 'Envio de e-mail não está configurado neste ambiente.',
    SMS: 'Cadastre um telefone no seu perfil para receber SMS.',
    WHATSAPP: 'Cadastre um telefone no seu perfil para receber WhatsApp.',
    WEB_PUSH: 'Alertas do navegador não estão configurados neste ambiente.',
  },
  categoryLabels: {
    orders: {
      title: 'Pedidos',
      description: 'Confirmações e andamento dos seus pedidos.',
    },
    payments: {
      title: 'Pagamentos',
      description: 'Cobranças, comprovantes e falhas de pagamento.',
    },
    stock: {
      title: 'Estoque',
      description: 'Alertas de estoque das lojas que você administra.',
    },
    system: {
      title: 'Sistema',
      description: 'Avisos da sua conta e da plataforma.',
    },
  },
  categoryFallbackTitle: (category) => category,
  devicePushTitle: 'Alertas neste navegador',
  devicePushIdle: 'Permita notificações para receber alertas mesmo com o site fechado.',
  devicePushOn: 'Este navegador está recebendo alertas.',
  devicePushDenied:
    'Permissão negada — habilite notificações nas configurações do navegador.',
  devicePushFailed: 'Não foi possível ativar. Tente novamente.',
  devicePushEnable: 'Ativar',
  devicePushEnabling: 'Ativando...',
};

/** The messages in force, defaulted to the pt-BR product copy. */
export function messagesOf(config: {
  messages?: Partial<NotificationMessages>;
}): NotificationMessages {
  const overrides = config.messages ?? {};
  return {
    ...DEFAULT_NOTIFICATION_MESSAGES,
    ...overrides,
    // Nested records merge per KEY. A host relabelling one channel must not
    // erase the labels for the other three, which a shallow spread would do.
    channelLabels: {
      ...DEFAULT_NOTIFICATION_MESSAGES.channelLabels,
      ...overrides.channelLabels,
    },
    channelUnavailableHints: {
      ...DEFAULT_NOTIFICATION_MESSAGES.channelUnavailableHints,
      ...overrides.channelUnavailableHints,
    },
    categoryLabels: {
      ...DEFAULT_NOTIFICATION_MESSAGES.categoryLabels,
      ...overrides.categoryLabels,
    },
  };
}
