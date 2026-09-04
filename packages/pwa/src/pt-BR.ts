import type { PwaMessages } from "./messages";

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

// Moved to its own file so a host mounting the gesture does not pull this
// one — and the invite that shares its chunk — onto the critical path.
export { PT_BR_PULL_TO_REFRESH_MESSAGES } from "./pull-to-refresh.pt-BR";
