import type { NotificationMessages } from '@12-apps/notifications';

/**
 * THIS HOST'S OWN SENTENCES.
 *
 * `messages` is required on all three mounts now. It used to be optional over a
 * ~40-sentence pt-BR table the package shipped — labelled in its own source as
 * the extraction origin's "exact copy" — spread UNDER whatever a host passed,
 * and per KEY inside `channelLabels`, `channelUnavailableHints` and
 * `categoryLabels`. So a host that relabelled one channel kept the origin's
 * wording for the other three.
 *
 * This harness passed nothing at all, and so rendered that table start to
 * finish while claiming to be an independent consumer. That is exactly how the
 * default stayed invisible: its only reader was the one place that would never
 * notice.
 *
 * The words here are the harness's own — a hardware shop, the same host
 * identity `app-shell/shell-copy.ts` uses. If the package ever reintroduces a
 * default these sentences stop appearing and the specs reading them fail, which
 * is the only way a consumer can notice a default coming back.
 */
export const HARNESS_NOTIFICATION_MESSAGES: NotificationMessages = {
  unauthenticated: 'Entre na sua conta para ver os avisos.',
  invalidBody: 'Não foi possível ler o pedido.',
  operationFailed: 'Não deu certo. Tente de novo.',
  markReadTargetRequired: 'Informe `ids` ou `all: true` (exatamente um).',

  panelTitle: 'Avisos da loja',
  markAllRead: 'Marcar tudo como lido',
  loading: 'Buscando avisos...',
  loadMore: 'Ver mais',
  loadingMore: 'Buscando...',
  loadFailedTitle: 'Não foi possível buscar seus avisos',
  loadFailedBody: 'Tente de novo em instantes.',
  retry: 'Tentar de novo',
  emptyTitle: 'Nenhum aviso',
  emptyBody: 'Novidades sobre seus pedidos aparecem aqui.',
  openBell: 'Abrir avisos',
  openBellWithUnread: (count) => `Abrir avisos (${count} não lidos)`,
  unreadSuffix: 'não lido',
  deleteOne: (title) => `Excluir aviso: ${title}`,

  justNow: 'agora',
  minutesAgo: (minutes) => `há ${minutes} min`,
  hoursAgo: (hours) => `há ${hours} h`,
  daysAgo: (days) => (days === 1 ? 'há 1 dia' : `há ${days} dias`),
  dateLocale: 'pt-BR',

  preferencesTitle: 'Como avisamos você',
  preferencesLead: 'Escolha por onde receber cada assunto. O sino sempre recebe tudo.',
  channelLabels: {
    EMAIL: 'E-mail',
    SMS: 'SMS',
    WHATSAPP: 'WhatsApp',
    WEB_PUSH: 'Navegador',
  },
  channelUnavailableHints: {
    EMAIL: 'Envio de e-mail não está configurado nesta loja.',
    SMS: 'Cadastre um telefone no seu cadastro para receber SMS.',
    WHATSAPP: 'Cadastre um telefone no seu cadastro para receber WhatsApp.',
    WEB_PUSH: 'Alertas do navegador não estão configurados nesta loja.',
  },
  categoryLabels: {
    orders: { title: 'Pedidos', description: 'Confirmação e andamento dos seus pedidos.' },
    payments: { title: 'Pagamentos', description: 'Cobranças e comprovantes.' },
    stock: { title: 'Estoque', description: 'Avisos de reposição das peças que você acompanha.' },
    system: { title: 'Conta', description: 'Avisos sobre a sua conta na loja.' },
  },
  categoryFallbackTitle: (category) => category,
  devicePushTitle: 'Alertas neste navegador',
  devicePushIdle: 'Permita notificações para receber avisos com o site fechado.',
  devicePushOn: 'Este navegador está recebendo avisos.',
  devicePushDenied: 'Permissão negada — habilite notificações nas configurações do navegador.',
  devicePushFailed: 'Não foi possível ativar. Tente de novo.',
  devicePushEnable: 'Ativar',
  devicePushEnabling: 'Ativando...',
};
