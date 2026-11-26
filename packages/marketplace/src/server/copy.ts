import type { BulkProblemCode } from "../core/bulk";
import type { DecisionProblemCode } from "../core/cancellation";
import type { LinkRefusalCode } from "../core/linking";

/**
 * Every problem code a route words from `problems`, decisions and bulk writes
 * alike. MERCHANT_TAKEN is worded by `link.problems` instead (FUT-5613), so a
 * host's own pack written against 1.x still compiles.
 */
export type MarketplaceProblemCode = DecisionProblemCode | Exclude<BulkProblemCode, "MERCHANT_TAKEN">;

/**
 * Every sentence the marketplace routes answer with. Required, no defaults
 * (the copy-port doctrine): two packs sit beside it (`./pt-BR`, `./en-US`),
 * and a host passes one by hand, or its own — English for the MCP, by the
 * agent-text rule.
 *
 * The webhook answers a marketplace's server, not a person, so its bodies are
 * machine codes and need no copy.
 */
export interface MarketplaceServerCopy {
  /** A body, query or path parameter that does not parse. */
  invalidInput: string;
  /** A write refused as a whole: nothing was saved. */
  nothingSaved: string;
  /** A decision on an order no longer on the clock (409). */
  orderNoLongerPending: string;
  /** One sentence per problem code, for each `problems[].message`. */
  problems: Readonly<Record<MarketplaceProblemCode, string>>;
  /**
   * OPTIONAL in the type, so a host's own pack written against 1.x still
   * compiles: the sentences of the linking routes (FUT-5613). Absent, those
   * routes answer the machine code as `error`. Both shipped packs carry it.
   */
  link?: MarketplaceLinkCopy;
}

/** What the linking routes say: one sentence per refusal, and one for "try again". */
export interface MarketplaceLinkCopy {
  problems: Readonly<Record<LinkRefusalCode, string>>;
  /** The marketplace did not answer (a timeout, a 5xx, a rate limit). */
  tryAgain: string;
}
