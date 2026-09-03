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


/**
 * The pull-to-refresh strings — a SEPARATE interface from {@link PwaMessages},
 * and deliberately so on two counts.
 *
 * The gesture is not the invite: a host can want one without the other (an app
 * on its own single origin needs no invite at all and still loses its address
 * bar once installed), and coupling them would make adopting the reload a
 * breaking change for every host that hand-builds an invite's copy.
 *
 * ## These are announcements, not labels
 *
 * Nothing here is read by eye. A pull-to-refresh indicator is a spinner under
 * the user's own thumb, and by the time it is on screen they are looking at
 * their finger — which is why the visual carries an arrow and a spinner rather
 * than words. Every string below reaches a SCREEN READER, through a live
 * region, and that is the whole audience: somebody driving the app by
 * VoiceOver, for whom the arrow flipping over is nothing at all.
 *
 * So they are written as statements of what just happened, not as instructions
 * about what to do next.
 */
export interface PullToRefreshMessages {
  /** Announced once the pull is claimed but is not yet far enough. */
  pulling: string;
  /** Announced when the pull passes the threshold — releasing now refreshes. */
  armed: string;
  /** Announced while the app is reloading. */
  refreshing: string;
  /** The accessible name of the indicator's live region. */
  label: string;
}
