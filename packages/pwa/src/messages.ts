/**
 * Every user-facing string of the install invite, overridable via
 * `messages?: Partial<PwaMessages>` — pt-BR by default, so another product can
 * rebrand or translate without forking the component.
 *
 * ## The wording is the feature, not decoration
 *
 * The first version of this said "Adicione {loja} à sua tela de início: toque em
 * Compartilhar e depois em Adicionar à Tela de Início", with the reason demoted
 * to grey caption text underneath. That is the instruction leading and the
 * benefit buried — and nobody adds a site to their Home Screen because they want
 * to add a site to their Home Screen. They do it because something they want is
 * on the other side.
 *
 * So the order is inverted here: `iosBenefit` is the headline and `iosHow` the
 * follow-up. Functions where a value is interpolated, so a translation can
 * reorder freely.
 */

export interface PwaMessages {
  /** Headline for the one-tap branch, on a handheld. */
  promptHandheld: (what: string) => string;
  /** Headline for the one-tap branch, on a desktop — the SAME event fires there. */
  promptDesktop: (what: string) => string;
  /** The button that opens the browser's own installer. */
  promptAccept: string;

  /** THE REASON, and the headline: what the person gets. */
  iosBenefit: (what: string) => string;
  /** The mechanics, second. `{share}` is replaced by the share glyph. */
  iosHow: string;
  /** Where the control is, for the arrow to make sense. */
  iosWhere: string;

  /** Refusal, shared by both branches. */
  dismiss: string;
}

export const defaultMessages: PwaMessages = {
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

/** Merge a host's overrides over the defaults. */
export function resolveMessages(overrides?: Partial<PwaMessages>): PwaMessages {
  return overrides ? { ...defaultMessages, ...overrides } : defaultMessages;
}
