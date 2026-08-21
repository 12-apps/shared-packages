import type { NormalizedManualRow } from '../import/manual';

/**
 * `createApiProductResearch` — the research HTTP surface as framework-neutral
 * route descriptors (the wiring contract's `http` capability; the shapes are
 * structural twins, checked in the manifest compliance suite).
 *
 * What used to be origin-host route files becomes sixteen descriptors, split
 * the way the pipeline's ports already split the world:
 *
 * - the PACKAGE owns the surface — paths, the `{ data }` envelopes, the 202
 *   accepted-then-poll posture, the credential-field completeness rule, the
 *   probe-before-persist ordering, the CSV/quote normalization it already
 *   ships, and every status code;
 * - the HOST owns what it always owned — the guards (each route declares the
 *   package's own permission id for the host to map), validation in its own
 *   schema language, storage ({@link ResearchHttpStore}), the connector
 *   probes and the SSRF gate ({@link ResearchHttpChecks}), the credential
 *   encryption ({@link ResearchCredentialCodec}), and every operator-facing
 *   sentence ({@link ResearchHttpMessages} — the `./pt-BR` named pack ships
 *   the origin host's set for a pt-BR host to pass, the realtime doctrine).
 *
 * ONE route of the eleven stays deliberately host code: the history grid's
 * `GET /research` listing. Its query grammar and result envelope come from
 * the host's own search machinery (facets, sort keys and pagination derived
 * from a host grid config over host-named columns), so a descriptor here
 * could only restate that config or drift from it. The start POST on the
 * same path is declared; the listing rides beside it as a host route.
 */

/** The caller a host's adapter resolves before any research route runs. */
export interface ResearchHttpActor {
  clientId: string;
  userId: string;
}

/** Structural twin of the wiring contract's `WireRequest`. */
export interface ResearchHttpRequest {
  actor: ResearchHttpActor;
  params: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  body?: unknown;
}

/** Structural twin of the wiring contract's `WireResponse`. */
export interface ResearchHttpResponse {
  status: number;
  body: unknown;
}

/** Structural twin of the wiring contract's `WireRoute` (policy included). */
export interface ResearchRoute {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Relative to the host's mount, `:param` form. */
  path: string;
  /** One of this package's own permission ids — see `./contribution`. */
  permission: string;
  handle(request: ResearchHttpRequest): Promise<ResearchHttpResponse>;
}

/** A connector probe's verdict: `null` means "no probe for this type". */
export type ResearchCheckResult = { ok: true } | { ok: false; error: string } | null;

/**
 * The host-owned safety seams, exactly as the origin host runs them:
 * `integrationCredentials` probes a paid connector's key, `sourceConfig`
 * probes a store config live before it is persisted, and `publicUrlViolation`
 * is the SSRF gate over where the WORKER will fetch on a tenant's behalf
 * (`null` means acceptable). All three refuse with operator-facing reasons in
 * the HOST's language — the package forwards them verbatim.
 */
export interface ResearchHttpChecks {
  integrationCredentials(
    type: string,
    credentials: Record<string, string>,
  ): Promise<ResearchCheckResult>;
  sourceConfig(type: string, config: Record<string, unknown>): Promise<ResearchCheckResult>;
  publicUrlViolation(url: string): Promise<string | null>;
}

/** At-rest credential handling — encryption is the host's, names stay names. */
export interface ResearchCredentialCodec {
  encode(credentials: Record<string, string>): string;
  /** A masked hint safe to show on a roster; never the value. */
  hint(credentials: Record<string, string>): string;
}

/** What a stored credential write carries — the host's row shape. */
export interface ResearchCredentialRecord {
  credentialsEncrypted: string;
  credentialHint: string;
  credentialStatus: 'VERIFIED' | 'UNVERIFIED';
  checkedAt: Date;
}

/**
 * Persistence, as the routes need it — the host implements this over its own
 * ORM (the same posture as the pipeline's `ResearchStore`). Views come back
 * exactly as the host's clients read them; the package never reshapes rows.
 */
export interface ResearchHttpStore {
  requests: {
    create(
      clientId: string,
      input: {
        term: string;
        brand?: string;
        ean?: string;
        quantity: number;
        region?: string;
        catalogRefType?: string;
        catalogRefId?: string;
        requestedBy: string;
      },
    ): Promise<{ id: string }>;
    /** One request with its latest run — the poll target after a start. */
    view(requestId: string, clientId: string): Promise<unknown>;
    /** One run with its per-source stats and ranked offers. */
    run(runId: string, clientId: string): Promise<unknown>;
    /**
     * Durable row first, then the enqueue — which must NEVER throw:
     * `enqueued: false` still answers 202 (a reconciliation sweep re-enqueues
     * run-less requests), so an accepted request is never silently lost.
     */
    enqueueRun(clientId: string, requestId: string): Promise<{ enqueued: boolean }>;
  };
  integrations: {
    list(clientId: string): Promise<readonly Record<string, unknown>[]>;
    save(
      clientId: string,
      type: string,
      record: ResearchCredentialRecord & { enabled: boolean },
    ): Promise<Record<string, unknown>>;
    setEnabled(clientId: string, type: string, enabled: boolean): Promise<Record<string, unknown>>;
    remove(clientId: string, type: string): Promise<void>;
  };
  sources: {
    list(clientId: string): Promise<unknown>;
    create(clientId: string, body: unknown): Promise<unknown>;
    update(sourceId: string, clientId: string, body: unknown): Promise<unknown>;
    archive(sourceId: string, clientId: string): Promise<void>;
    /** The stored row's connector type; `null` lets `update` answer the 404. */
    typeOf(sourceId: string, clientId: string): Promise<string | null>;
  };
  credentials: {
    /** The target source with its stored (already scrubbed) config. */
    requireSource(
      sourceId: string,
      clientId: string,
    ): Promise<{ type: string; config: Record<string, unknown> }>;
    save(sourceId: string, clientId: string, record: ResearchCredentialRecord): Promise<unknown>;
    remove(sourceId: string, clientId: string): Promise<unknown>;
  };
  manual: {
    /** The MANUAL source a price write targets; throws the host's 404/422. */
    requireSource(sourceId: string, clientId: string): Promise<{ id: string; name: string }>;
    listPrices(
      clientId: string,
      sourceId: string,
      query: { page: number; pageSize: number },
    ): Promise<unknown>;
    store(input: {
      clientId: string;
      sourceId: string;
      defaultSupplierName: string;
      entries: NormalizedManualRow[];
      replace: boolean;
    }): Promise<{ imported: number; batchId: string; replaced: boolean }>;
  };
}

/**
 * Every sentence this surface can answer with — REQUIRED, the host's words
 * (the realtime `messages` doctrine). A pt-BR host passes
 * `PT_BR_RESEARCH_MESSAGES` from `./pt-BR` — the named pack carrying the
 * exact set the origin host's routes already answered with.
 */
export interface ResearchHttpMessages {
  /** 422 — a paid connector's provider refused the submitted key. */
  credentialRefused(reason: string): string;
  /** 400 — the SSRF gate refused a connector base URL. */
  sourceUrlRejected(violation: string): string;
  /** 422 — a named source whose connector reads no application key. */
  keylessSource: string;
  /** 422 — the submitted key is missing or misnaming this connector's fields. */
  incompleteCredentialFields(fields: readonly string[]): string;
  /** 400 — a typed quote that normalizes to nothing, with no row reason. */
  invalidQuote: string;
}

export interface ResearchApiConfig {
  store: ResearchHttpStore;
  checks: ResearchHttpChecks;
  credentials: ResearchCredentialCodec;
  messages: ResearchHttpMessages;
  /**
   * The connector registry as MOUNTED by this host: which types exist here.
   * Feeds the `mounted` flag on integrations and `meta.mountedTypes` on the
   * source roster — an unmounted type is still configurable, visibly.
   */
  connectors: {
    isMounted(type: string): boolean;
    types(): readonly string[];
    /** The credential field names a NAMED type's connector reads; `undefined` = keyless. */
    credentialFieldsFor(type: string): readonly string[] | undefined;
  };
  /** Injectable clock for the credential `checkedAt` stamp and quote validity. */
  now?: () => Date;
}

export interface ResearchApi {
  routes: readonly ResearchRoute[];
}

/** Days a manual price stays valid when the row and the import name none. */
export const MANUAL_PRICE_DEFAULT_VALIDITY_DAYS = 7;
