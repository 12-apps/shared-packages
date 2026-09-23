/**
 * The pt-BR pack for the feedback family. Split out of `pt-BR.ts`, which is a
 * barrel over this folder — see that file for why.
 */
import type {
  ChromeCopy,
  NotificationUnblockCopy,
  TutorialCopy,
} from './copy';

export const PT_BR_TUTORIAL_COPY: TutorialCopy = {
  skip: "Pular",
  previous: "Anterior",
  next: "Próximo",
  restart: "Recomeçar",
};

export const PT_BR_CHROME_COPY: ChromeCopy = {
  dismissToast: "Fechar o aviso",
  goBack: "Voltar",
  closePanel: "Fechar",
  closeTab: "Fechar a aba",
  scrollRegion: "Conteúdo rolável",
  scrollToTop: "Voltar ao topo",
  share: "Compartilhar",
};

const PT_BR_CHROMIUM_DESKTOP = [
  "Clique no ícone à esquerda do endereço do site.",
  "Abra \"Configurações do site\".",
  "Em \"Notificações\", escolha \"Permitir\".",
  "Volte a esta página e recarregue.",
] as const;

const PT_BR_CHROMIUM_ANDROID = [
  "Toque no ícone à esquerda do endereço do site.",
  "Toque em \"Permissões\".",
  "Toque em \"Notificações\" e escolha \"Permitir\".",
  "Volte a esta página e recarregue.",
] as const;

export const PT_BR_NOTIFICATION_UNBLOCK_COPY: NotificationUnblockCopy = {
  ios: [
    "Abra os Ajustes do iPhone.",
    "Toque em \"Notificações\".",
    "Encontre este app na lista e ative \"Permitir Notificações\".",
  ],
  chrome: { desktop: PT_BR_CHROMIUM_DESKTOP, android: PT_BR_CHROMIUM_ANDROID },
  edge: {
    desktop: [
      "Clique no cadeado à esquerda do endereço do site.",
      "Abra \"Permissões para este site\".",
      "Em \"Notificações\", escolha \"Permitir\".",
      "Volte a esta página e recarregue.",
    ],
    android: PT_BR_CHROMIUM_ANDROID,
  },
  firefox: {
    desktop: [
      "Clique no ícone de permissões à esquerda do endereço do site.",
      "Ao lado de \"Enviar notificações\", clique no X para tirar o bloqueio.",
      "Recarregue a página e ative as notificações de novo.",
    ],
    android: [
      "Abra o menu do navegador e toque em \"Configurações\".",
      "Toque em \"Permissões de sites\" e depois em \"Notificações\".",
      "Encontre este site e escolha \"Permitir\".",
      "Volte a esta página e recarregue.",
    ],
  },
  opera: { desktop: PT_BR_CHROMIUM_DESKTOP, android: PT_BR_CHROMIUM_ANDROID },
  safari: {
    desktop: [
      "No menu Safari, abra \"Ajustes\".",
      "Vá na aba \"Sites\" e, na lateral, em \"Notificações\".",
      "Encontre este site e escolha \"Permitir\".",
      "Volte a esta página e recarregue.",
    ],
  },
  samsung: {
    android: [
      "Abra o menu do navegador e toque em \"Configurações\".",
      "Toque em \"Sites e downloads\" e depois em \"Notificações\".",
      "Encontre este site e permita as notificações.",
      "Volte a esta página e recarregue.",
    ],
  },
  other: [
    "Abra as configurações do navegador.",
    "Procure as permissões dos sites e depois \"Notificações\".",
    "Permita as notificações para este site.",
    "Volte a esta página e recarregue.",
  ],
};
