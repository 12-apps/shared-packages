import type { PullToRefreshMessages, PwaMessages } from "./messages";

/**
 * The pt-BR pack — the exact strings the component defaulted to before copy
 * became required config. The filename is what exempts this file from the
 * copy-portability gate: Portuguese may ship, it may not be silent.
 */
export const PT_BR_PWA_MESSAGES: PwaMessages = {
  promptHandheld: (what) => `Instale ${what} no seu celular para pedir mais rápido da próxima vez.`,
  promptDesktop: (what) => `Instale ${what} neste computador para pedir mais rápido da próxima vez.`,
  promptAccept: "Instalar app",

  // Benefit first. On iOS this is also literally true and not marketing: web
  // push does not exist outside an installed app, so "get told when it is
  // ready" is unavailable until they do this.
  iosBenefit: (what) => `Receba um aviso quando o pedido ficar pronto — instale ${what}.`,
  iosHow: "Toque em",
  iosWhere: "na barra do navegador e depois em “Adicionar à Tela de Início”.",

  dismiss: "Agora não",
};

/**
 * The pull-to-refresh pack, pt-BR. Same exemption as the invite's above: the
 * filename is what lets Portuguese ship from a package.
 *
 * "Atualizar" rather than "recarregar": it is the word every Brazilian app puts
 * on this gesture, and the user is asking for fresh CONTENT — that the document
 * is reloaded to get it is our implementation detail, not their intent.
 */
export const PT_BR_PULL_TO_REFRESH_MESSAGES: PullToRefreshMessages = {
  pulling: "Puxe para atualizar",
  armed: "Solte para atualizar",
  refreshing: "Atualizando…",
  label: "Atualizar a tela",
};
