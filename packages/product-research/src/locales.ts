import type { ResearchDiagnosticsCopy } from './connectors/diagnostics-copy';
import {
  EN_US_RESEARCH_BUDGET_COPY,
  EN_US_RESEARCH_DIAGNOSTICS,
  EN_US_RESEARCH_MESSAGES,
  EN_US_RESEARCH_PERMISSION_LABELS,
} from './en-US';
import type { ResearchHttpMessages } from './http';
import { EN_US_MARKET_VOCABULARY } from './normalize/en-US';
import { PT_BR_MARKET_VOCABULARY } from './normalize/pt-BR';
import type { MarketVocabulary } from './normalize/vocabulary';
import type { ResearchBudgetCopy } from './notifications';
import {
  PT_BR_RESEARCH_BUDGET_COPY,
  PT_BR_RESEARCH_DIAGNOSTICS,
  PT_BR_RESEARCH_MESSAGES,
  PT_BR_RESEARCH_PERMISSION_LABELS,
} from './pt-BR';

/**
 * Both languages, keyed by tag — what a host hands to `@12-apps/i18n` when the
 * reader's language is a property of the request rather than of the deployment.
 *
 * `MARKET_VOCABULARY` is keyed the same way and is NOT one of these. It parses
 * somebody else's storefront, so what selects between its entries is the MARKET
 * being searched, not the reader's preference: a Brazilian store selling to an
 * English-reading buyer still writes "esgotado". It is keyed by tag because
 * that is the natural name for a market, and a host wiring it off the reader's
 * locale would be making a category error the type cannot catch. Its own file
 * says so at length.
 *
 * `LocalePack` is mirrored here rather than imported so the package stays
 * liftable into a repo that has never heard of `@12-apps/i18n`.
 */
type LocalePack<T> = { readonly 'pt-BR': T; readonly 'en-US': T };

export const RESEARCH_HTTP_MESSAGES = {
  'pt-BR': PT_BR_RESEARCH_MESSAGES,
  'en-US': EN_US_RESEARCH_MESSAGES,
} as const satisfies LocalePack<ResearchHttpMessages>;

export const RESEARCH_BUDGET_COPY = {
  'pt-BR': PT_BR_RESEARCH_BUDGET_COPY,
  'en-US': EN_US_RESEARCH_BUDGET_COPY,
} as const satisfies LocalePack<ResearchBudgetCopy>;

export const RESEARCH_DIAGNOSTICS = {
  'pt-BR': PT_BR_RESEARCH_DIAGNOSTICS,
  'en-US': EN_US_RESEARCH_DIAGNOSTICS,
} as const satisfies LocalePack<ResearchDiagnosticsCopy>;

export const RESEARCH_PERMISSION_LABELS = {
  'pt-BR': PT_BR_RESEARCH_PERMISSION_LABELS,
  'en-US': EN_US_RESEARCH_PERMISSION_LABELS,
} as const;

/** Keyed by MARKET, not by reader — see the module docstring. */
export const MARKET_VOCABULARY = {
  'pt-BR': PT_BR_MARKET_VOCABULARY,
  'en-US': EN_US_MARKET_VOCABULARY,
} as const satisfies LocalePack<MarketVocabulary>;
