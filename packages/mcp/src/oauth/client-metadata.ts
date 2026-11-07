import { clientFromMetadataDocument } from "./client-metadata-document";
import { ClientMetadataDocumentError, ClientMetadataUnavailableError } from "./client-metadata-errors";
import {
  fetchMetadataDocument,
  type FetchMetadataDocument,
  type MetadataDocumentAnswer,
} from "./client-metadata-fetch";
import { isClientIdMetadataUrl, parseClientIdMetadataUrl } from "./client-metadata-url";
import type { OAuthClientStore, StoredOAuthClient } from "./stores";

export { clientFromMetadataDocument } from "./client-metadata-document";
export { ClientMetadataDocumentError, ClientMetadataUnavailableError } from "./client-metadata-errors";
export {
  createMetadataDocumentTransport,
  fetchMetadataDocument,
  publicOnlyLookup,
  type FetchMetadataDocument,
  type MetadataDocumentAnswer,
  type MetadataDocumentTransportDeps,
} from "./client-metadata-fetch";
export {
  isClientIdMetadataUrl,
  isNonPublicAddress,
  matchesLoopbackRedirectUri,
  parseClientIdMetadataUrl,
} from "./client-metadata-url";

/**
 * OAuth Client ID Metadata Documents (CIMD, draft-ietf-oauth-client-id-metadata-document)
 * — a client identified by a URL instead of a registration (FUT-4522).
 *
 * The MCP authorization spec recommends CIMD over dynamic registration, and the
 * hosts follow it: Claude's connector dialog defaults to "Use Claude's published
 * identity", which sends `client_id=https://claude.ai/oauth/mcp-oauth-client-metadata`
 * to `authorize`. With only registered clients known, that answered
 * `400 invalid_client: unknown client_id` before the sign-in page, and the
 * connector was left connected with no token.
 *
 * So a `client_id` that is an `https` URL is resolved by FETCHING the document it
 * names, and the document is the client (`./client-metadata-document.ts`).
 * Nothing is written to the client store: refresh tokens and connections key on
 * the `client_id` string, and the document stays the single source of truth for
 * what the client may do.
 *
 * The fetch is the dangerous half, bounded in `./client-metadata-url.ts` (which
 * URLs) and `./client-metadata-fetch.ts` (which addresses, how long, how big).
 * This file decides how long an answer is reused:
 *
 *  - a valid document for its response's `max-age`, clamped, else five minutes;
 *  - a refused document NEVER (draft §6.2), and a refusal ends any earlier trust;
 *  - through an outage (timeout, 5xx, network), the last valid document keeps
 *    serving up to a ceiling (draft §6.1), so a vendor's bad minute does not
 *    break live connections; with no earlier copy it is a retryable 503, never
 *    `invalid_client`.
 *
 * The consent screen remains the guard against a hostile document, exactly as it
 * is against a hostile registration: it names the client and the callback host
 * before anything is granted.
 */

/** What a host may tune; every field has a safe default. */
export interface ClientMetadataDocumentOptions {
  /** How long a document is reused when its response sets no `max-age`. Default 5 minutes. */
  cacheTtlMs?: number;
  /** The floor on a response's own `max-age` (and the lifetime of `no-store`). Default 1 minute. */
  minCacheTtlMs?: number;
  /** The ceiling on a response's own `max-age`. Default 24 hours. */
  maxCacheTtlMs?: number;
  /**
   * How long past its lifetime the last valid document keeps serving while the
   * URL fails transiently (timeout, 5xx, network). Default 24 hours.
   */
  staleIfErrorMs?: number;
  /** Most documents fetched at the same moment, across all URLs. Default 16. */
  maxConcurrentFetches?: number;
  /** Abort the whole exchange after this long. Default 5 seconds. */
  timeoutMs?: number;
  /** Refuse a body larger than this. Default 10 KiB (the draft suggests 5 KB). */
  maxBytes?: number;
  /** Most documents held in the cache at once. Default 512. */
  maxEntries?: number;
  /** The transport. Default {@link fetchMetadataDocument}. */
  fetchDocument?: FetchMetadataDocument;
  /** Clock, for tests. */
  now?: () => number;
}

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const DEFAULTS: Required<Omit<ClientMetadataDocumentOptions, "fetchDocument" | "now">> = {
  cacheTtlMs: 5 * MINUTE_MS,
  minCacheTtlMs: MINUTE_MS,
  maxCacheTtlMs: DAY_MS,
  staleIfErrorMs: DAY_MS,
  maxConcurrentFetches: 16,
  timeoutMs: 5000,
  maxBytes: 10 * 1024,
  maxEntries: 512,
};

type Settings = typeof DEFAULTS & { fetchDocument: FetchMetadataDocument; now: () => number };

function settingsOf(options: ClientMetadataDocumentOptions): Settings {
  // An explicit `undefined` keeps the default rather than erasing it.
  const given = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
  const merged = { ...DEFAULTS, fetchDocument: fetchMetadataDocument, now: Date.now, ...given } as Settings;
  return {
    ...merged,
    minCacheTtlMs: Math.min(merged.minCacheTtlMs, merged.cacheTtlMs),
    maxCacheTtlMs: Math.max(merged.maxCacheTtlMs, merged.cacheTtlMs),
  };
}

/** A good document, fresh until `freshUntil`, usable through an outage until `staleUntil`. */
interface CacheEntry {
  client: StoredOAuthClient;
  freshUntil: number;
  staleUntil: number;
}

/**
 * The lifetime a response asks for, clamped. `no-store`/`no-cache` keep it for
 * the floor only, so one flow's several lookups (authorize, consent, token)
 * still share one fetch.
 */
function lifetimeMs(cacheControl: string | undefined, settings: Settings): number {
  if (!cacheControl) return settings.cacheTtlMs;
  // Split, not matched: the header comes from the document's host.
  const directives = cacheControl.toLowerCase().split(",").map((part) => part.trim());
  if (directives.includes("no-store") || directives.includes("no-cache")) return settings.minCacheTtlMs;
  const maxAge = directives.find((part) => part.startsWith("max-age="))?.slice("max-age=".length);
  const seconds = maxAge === undefined ? Number.NaN : Number(maxAge);
  if (!Number.isInteger(seconds) || seconds < 0) return settings.cacheTtlMs;
  return Math.min(settings.maxCacheTtlMs, Math.max(settings.minCacheTtlMs, seconds * 1000));
}

const transient = (message: string): ClientMetadataDocumentError =>
  new ClientMetadataDocumentError(message, { transient: true });

/** A status that is the vendor's bad minute rather than a verdict on the client. */
function isTransientStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}

/** Fetch and validate one document, or throw the reason it cannot be used. */
async function loadDocument(clientId: string, scopes: readonly string[], settings: Settings): Promise<CacheEntry> {
  const url = parseClientIdMetadataUrl(clientId);
  let answer: MetadataDocumentAnswer;
  try {
    answer = await settings.fetchDocument(url, { timeoutMs: settings.timeoutMs, maxBytes: settings.maxBytes });
  } catch (error) {
    throw error instanceof ClientMetadataDocumentError ? error : transient("document could not be fetched");
  }
  if (isTransientStatus(answer.status)) throw transient(`document answered HTTP ${answer.status}`);
  // 200 only: a redirect is never followed (the draft forbids it), so a 3xx is a
  // refusal like any other status.
  if (answer.status !== 200) throw new ClientMetadataDocumentError(`document answered HTTP ${answer.status}`);
  let document: unknown;
  try {
    document = JSON.parse(answer.body);
  } catch {
    throw new ClientMetadataDocumentError("document is not JSON");
  }
  const client = clientFromMetadataDocument(clientId, document, scopes);
  const freshUntil = settings.now() + lifetimeMs(answer.cacheControl, settings);
  return { client, freshUntil, staleUntil: freshUntil + settings.staleIfErrorMs };
}

/** Insertion-ordered cache with a size ceiling; the oldest entry leaves first. */
function boundedCache(maxEntries: number) {
  const entries = new Map<string, CacheEntry>();
  return {
    get: (key: string) => entries.get(key),
    delete: (key: string) => entries.delete(key),
    set(key: string, entry: CacheEntry): CacheEntry {
      entries.delete(key);
      entries.set(key, entry);
      for (const oldest of entries.keys()) {
        if (entries.size <= maxEntries) break;
        entries.delete(oldest);
      }
      return entry;
    },
  };
}

/** One fetch per URL at a time, and a ceiling on fetches at all. */
function sharedFetcher(load: (clientId: string) => Promise<CacheEntry>, maxConcurrent: number) {
  const inFlight = new Map<string, Promise<CacheEntry>>();
  return (clientId: string): Promise<CacheEntry> => {
    const pending = inFlight.get(clientId);
    if (pending) return pending;
    if (inFlight.size >= maxConcurrent) {
      return Promise.reject(transient("too many metadata documents being fetched"));
    }
    const started = load(clientId).finally(() => inFlight.delete(clientId));
    inFlight.set(clientId, started);
    return started;
  };
}

/** Fetches, validates and caches metadata documents. One per surface. */
export interface ClientMetadataDocumentResolver {
  /**
   * The client the document at `clientId` describes; `null` when the document is
   * refused (a bad URL, a non-200 answer, an invalid document). Throws
   * {@link ClientMetadataUnavailableError} when it cannot be fetched right now
   * and no earlier copy can stand in.
   */
  resolve(clientId: string): Promise<StoredOAuthClient | null>;
}

export function createClientMetadataDocumentResolver(
  scopes: readonly string[],
  options: ClientMetadataDocumentOptions = {},
  onRefusal: (clientId: string, reason: string) => void = () => {},
): ClientMetadataDocumentResolver {
  const settings = settingsOf(options);
  const cache = boundedCache(settings.maxEntries);
  const fetchShared = sharedFetcher((clientId) => loadDocument(clientId, scopes, settings), settings.maxConcurrentFetches);

  /** What a failed fetch leaves the caller with. */
  function afterFailure(clientId: string, error: unknown, cached: CacheEntry | undefined): StoredOAuthClient | null {
    const failure = error instanceof ClientMetadataDocumentError ? error : transient("document could not be resolved");
    if (!failure.transient) {
      // A refused document is never cached, and it ends any earlier trust: the
      // client now says something else about itself.
      cache.delete(clientId);
      onRefusal(clientId, failure.message);
      return null;
    }
    if (cached && cached.staleUntil > settings.now()) {
      // Through an outage, retry at most once per floor interval: without this,
      // every request would first wait out the fetch timeout before being served.
      cache.set(clientId, { ...cached, freshUntil: settings.now() + settings.minCacheTtlMs });
      onRefusal(clientId, `${failure.message}; serving the last valid document`);
      return cached.client;
    }
    onRefusal(clientId, failure.message);
    throw new ClientMetadataUnavailableError(failure.message);
  }

  return {
    async resolve(clientId) {
      const cached = cache.get(clientId);
      if (cached && cached.freshUntil > settings.now()) return cached.client;
      try {
        return cache.set(clientId, await fetchShared(clientId)).client;
      } catch (error) {
        return afterFailure(clientId, error, cached);
      }
    },
  };
}

/**
 * The client store a surface reads through: a registered id goes to the host's
 * store exactly as before; a metadata-document URL goes to the resolver. `create`
 * is untouched — registration still only ever mints UUIDs.
 */
export function withClientMetadataDocuments(
  store: OAuthClientStore,
  resolver: ClientMetadataDocumentResolver,
): OAuthClientStore {
  return {
    create: (client) => store.create(client),
    async findByClientId(clientId) {
      if (isClientIdMetadataUrl(clientId)) return resolver.resolve(clientId);
      return store.findByClientId(clientId);
    },
  };
}
