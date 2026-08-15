import type { NotificationMessages } from '../messages';

/**
 * THE SUITE'S OWN VOICE — deliberately not the extraction origin's.
 *
 * `messages` became required config (see `../messages.ts`), so every test that
 * mounts a surface has to state its copy. Pasting the table that used to be the
 * default back in here would quietly undo the change: a suite asserting the
 * origin's sentences passes just as happily whether a host supplied them or a
 * resurrected default did.
 *
 * So these belong to a fictional host — a VETERINARY CLINIC's client portal.
 * Still pt-BR, because the rule is "copy is the host's", not "copy is English";
 * a package that swapped one product's Portuguese for one product's English
 * would have moved the problem rather than fixed it. But no shipped file could
 * plausibly say "vacinas" or "consultas", so if a default ever returns these
 * strings stop appearing and the suites reading them fail.
 *
 * The CATEGORIES are the important half. `categories` became required config
 * one release earlier, and this fixture declares its own two — so the labels
 * beside them are its own as well, which is exactly the pairing that was
 * missing while the labels defaulted.
 */
export const CLINIC_MESSAGES: NotificationMessages = {
  unauthenticated: 'Faça login para ver seus avisos.',
  invalidBody: 'Não foi possível ler o pedido.',
  operationFailed: 'Não deu certo. Tente de novo.',
  markReadTargetRequired: 'Informe `ids` ou `all: true` (exatamente um).',

  panelTitle: 'Avisos da clínica',
  markAllRead: 'Marcar tudo como lido',
  loading: 'Buscando avisos...',
  loadMore: 'Ver mais',
  loadingMore: 'Buscando...',
  loadFailedTitle: 'Não foi possível buscar seus avisos',
  loadFailedBody: 'Tente de novo em instantes.',
  retry: 'Tentar de novo',
  emptyTitle: 'Nenhum aviso',
  emptyBody: 'Quando houver novidade sobre seus pets, ela aparece aqui.',
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
  preferencesLead: 'Escolha por onde quer receber cada assunto. O sino sempre recebe tudo.',
  channelLabels: {
    EMAIL: 'E-mail',
    SMS: 'SMS',
    WHATSAPP: 'WhatsApp',
    WEB_PUSH: 'Navegador',
  },
  channelUnavailableHints: {
    EMAIL: 'Envio de e-mail não está configurado nesta clínica.',
    SMS: 'Cadastre um telefone na sua ficha para receber SMS.',
    WHATSAPP: 'Cadastre um telefone na sua ficha para receber WhatsApp.',
    WEB_PUSH: 'Alertas do navegador não estão configurados nesta clínica.',
  },
  categoryLabels: {
    consultas: {
      title: 'Consultas',
      description: 'Lembretes e remarcações das consultas dos seus pets.',
    },
    vacinas: {
      title: 'Vacinas',
      description: 'Quando uma dose está perto do vencimento.',
    },
  },
  categoryFallbackTitle: (category) => category,
  devicePushTitle: 'Alertas neste navegador',
  devicePushIdle: 'Permita notificações para receber avisos mesmo com o site fechado.',
  devicePushOn: 'Este navegador está recebendo avisos.',
  devicePushDenied: 'Permissão negada — habilite notificações nas configurações do navegador.',
  devicePushFailed: 'Não foi possível ativar. Tente de novo.',
  devicePushEnable: 'Ativar',
  devicePushEnabling: 'Ativando...',
};
