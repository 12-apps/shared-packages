/**
 * `@12-apps/stock-domain` — closed vocabularies for a stock-movement reason
 * taxonomy, assembled from values the ADOPTING APPLICATION declares.
 *
 * This package used to publish those values. Two arrays sat here as constants,
 * with two derived types, two derived defaults and two type guards over them —
 * and they were one application's ledger vocabulary, extracted with it. Every
 * host that installed this package inherited that application's directions, its
 * sub-classifications and its choice of which one a bad row falls back to,
 * without ever choosing any of the three. Worse, a host does not merely USE
 * them: those arrays reached its wire contract, where a schema built from them
 * advertised one product's ledger vocabulary as the published, agent-facing
 * type of a field on every adopter's API.
 *
 * What is a fact about a stock ledger, and stays: that a movement reason sits
 * on a DIRECTION axis which decides the sign, that a second axis
 * sub-classifies some directions and is inert on the others, that both axes are
 * CLOSED sets, and that the set a write is validated against must be the same
 * set a read is narrowed with. That last one is why the vocabulary is an object
 * rather than an array plus a guard: the predicate is stated once and derived
 * from a frozen copy of the values, so the two sides have nothing to drift
 * apart from.
 *
 * Deliberately zero-dependency and free of framework code. A host's server
 * repositories, its HTTP handlers, its report engine and its browser bundles
 * all import this, so anything heavier here is dragged into all four.
 *
 * Adoption, and what replaced each removed export: `ADOPTING.md`.
 */

export { StockDomainConfigError, StockValueError } from './errors';
export {
  defineVocabulary,
  type Vocabulary,
  type VocabularySpec,
  type VocabularyValue,
} from './vocabulary';
export {
  defineStockReasonTaxonomy,
  type StockReasonTaxonomy,
  type StockReasonTaxonomySpec,
} from './taxonomy';
