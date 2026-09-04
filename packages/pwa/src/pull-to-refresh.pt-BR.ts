/**
 * The pull-to-refresh copy, in its OWN file rather than beside the invite's
 * (12-62).
 *
 * The split is a consumer's critical path, not tidiness. A host mounts the
 * gesture at its app root, so whatever that import reaches is eager — and while
 * these four strings lived next to the invite's pack, reaching them put that
 * module in the entry's graph. A bundler then folded the invite's small chunk
 * down into the entry, and code that only ever runs on a checkout confirmation
 * screen landed in front of every visitor's first paint. Measured in a real
 * host: the invite moved out of a lazy chunk and into the entry.
 *
 * The original file re-exports this, so existing imports are unchanged.
 */

import type { PullToRefreshMessages } from "./messages";

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
