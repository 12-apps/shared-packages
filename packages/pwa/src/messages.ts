/**
 * Every user-facing string of the install invite — REQUIRED host config, with
 * no defaults (the copy-portability doctrine): the old pt-BR defaults meant a
 * host that passed nothing shipped another product's voice, silently. A pt-BR
 * host imports {@link PT_BR_PWA_MESSAGES} from `./pt-BR` (re-exported at the
 * package root) and passes it by hand — one reviewable line.
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

