/**
 * Whether a store finishes checkout on the PROVIDER's own page.
 *
 * Its own module because two callers need the same answer and must never be
 * able to disagree about it: {@link CapabilityDefaultScreen}, which picks the
 * pane for a provider that declared no screen, and the shell's picker gate,
 * which decides whether the buyer is asked PIX-or-card here at all. It lived
 * inside `capability-default.tsx` while there was one caller.
 */
import type { CheckoutProviderConfig } from "../types";

/** Schemes that give the BROWSER a card form of its own. */
const IN_BROWSER_TOKENIZATION: ReadonlySet<string> = new Set(["PUBLIC_KEY", "SDK"]);

/**
 * Whether this store hands the buyer over instead of collecting here — the
 * frontend twin of the server's `usesHostedCheckout`, deliberately written to
 * the same three rules so the pane and the walk cannot disagree.
 *
 * Note this is NOT `!cardPathAvailable(config)`. That helper answers a
 * different question — "is a card offerable at all" — and it answers TRUE for
 * a hand-off store, because typing the card on the provider's page is still a
 * card path. Inverting it therefore sends the hosted store to the on-page
 * screen and the on-page store to the hand-off, which is exactly backwards.
 *
 * The rules, in order:
 *   - Only CARD can be answered in advance. TOKENIZATION IS A CARD FACT: it
 *     says how the browser turns a PAN into an instrument, and a PIX charge
 *     has no instrument to mint. A store with no card-capable entry is not
 *     hosted — this is the FUT-747 correction, and getting it wrong routed the
 *     simplest store there is (one PIX-only provider honestly declaring
 *     `NONE`) into a hand-off it had no link for.
 *   - Hosted only when NOBODY who takes a card takes it here.
 *   - No chain served (an older host, a still-loading config) ⇒ not hosted,
 *     which is what this checkout did before there was a chain to read.
 */
export function handsBuyerOver(config: CheckoutProviderConfig | null): boolean {
  const chain = config?.chain;
  if (!chain || chain.length === 0) return false;
  const cardCapable = chain.filter((link) => link.methods.includes("CARD"));
  if (cardCapable.length === 0) return false;
  return !cardCapable.some((link) => IN_BROWSER_TOKENIZATION.has(link.tokenization));
}
