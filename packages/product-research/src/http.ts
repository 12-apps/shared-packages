import { normalizeManualRows, parseCsvPriceList } from './import/manual';
import type { ManualPriceRowInput, ManualRowProblem, NormalizedManualRow } from './import/manual';
import { CREDENTIALS_KEY } from './integrations';

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
 *   sentence ({@link ResearchHttpMessages} — `PT_BR_RESEARCH_MESSAGES` ships
 *   as a pack a pt-BR host passes, the realtime `messages` doctrine).
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
 * {@link PT_BR_RESEARCH_MESSAGES}, which is the exact set the origin host's
 * routes already answered with.
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

/** The origin host's sentences, verbatim — pass to `messages`. */
export const PT_BR_RESEARCH_MESSAGES: ResearchHttpMessages = {
  credentialRefused: (reason) => `Credencial recusada pelo provedor: ${reason}`,
  sourceUrlRejected: (violation) => `URL da fonte rejeitada: ${violation}`,
  keylessSource: 'Esta fonte de preços não usa chave de aplicação.',
  incompleteCredentialFields: (fields) => `Informe todos os campos da chave: ${fields.join(', ')}.`,
  invalidQuote: 'Cotação inválida.',
};

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

const READ = 'research:read';
const WRITE = 'research:write';

function ok(data: unknown, status = 200): ResearchHttpResponse {
  return { status, body: { data } };
}

function refuse(status: number, error: string): ResearchHttpResponse {
  return { status, body: { error } };
}

function recordOf(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
}

function intOf(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * The submitted field names must be EXACTLY what this source's connector
 * reads — an unknown name is a key nothing will ever send, and a missing one
 * is a half-configured pair whose provider rejection would then be misread
 * as the store blocking us. Names only; no value is ever echoed.
 */
function credentialFieldsProblem(
  fields: readonly string[] | undefined,
  credentials: Record<string, string>,
  messages: ResearchHttpMessages,
): string | null {
  if (fields === undefined) return messages.keylessSource;
  const submitted = Object.keys(credentials);
  const complete =
    submitted.length === fields.length && fields.every((field) => submitted.includes(field));
  return complete ? null : messages.incompleteCredentialFields(fields);
}

function credentialsOf(body: Record<string, unknown>): Record<string, string> {
  const submitted = recordOf(body['credentials']);
  return Object.fromEntries(
    Object.entries(submitted).filter((entry): entry is [string, string] => {
      return typeof entry[1] === 'string';
    }),
  );
}

export function createApiProductResearch(config: ResearchApiConfig): ResearchApi {
  for (const key of ['store', 'checks', 'credentials', 'messages', 'connectors'] as const) {
    if (config?.[key] === undefined) {
      throw new Error(`createApiProductResearch needs ${key} — a host decision with no default.`);
    }
  }
  const { store, checks, credentials: codec, messages, connectors } = config;
  const now = config.now ?? ((): Date => new Date());

  const defaultValidUntil = (named: unknown): Date => {
    if (typeof named === 'string' && named !== '') return new Date(named);
    const stamp = new Date(now());
    stamp.setUTCDate(stamp.getUTCDate() + MANUAL_PRICE_DEFAULT_VALIDITY_DAYS);
    return stamp;
  };

  const withMounted = (integration: Record<string, unknown>): Record<string, unknown> => ({
    ...integration,
    mounted: connectors.isMounted(String(integration['type'] ?? '')),
  });

  /** The SSRF veto over an editable base URL, before anything persists. */
  const baseUrlProblem = async (config_: Record<string, unknown> | undefined): Promise<string | null> => {
    const baseUrl = config_?.['baseUrl'];
    if (typeof baseUrl !== 'string') return null;
    const violation = await checks.publicUrlViolation(baseUrl);
    return violation === null ? null : messages.sourceUrlRejected(violation);
  };

  const routes: ResearchRoute[] = [
    {
      method: 'POST',
      path: '/research',
      permission: WRITE,
      // Asynchronous by design: persist the request, enqueue the run and
      // answer 202 — a fan-out over external storefronts has no business
      // inside a request/response window. `enqueued: false` still answers
      // 202 with the request persisted; the reconciliation sweep re-enqueues.
      async handle({ actor, body }) {
        const record = recordOf(body);
        const query = recordOf(record['query']);
        const catalogRef = record['catalogRef'] === undefined ? undefined : recordOf(record['catalogRef']);
        const { id: requestId } = await store.requests.create(actor.clientId, {
          term: String(query['term'] ?? ''),
          ...(query['brand'] !== undefined ? { brand: String(query['brand']) } : {}),
          ...(query['ean'] !== undefined ? { ean: String(query['ean']) } : {}),
          quantity: typeof query['quantity'] === 'number' ? query['quantity'] : 1,
          ...(query['region'] !== undefined ? { region: String(query['region']) } : {}),
          ...(catalogRef !== undefined
            ? { catalogRefType: String(catalogRef['type']), catalogRefId: String(catalogRef['id']) }
            : {}),
          requestedBy: actor.userId,
        });
        const enqueue = await store.requests.enqueueRun(actor.clientId, requestId);
        return ok({ requestId, enqueued: enqueue.enqueued }, 202);
      },
    },
    {
      method: 'GET',
      path: '/research/requests/:requestId',
      permission: READ,
      // Closes the polling loop the 202 advertises: the run is created BY the
      // background job, so the accepted answer cannot carry a runId — callers
      // poll here until `latestRun` appears, then follow it to the run.
      async handle({ actor, params }) {
        return ok(await store.requests.view(params['requestId'] ?? '', actor.clientId));
      },
    },
    {
      method: 'GET',
      path: '/research/runs/:runId',
      permission: READ,
      async handle({ actor, params }) {
        return ok(await store.requests.run(params['runId'] ?? '', actor.clientId));
      },
    },
    {
      method: 'GET',
      path: '/research/integrations',
      permission: READ,
      // `mounted` says whether THIS server has the connector registered — an
      // unmounted type is still configurable (the key is stored, visibly
      // unverified) and starts participating the moment the connector lands.
      async handle({ actor }) {
        const integrations = await store.integrations.list(actor.clientId);
        return ok(integrations.map(withMounted));
      },
    },
    {
      method: 'PUT',
      path: '/research/integrations/:type',
      permission: WRITE,
      // Create-or-replace: the singleton invariant means a second save swaps
      // the key, never adds a row. The key is verified through the probe
      // seam; no probe (or an unreachable provider) stores it visibly
      // UNVERIFIED — never a blocked save.
      async handle({ actor, params, body }) {
        const record = recordOf(body);
        const submitted = credentialsOf(record);
        const type = params['type'] ?? '';
        const check = await checks.integrationCredentials(type, submitted);
        if (check !== null && !check.ok) return refuse(422, messages.credentialRefused(check.error));
        const integration = await store.integrations.save(actor.clientId, type, {
          credentialsEncrypted: codec.encode(submitted),
          credentialHint: codec.hint(submitted),
          credentialStatus: check === null ? 'UNVERIFIED' : 'VERIFIED',
          checkedAt: now(),
          enabled: record['enabled'] !== false,
        });
        return ok(withMounted(integration));
      },
    },
    {
      method: 'PATCH',
      path: '/research/integrations/:type',
      permission: WRITE,
      async handle({ actor, params, body }) {
        const integration = await store.integrations.setEnabled(
          actor.clientId,
          params['type'] ?? '',
          recordOf(body)['enabled'] === true,
        );
        return ok(withMounted(integration));
      },
    },
    {
      method: 'DELETE',
      path: '/research/integrations/:type',
      permission: WRITE,
      async handle({ actor, params }) {
        await store.integrations.remove(actor.clientId, params['type'] ?? '');
        return ok({ deleted: true });
      },
    },
    {
      method: 'GET',
      path: '/research/sources',
      permission: READ,
      // `meta.mountedTypes` is the registry AS MOUNTED by this host: a source
      // of any other type only ever runs SKIPPED, so the create dialog
      // derives its selectable options from here.
      async handle({ actor }) {
        const data = await store.sources.list(actor.clientId);
        return { status: 200, body: { data, meta: { mountedTypes: connectors.types() } } };
      },
    },
    {
      method: 'POST',
      path: '/research/sources',
      permission: WRITE,
      // SSRF veto first, live reachability probe second, write third —
      // nothing persists on a refusal, so a store merely down for a minute
      // is never made unaddable; the operator retries.
      async handle({ actor, body }) {
        const record = recordOf(body);
        const urlProblem = await baseUrlProblem(recordOf(record['config']));
        if (urlProblem !== null) return refuse(400, urlProblem);
        const check = await checks.sourceConfig(
          String(record['type'] ?? ''),
          recordOf(record['config']),
        );
        if (check !== null && !check.ok) return refuse(422, check.error);
        return ok(await store.sources.create(actor.clientId, body));
      },
    },
    {
      method: 'PATCH',
      path: '/research/sources/:sourceId',
      permission: WRITE,
      // Renames and/or replaces the connector config, never the type — a
      // source's identity is its connector. An edited config re-proves both
      // gates; a rename (no config) touches no connector setting and skips
      // the probe. The stored row answers the 404 through `update`.
      async handle({ actor, params, body }) {
        const record = recordOf(body);
        const sourceId = params['sourceId'] ?? '';
        const edited = record['config'] === undefined ? undefined : recordOf(record['config']);
        if (edited !== undefined) {
          const urlProblem = await baseUrlProblem(edited);
          if (urlProblem !== null) return refuse(400, urlProblem);
          const type = await store.sources.typeOf(sourceId, actor.clientId);
          if (type !== null) {
            const check = await checks.sourceConfig(type, edited);
            if (check !== null && !check.ok) return refuse(422, check.error);
          }
        }
        return ok(await store.sources.update(sourceId, actor.clientId, body));
      },
    },
    {
      method: 'DELETE',
      path: '/research/sources/:sourceId',
      permission: WRITE,
      // A SOFT archive: the source leaves the roster and stops joining new
      // runs; finished runs keep every offer it produced.
      async handle({ actor, params }) {
        const sourceId = params['sourceId'] ?? '';
        await store.sources.archive(sourceId, actor.clientId);
        return ok({ id: sourceId });
      },
    },
    {
      method: 'PUT',
      path: '/research/sources/:sourceId/credentials',
      permission: WRITE,
      // The key of ONE named source. Probed against the stored connector
      // settings plus the submitted key — the exact request a run will make —
      // and stored UNVERIFIED even on a pass: the probe proves the store
      // answers, never that it CHECKED the key.
      async handle({ actor, params, body }) {
        const sourceId = params['sourceId'] ?? '';
        const submitted = credentialsOf(recordOf(body));
        const target = await store.credentials.requireSource(sourceId, actor.clientId);
        const fieldProblem = credentialFieldsProblem(
          connectors.credentialFieldsFor(target.type),
          submitted,
          messages,
        );
        if (fieldProblem !== null) return refuse(422, fieldProblem);
        const check = await checks.sourceConfig(target.type, {
          ...target.config,
          [CREDENTIALS_KEY]: submitted,
        });
        if (check !== null && !check.ok) return refuse(422, check.error);
        const source = await store.credentials.save(sourceId, actor.clientId, {
          credentialsEncrypted: codec.encode(submitted),
          credentialHint: codec.hint(submitted),
          credentialStatus: 'UNVERIFIED',
          checkedAt: now(),
        });
        return ok(source);
      },
    },
    {
      method: 'DELETE',
      path: '/research/sources/:sourceId/credentials',
      permission: WRITE,
      async handle({ actor, params }) {
        return ok(await store.credentials.remove(params['sourceId'] ?? '', actor.clientId));
      },
    },
    {
      method: 'GET',
      path: '/research/sources/:sourceId/prices',
      permission: READ,
      // Expired entries stay listed for audit; they no longer join new runs.
      async handle({ actor, params, query }) {
        const sourceId = params['sourceId'] ?? '';
        await store.manual.requireSource(sourceId, actor.clientId);
        const page = await store.manual.listPrices(actor.clientId, sourceId, {
          page: intOf(query['page'], 1),
          pageSize: intOf(query['pageSize'], 50),
        });
        return { status: 200, body: page };
      },
    },
    {
      method: 'POST',
      path: '/research/sources/:sourceId/prices',
      permission: WRITE,
      // Structured rows or raw CSV; REPLACES the previous list by default;
      // every unimportable row comes back in `problems` with its line number
      // — surfaced, never dropped silently.
      async handle({ actor, params, body }) {
        const record = recordOf(body);
        const source = await store.manual.requireSource(params['sourceId'] ?? '', actor.clientId);
        const problems: ManualRowProblem[] = [];
        let rows: ManualPriceRowInput[] = Array.isArray(record['rows'])
          ? (record['rows'] as ManualPriceRowInput[])
          : [];
        if (record['csv'] !== undefined) {
          const parsed = parseCsvPriceList(record['csv'] as never);
          rows = [...rows, ...parsed.rows];
          problems.push(...parsed.problems);
        }
        const normalized = normalizeManualRows(rows, {
          defaultValidUntil: defaultValidUntil(record['validUntil']),
        });
        problems.push(...normalized.problems);
        const stored = await store.manual.store({
          clientId: actor.clientId,
          sourceId: source.id,
          defaultSupplierName: String(record['defaultSupplierName'] ?? source.name),
          entries: normalized.entries,
          replace: record['replace'] !== false,
        });
        return ok({
          imported: stored.imported,
          problems,
          batchId: stored.batchId,
          replaced: stored.replaced,
        });
      },
    },
    {
      method: 'POST',
      path: '/research/sources/:sourceId/quotes',
      permission: WRITE,
      // One typed quote from a phone/WhatsApp negotiation: same normalization
      // as the list import, appended without touching the imported list.
      async handle({ actor, params, body }) {
        const source = await store.manual.requireSource(params['sourceId'] ?? '', actor.clientId);
        const normalized = normalizeManualRows([recordOf(body) as never], {
          defaultValidUntil: defaultValidUntil(undefined),
        });
        if (normalized.entries.length === 0) {
          return refuse(400, normalized.problems[0]?.reason ?? messages.invalidQuote);
        }
        const stored = await store.manual.store({
          clientId: actor.clientId,
          sourceId: source.id,
          defaultSupplierName: source.name,
          entries: normalized.entries,
          replace: false,
        });
        return ok({
          imported: stored.imported,
          problems: normalized.problems,
          batchId: stored.batchId,
          replaced: false,
        });
      },
    },
  ];

  return { routes };
}
