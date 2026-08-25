export type {
  CatalogItem,
  CatalogRef,
  RawOffer,
  ResearchQuery,
  RunResult,
  RunStatus,
  ScoredOffer,
  SourceRecord,
  SourceStat,
  SourceType,
} from './types';
export type {
  BudgetPort,
  CachePort,
  CatalogAdapter,
  LoggerPort,
  RateLimiterPort,
  ResearchConfig,
  ResearchDeps,
  ResearchEventsPort,
  ResearchRunProgressEvent,
  ResearchStore,
  SourceDegradedEvent,
} from './ports';
export { cacheKey, defaultResearchConfig } from './ports';
export type {
  ConnectorContext,
  ConnectorResult,
  CredentialCheck,
  FetchFailure,
  FetchInit,
  FetchOutcome,
  PriceSourceConnector,
  SourceConfigCheck,
} from './connectors/types';
export { diagnosticsOf } from './connectors/types';
// The resolver trio, from the module that owns it. `http/types.ts` re-exports
// the same three so the HTTP surface's existing imports are untouched — one
// definition, two reachable paths, no copy.
export {
  resolveResearchCopy,
  type ResearchCopyResolver,
  type ResearchCopySource,
} from './copy-source';
export { ConnectorRegistry } from './connectors/registry';
export {
  CREDENTIALS_KEY,
  credentialsOf,
  ENCRYPTED_CREDENTIALS_KEY,
  INTEGRATION_SOURCE_TYPES,
  isIntegrationSourceType,
  NAMED_SOURCE_TYPES,
} from './integrations';
export type { IntegrationSourceType } from './integrations';
export { createManualConnector } from './connectors/manual';
export type { ManualPriceRecord, ManualPriceStore } from './connectors/manual';
export { createMercadoLivreConnector, parseMercadoLivreSearch } from './connectors/mercado-livre';
export type { MercadoLivreConnectorOptions } from './connectors/mercado-livre';
export { createMercadoLivreAuth } from './connectors/mercado-livre-auth';
export type { MercadoLivreAuth, MercadoLivreCredentials } from './connectors/mercado-livre-auth';
export { parseVtexResponse, vtexConnector } from './connectors/vtex';
export {
  VTEX_APP_KEY_FIELD,
  VTEX_APP_TOKEN_FIELD,
  VTEX_CREDENTIAL_FIELDS,
  vtexAuthInit,
} from './connectors/vtex-auth';
export type { VtexAppCredentials } from './connectors/vtex-auth';
export { createSerpConnector, parseSerpResponse } from './connectors/serp';
export type { SerpConnectorOptions } from './connectors/serp';
export { regionToLocation } from './connectors/serp-location';
export {
  AMAZON_BRAZIL_DOMAIN,
  createAmazonConnector,
  parseAmazonResponse,
} from './connectors/amazon';
export type { AmazonConnectorOptions } from './connectors/amazon';
export {
  buildSearchApiUrl,
  callSearchApi,
  SEARCHAPI_BASE_URL,
  SEARCHAPI_BUDGET_SCOPE,
  searchTermOf,
} from './connectors/searchapi';
export type {
  SearchApiCallInput,
  SearchApiCallResult,
  SearchApiKeySource,
} from './connectors/searchapi';
export {
  guessHeaderMapping,
  manualPriceRowSchema,
  normalizeManualRows,
  parseCsvPriceList,
  readCsvHeaders,
} from './import/manual';
export type {
  CsvParseInput,
  ManualPriceRowInput,
  ManualRowProblem,
  MappableField,
  NormalizedManualRow,
} from './import/manual';
export { runResearch } from './pipeline/run-research';
export type { RunResearchInput } from './pipeline/run-research';
export {
  decodeResearchRunWireEvent,
  RESEARCH_RUN_REALTIME_DOMAIN,
  toResearchRunWireEvent,
} from './pipeline/progress-wire';
export type { ResearchRunWireEvent } from './pipeline/progress-wire';
export { normalizeText, tokenize, volumeTokenToMl } from './normalize/text';
export { availabilityFromText } from './normalize/availability';
// The words this package READS in somebody else's data — required config, and
// the Brazilian pack a host passes by hand (FUT-760).
export type { MarketVocabulary } from './normalize/vocabulary';
export { PT_BR_MARKET_VOCABULARY } from './normalize/pt-BR';
export { EN_US_MARKET_VOCABULARY } from './normalize/en-US';
export {
  MARKET_VOCABULARY,
  RESEARCH_BUDGET_COPY,
  RESEARCH_DIAGNOSTICS,
  RESEARCH_HTTP_MESSAGES,
  RESEARCH_PERMISSION_LABELS,
} from './locales';
export { isBrlPrice } from './normalize/currency';
export { parseMoneyToCents } from './normalize/money';
export { parsePack } from './normalize/pack';
export type { PackInfo } from './normalize/pack';
export { scoreRelevance } from './scoring/relevance';
export type { OfferText, RelevanceInput } from './scoring/relevance';
export {
  compareTermMatchRank,
  distinctiveTermTokens,
  matchResearchTerm,
} from './scoring/term-match';
export type { TermMatch, TermMatchTier } from './scoring/term-match';
export { effectiveUnitCents, rankOffers } from './ranking/rank';
export { dedupeOffers, offerIdentity } from './ranking/dedupe';
export {
  flagSuspectUnitPrices,
  medianUnitPriceCents,
  MIN_PLAUSIBILITY_SAMPLE,
  suspectUnitPriceFlags,
  SUSPECT_UNIT_PRICE_MULTIPLE,
} from './ranking/plausibility';
export type { UnitPriceCandidate } from './ranking/plausibility';
export {
  FixedBudget,
  InMemoryCache,
  InMemoryRateLimiter,
  InMemoryResearchStore,
  silentLogger,
} from './memory';
export {
  offerOutputSchema,
  researchQuerySchema,
  sourceStatSchema,
  startResearchSchema,
} from './schemas';
export type { OfferOutput, ResearchQueryInput, StartResearchInput } from './schemas';
