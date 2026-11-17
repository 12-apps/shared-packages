/**
 * What a host needs to REACT to a verified webhook (FUT-477, FUT-764).
 *
 * A file of its own rather than another block on the root barrel, which is at
 * its size cap: a barrel that has to be trimmed to accept a capability is one
 * that starts hiding capabilities to stay small. Every name is re-exported from
 * the root unchanged, so nothing an adopter imports moves.
 */
export { classifyReversalEvent } from './reversal';
export type { DisputeFacts, RefundFacts, ReversalFacts } from './reversal';
export {
  applyStoredCharge,
  createWebhookReactor,
  type WebhookReactorPorts,
} from './webhook-reactor';
