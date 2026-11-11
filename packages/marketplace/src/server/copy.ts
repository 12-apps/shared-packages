import type { BulkProblemCode } from "../core/bulk";
import type { DecisionProblemCode } from "../core/cancellation";

/** Every problem code a route can answer, decisions and bulk writes alike. */
export type MarketplaceProblemCode = DecisionProblemCode | BulkProblemCode;

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
}
