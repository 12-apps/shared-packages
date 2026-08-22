import type { FetchFailure } from './types';

/**
 * Every sentence this package's connectors put in front of a store owner when a
 * price source fails, as REQUIRED host config (FUT-760).
 *
 * These read as diagnostics, not as strings for a developer: they are stored on
 * the run and rendered on the sources screen, and they tell an operator which
 * field to fix. That makes them product copy, and the package shipping them in
 * pt-BR made one product's Portuguese every adopter's silent default.
 *
 * They travel on {@link ConnectorContext} rather than as a parameter on each
 * helper, because that is the object which already reaches every one of these
 * call sites — a connector holds a `ctx` precisely so a host can supply what
 * only a host knows.
 */

/** The transport half: why a GET did not produce usable JSON. */
export interface FetchFailureCopy {
  /** A URL that will not even parse, shown in place of the endpoint. */
  invalidUrl: string;
  /** 401/403 — the far end refused us outright. */
  refused(status: number): string;
  notFound: string;
  rateLimited(status: number): string;
  serverError(status: number): string;
  /** Any other 4xx. */
  rejected(status: number): string;
  /** The name in the source's URL does not resolve — a typo, not an outage. */
  dnsUnresolved: string;
  /** DNS itself failed transiently. */
  dnsTransient: string;
  /**
   * We DECLINED to follow a redirect because the credential headers could not
   * travel with it — nothing failed on the network.
   */
  credentialsStripped: string;
  /** A transport failure with no code to name. */
  transport: string;
  /** A transport failure carrying a code worth printing. */
  transportCoded(code: string): string;
  /** A 2xx that was not JSON — usually an error or block page. */
  notJson(status: number): string;
  timeout: string;
  /** OUR own source ceiling ran out before this exchange was even sent. */
  deadline: string;
}

/** The "this source's config does not parse" sentence. */
export interface SourceConfigCopy {
  /** The whole config failed, so no field can be named. */
  invalid(sourceLabel: string): string;
  /** Specific fields failed. Never carries a VALUE — only paths. */
  invalidFields(sourceLabel: string, fields: readonly string[]): string;
}

/** The paid search provider's own failures. */
export interface SearchApiCopy {
  /** The timeout budget, phrased the way an operator thinks about it. */
  timedOut(budget: string): string;
  keyRefused(status: number): string;
  rateLimited: string;
  endpointNotFound: string;
  providerError(status: number): string;
  rejected(status: number): string;
  notJson(status: number): string;
  /** Appended when the failure may still have burned a paid credit. */
  creditMaybeSpent: string;
  /** Appended when it definitely did not. */
  creditNotSpent: string;
  transport: string;
  transportCoded(code: string): string;
  /** A timeout that may have burned a credit, and one that provably did not. */
  timedOutMaybeSpent(budget: string): string;
  deadlineNotSpent: string;
  /** Every SearchApi line is prefixed with the engine that produced it. */
  prefixed(engine: string, reason: string): string;
  keyMissing(engine: string): string;
  vendorRefusedSilently(engine: string): string;
  payloadShape(engine: string): string;
  vendorError(engine: string, vendorError: string): string;
}

/** VTEX's per-tier failures. */
export interface VtexCopy {
  /** What each VTEX call is called, keyed by tier id. */
  tiers: Readonly<Record<string, string>>;
  /** A tier failed; `reason` comes from {@link FetchFailureCopy}. */
  tierFailed(tier: string, reason: string): string;
  /** Appended when an application key was sent and may itself be stale. */
  keyDoubt: string;
  endpoint(url: string): string;
}

/** Saving a VTEX source: what a rejected URL is told. */
export interface VtexValidateCopy {
  urlMissing: string;
  urlHasCredentials: string;
  /** Shared tail asking the operator to retry. */
  retryHint: string;
  /**
   * Suggests the `www` host when the apex was given. Only the HOSTNAME travels
   * in, so a URL's query string or userinfo never can.
   */
  apexHint(hostname: string): string;
  /** Nothing answered at all; `reason` comes from {@link FetchFailureCopy}. */
  unreachable(reason: string, apexHint: string): string;
  timedOut(retryHint: string, apexHint: string): string;
  /** Answered, but protectively or temporarily — never "not a VTEX store". */
  unverifiable(reason: string, retryHint: string): string;
  notVtex(status: number | undefined, apexHint: string): string;
  keyRejected: string;
  redirectsAway(apexHint: string): string;
}

/** The one sentence a source that ran out of its wall-clock budget carries. */
export interface SourceBudgetCopy {
  ceilingReached: string;
}

/**
 * Why one row of a manually imported price sheet was rejected or degraded.
 *
 * Note this is the COPY half of `import/manual.ts` only. That module's
 * column-synonym tables (`produto`, `preço`, `código de barras`, …) are INPUT
 * GRAMMAR — they match the headers a Brazilian distributor's spreadsheet
 * actually carries — and translating them would simply stop the importer
 * matching. They stay in the package, and stay on the ratchet for that reason.
 */
export interface ManualImportCopy {
  unreadablePrice(raw: string): string;
  invalidEan(raw: string): string;
  invalidValidUntil(raw: string): string;
  /** The upload carried a header row and nothing else. */
  emptyFile: string;
  missingRequiredColumns: string;
  unimportableRow(path: string, message: string): string;
}

export interface ResearchDiagnosticsCopy {
  manualImport: ManualImportCopy;
  fetch: FetchFailureCopy;
  sourceConfig: SourceConfigCopy;
  searchApi: SearchApiCopy;
  vtex: VtexCopy;
  vtexValidate: VtexValidateCopy;
  budget: SourceBudgetCopy;
}

