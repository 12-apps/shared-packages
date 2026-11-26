import { createMarketplaceEngine } from "../core/engine";
import type { MarketplaceAdapter, MarketplaceHttpRequest, MarketplaceHttpResponse, StatusStep } from "../core/adapter";
import type { OutboundJobPayload } from "../core/outbound-queue";
import type {
  MarketplaceDb,
  MarketplaceAdmissionRequest,
  MarketplaceAdmissionResult,
  MarketplaceAuditEntry,
  MarketplaceCataloguePort,
  MarketplaceRefusal,
  CancellationFailureReason,
  MarketplaceLifecycleAnswer,
  MarketplaceLifecycleFacts,
  ResolvedOrderLine,
} from "../core/ports";
import type { MarketplaceAppCredentialsPort } from "../core/linking-port";
import type { NormalizedEvent, NormalizedMarketplaceOrder } from "../core/types";
import { createIfoodAdapter } from "../ifood";
import { IFOOD_ADAPTER_COPY_EN_US } from "../ifood/en-US";
import { createMemoryDb } from "./memory-db";

/* eslint-disable test-flakiness/no-database-operations --
   The seed helpers below write rows into the harness's OWN in-memory fake
   (`createMemoryDb`), built per `createHarness` call: they are how a case puts
   the engine in a state, not a database a case shares. */

/**
 * A mounted engine over recording ports. Nothing reaches a network: `http` is
 * a scripted fake that records every request, and a test that expects no call
 * asserts `http.requests` is empty.
 */

const NOW = new Date("2026-11-11T12:00:00.000Z");
export const TENANT = "tenant-1";

/** Reversible "sealing", so a test can read what was stored (`open` it back). */
const seal = (plaintext: string): string => `sealed:${Buffer.from(plaintext).toString("base64")}`;
const open = (sealed: string): string => {
  if (!sealed.startsWith("sealed:")) throw new Error("does not open");
  return Buffer.from(sealed.slice("sealed:".length), "base64").toString();
};

/** Answer each request with the next scripted response (the last one repeats). */
export function scriptedHttp(
  responses: MarketplaceHttpResponse[] | ((req: MarketplaceHttpRequest) => MarketplaceHttpResponse | Promise<MarketplaceHttpResponse>),
) {
  const requests: MarketplaceHttpRequest[] = [];
  const http = async (request: MarketplaceHttpRequest): Promise<MarketplaceHttpResponse> => {
    requests.push(request);
    if (typeof responses === "function") return responses(request);
    const response = responses[Math.min(requests.length - 1, responses.length - 1)];
    if (!response) throw new Error("no scripted response");
    return response;
  };
  return { http, requests };
}

interface HarnessOptions {
  adapters?: readonly MarketplaceAdapter[];
  http?: ReturnType<typeof scriptedHttp>;
  /** The host refuses to create orders (its database is down). */
  failCreate?: boolean;
  /** The host's admission: admits everything unless given. */
  admit?: (request: MarketplaceAdmissionRequest) => Promise<MarketplaceAdmissionResult>;
  /** The host's half of an accept / refusal throws. */
  failHostHalf?: boolean;
  /** The queue refuses every job. */
  queueDown?: boolean;
  /** The queue keeps every job id it took, as a queue that keeps finished jobs does: a reused dedupe key is refused. */
  dedupeQueue?: boolean;
  /** The host's audit write throws. */
  failAudit?: boolean;
  /** The host's own write inside `create`, through the ingest's transaction client. */
  onCreate?: (db: MarketplaceDb, order: NormalizedMarketplaceOrder) => Promise<void>;
  /** The host requests first and cancels on confirm: it has the two optional cancellation callbacks (FUT-4758). */
  cancellationHooks?: boolean;
  /** The engine's override of every adapter's cancellation answer window. */
  cancellationWindowMs?: number;
  /** The host's say on an automatic acceptance; absent, the port is not bound. */
  mayAutoAccept?: (clientId: string) => Promise<boolean>;
  /** `false`: the host cannot answer for variations (no `catalogHasVariation`, FUT-4927). */
  variations?: boolean;
  /** The host's catalogue port, for the catalogue suites (FUT-4768). */
  catalogue?: MarketplaceCataloguePort;
  /**
   * The host's answers to lifecycle events (FUT-4653), one per call in order (the last repeats);
   * an Error is thrown by the hook. Absent, `onLifecycle` is not bound.
   */
  lifecycle?: readonly (MarketplaceLifecycleAnswer | Error)[];
  /** Whether the host says an order still holds a step; absent, `statusHolds` is not bound. */
  statusHolds?: (step: StatusStep) => boolean | Promise<boolean>;
  appCredentials?: MarketplaceAppCredentialsPort; // The software's own app (FUT-5613); absent, no linking.
  /** A database other than the in-memory one (the PGlite suite's). */
  store?: { db: MarketplaceDb; transaction: <T>(fn: (tx: MarketplaceDb) => Promise<T>) => Promise<T> };
}

export function createHarness(options: HarnessOptions = {}) {
  const memory = createMemoryDb();
  const http = options.http ?? scriptedHttp([{ status: 500, body: "unscripted" }]);
  const clock = { at: NOW };
  const created: { clientId: string; order: NormalizedMarketplaceOrder; orderId: string; lines: readonly ResolvedOrderLine[] }[] = [];
  const accepted: string[] = [];
  const refused: { orderId: string; reason: MarketplaceRefusal }[] = [];
  const enqueued: { name: string; payload: OutboundJobPayload; dedupeKey?: string; delayMs?: number }[] = [];
  /** What the fake queue actually took (with `dedupeQueue`, a reused key is not here). */
  const queued: { name: string; payload: unknown; dedupeKey?: string }[] = [];
  const queueKeys = new Set<string>();
  const published: string[] = [];
  const logged: { level: string; message: string }[] = [];
  const catalog = new Set<string>(["menu-1", "menu-2"]);
  const audited: MarketplaceAuditEntry[] = [];
  const auditDbs: MarketplaceDb[] = [];
  const admitted: MarketplaceAdmissionRequest[] = [];
  const cancellationConfirmed: string[] = [];
  const autoAcceptAsked: string[] = [];
  const cancellationFailed: { orderId: string; reason: CancellationFailureReason }[] = [];
  const lifecycleCalls: { orderId: string; event: NormalizedEvent; facts: MarketplaceLifecycleFacts }[] = [];
  const holdsAsked: { orderId: string; step: StatusStep }[] = [];
  const cancellationHooks = options.cancellationHooks
    ? {
        onCancellationConfirmed: async (_clientId: string, orderId: string) => {
          cancellationConfirmed.push(orderId);
        },
        onCancellationFailed: async (_clientId: string, orderId: string, reason: CancellationFailureReason) => {
          cancellationFailed.push({ orderId, reason });
        },
      }
    : {};

  const engine = createMarketplaceEngine({
    db: async () => (options.store ?? memory).db,
    transaction: (options.store ?? memory).transaction,
    order: {
      admit: async (request) => {
        admitted.push(request);
        return options.admit ? options.admit(request) : { admitted: true };
      },
      create: async (clientId, order, lines, db) => {
        if (options.failCreate) throw new Error("host is down");
        if (options.onCreate) await options.onCreate(db, order);
        const orderId = `order-${created.length + 1}`;
        created.push({ clientId, order, orderId, lines });
        return orderId;
      },
      catalogHas: async (_clientId, ref) => catalog.has(ref),
      // A variation is in the catalog as `<item>#<variation>`.
      ...(options.variations === false ? {} : { catalogHasVariation: async (_c: string, ref: string, v: string) => catalog.has(`${ref}#${v}`) }),
      onAccepted: async (_clientId, orderId) => {
        accepted.push(orderId);
        if (options.failHostHalf) throw new Error("host half failed");
      },
      onRefused: async (_clientId, orderId, reason) => {
        refused.push({ orderId, reason });
        if (options.failHostHalf) throw new Error("host half failed");
      },
      summarize: async (_clientId, ids) =>
        new Map(ids.map((id) => [id, { buyerName: "Buyer", totalCents: 1000, unmappedLines: 0, createdAt: null }])),
      ...cancellationHooks,
      ...(options.lifecycle
        ? {
            onLifecycle: async (_clientId: string, orderId: string, event: NormalizedEvent, facts: MarketplaceLifecycleFacts) => {
              lifecycleCalls.push({ orderId, event, facts });
              const answer = options.lifecycle![Math.min(lifecycleCalls.length - 1, options.lifecycle!.length - 1)]!;
              if (answer instanceof Error) throw answer;
              return answer;
            },
          }
        : {}),
      ...(options.statusHolds
        ? {
            statusHolds: async (_clientId: string, orderId: string, step: StatusStep) => {
              holdsAsked.push({ orderId, step });
              return options.statusHolds!(step);
            },
          }
        : {}),
      ...(options.mayAutoAccept
        ? {
            mayAutoAccept: (clientId: string) => {
              autoAcceptAsked.push(clientId);
              return options.mayAutoAccept!(clientId);
            },
          }
        : {}),
    },
    secrets: { seal, open },
    http: http.http,
    enqueue: {
      enqueue: async (name, payload, opts) => {
        enqueued.push({ name, payload: payload as OutboundJobPayload, dedupeKey: opts?.dedupeKey, delayMs: opts?.delayMs });
        if (options.queueDown) return { enqueued: false, reason: "queue down" };
        const key = opts?.dedupeKey;
        if (options.dedupeQueue && key !== undefined) {
          if (queueKeys.has(key)) return { enqueued: false, reason: "duplicate job id" };
          queueKeys.add(key);
        }
        queued.push({ name, payload, dedupeKey: key });
        return { enqueued: true };
      },
    },
    audit: {
      record: async (entry, db) => {
        if (options.failAudit) throw new Error("audit store is down");
        audited.push(entry);
        auditDbs.push(db);
      },
    },
    clock: { now: () => clock.at },
    logger: {
      info: (message) => logged.push({ level: "info", message }),
      warn: (message) => logged.push({ level: "warn", message }),
      error: (message) => logged.push({ level: "error", message }),
    },
    publishChanged: (clientId) => published.push(clientId),
    defaultAckSlaSeconds: 300,
    reconcileBatchSize: 50,
    maxInboxAttempts: 5,
    ...(options.cancellationWindowMs === undefined ? {} : { cancellationWindowMs: options.cancellationWindowMs }),
    ...(options.catalogue ? { catalogue: options.catalogue } : {}),
    ...(options.appCredentials ? { appCredentials: options.appCredentials } : {}),
    adapters: options.adapters ?? [createIfoodAdapter({ copy: IFOOD_ADAPTER_COPY_EN_US })],
  });

  /** Connect a provider for the tenant, with credentials, enabled. */
  async function connect(
    provider = "IFOOD",
    settings: { autoAccept?: boolean; webhookSecret?: string | null; followStatus?: boolean } = {},
  ) {
    await engine.saveIntegration({
      clientId: TENANT,
      provider,
      enabled: true,
      externalMerchantId: `merchant-${provider}`,
      autoAccept: settings.autoAccept ?? false,
      ...(settings.followStatus === undefined ? {} : { followStatus: settings.followStatus }),
      credentials: { clientId: "app-id", clientSecret: "app-secret", webhookSecret: settings.webhookSecret ?? null },
    });
  }

  /** The acceptance row of an order, read straight from the table. */
  function acceptance(orderId: string): Record<string, unknown> | undefined {
    return memory.tables.marketplaceAcceptance.rows.find((row) => row.orderId === orderId);
  }

  /** Set columns on an acceptance row, as a state the engine reads next. */
  function patchAcceptance(orderId: string, data: Record<string, unknown>): void {
    const row = acceptance(orderId);
    if (!row) throw new Error(`no acceptance for ${orderId}`);
    Object.assign(row, data);
  }

  /** Make this a host that has not composed the status model. */
  function dropStatusTable(): void {
    delete (memory.db as { marketplaceStatusUpdate?: unknown }).marketplaceStatusUpdate;
  }

  /** Move the engine's clock. */
  function setNow(at: Date): void {
    clock.at = at;
  }

  /** Write an inbox row straight to the table: a delivery recorded whose process died before processing it. */
  async function seedInbox(data: Record<string, unknown>): Promise<void> {
    await memory.db.marketplaceInboxEvent.create({ data });
  }

  /** Write an acceptance row straight to the table (an order of a marketplace the test did not ingest). */
  async function seedAcceptance(data: Record<string, unknown>): Promise<void> {
    await memory.db.marketplaceAcceptance.create({ data: { createdAt: clock.at, ...data } });
  }

  /** Write a status row straight to the table: a step we informed, or one the marketplace announced. */
  async function seedStatus(data: {
    orderId: string;
    step: string;
    source: "STORE" | "MARKETPLACE";
    state: string;
    provider?: string;
    ageMs?: number;
    claimKey?: string;
  }): Promise<void> {
    const { ageMs, provider, claimKey, ...row } = data;
    await memory.db.marketplaceStatusUpdate!.create({
      data: { clientId: TENANT, provider: provider ?? "IFOOD", claimKey: claimKey ?? "seed", ...row },
    });
    if (ageMs !== undefined) {
      const stored = memory.tables.marketplaceStatusUpdate.rows.find((r) => r.orderId === row.orderId && r.step === row.step);
      if (stored) stored.updatedAt = new Date(clock.at.getTime() - ageMs);
    }
  }

  /**
   * Make the status table lose a claim race: its first read answers "no row" while another
   * run inserts one (`rival`); or make its first stamp throw (`failFirstStamp`).
   */
  function interceptStatusTable(behaviour: {
    rival?: { orderId: string; step: string; source: "STORE" | "MARKETPLACE"; state: string };
    failFirstStamp?: string;
    failFirstRead?: string;
  }): void {
    const table = memory.tables.marketplaceStatusUpdate;
    const read = table.findMany.bind(table);
    const stamp = table.updateMany.bind(table);
    const pending = { rival: behaviour.rival, stamp: behaviour.failFirstStamp, read: behaviour.failFirstRead };
    table.findMany = async (args: unknown) => {
      const failure = pending.read;
      if (failure !== undefined) {
        pending.read = undefined;
        throw new Error(failure);
      }
      const rival = pending.rival;
      if (!rival) return read(args);
      pending.rival = undefined;
      await seedStatus(rival);
      return [];
    };
    table.updateMany = async (args: unknown) => {
      const failure = pending.stamp;
      if (failure === undefined) return stamp(args);
      pending.stamp = undefined;
      throw new Error(failure);
    };
  }

  /** Set columns on every integration row of the tenant. */
  function patchIntegration(data: Record<string, unknown>): void {
    for (const row of memory.tables.marketplaceIntegration.rows) Object.assign(row, data);
  }

  return {
    engine,
    memory,
    patchAcceptance,
    patchIntegration,
    setNow,
    dropStatusTable,
    seedInbox,
    seedAcceptance,
    seedStatus,
    interceptStatusTable,
    http,
    clock,
    created,
    accepted,
    refused,
    enqueued,
    autoAcceptAsked,
    queued,
    published,
    logged,
    catalog,
    audited,
    auditDbs,
    admitted,
    cancellationConfirmed,
    cancellationFailed,
    lifecycleCalls,
    holdsAsked,
    connect,
    acceptance,
  };
}

export type Harness = ReturnType<typeof createHarness>;

/** An iFood PLACED payload for one order. */
export function ifoodPlaced(orderId: string, eventId = `evt-${orderId}`) {
  return {
    id: eventId,
    code: "PLC",
    merchantId: "merchant-IFOOD",
    orderId,
    order: {
      displayId: "4821",
      createdAt: "2026-11-11T11:59:00.000Z",
      customer: { id: "cust-9", name: "Ana", phone: { number: "11999999999" } },
      items: [{ externalCode: "SKU-1", name: "Burger", quantity: 2, unitPrice: 19.9 }],
      total: { orderAmount: 39.8 },
    },
  };
}

/** An iFood event with no order body: CANCELLED (`CAN`) or the refusal (`CARF`). */
export function ifoodEvent(orderId: string, code: string, eventId = `evt-${orderId}-${code}`) {
  return { id: eventId, code, merchantId: "merchant-IFOOD", orderId };
}

/** Normalize and deliver one iFood payload for the tenant, as the webhook would. */
export async function deliverIfood(h: Harness, payload: unknown) {
  const event = h.engine.normalize("IFOOD", payload);
  if (!event) throw new Error("payload did not normalize");
  const target = await h.engine.target(TENANT, "IFOOD");
  return h.engine.deliver({
    clientId: TENANT,
    event,
    payload,
    settings: target?.enabled
      ? { autoAccept: target.autoAccept, ackSlaSeconds: target.ackSlaSeconds, followStatus: target.followStatus }
      : null,
  });
}
