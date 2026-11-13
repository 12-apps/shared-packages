import { createMarketplaceEngine } from "../core/engine";
import type {
  MarketplaceAdapter,
  MarketplaceHttpRequest,
  MarketplaceHttpResponse,
} from "../core/adapter";
import type { OutboundJobPayload } from "../core/outbound-queue";
import type {
  MarketplaceDb,
  MarketplaceAdmissionRequest,
  MarketplaceAdmissionResult,
  MarketplaceAuditEntry,
  MarketplaceRefusal,
  CancellationFailureReason,
} from "../core/ports";
import type { NormalizedMarketplaceOrder } from "../core/types";
import { createIfoodAdapter } from "../ifood";
import { IFOOD_ADAPTER_COPY_EN_US } from "../ifood/en-US";
import { createMemoryDb } from "./memory-db";

/**
 * A mounted engine over recording ports. Nothing reaches a network: `http` is
 * a scripted fake that records every request, and a test that expects no call
 * asserts `http.requests` is empty.
 */

const NOW = new Date("2026-11-11T12:00:00.000Z");
export const TENANT = "tenant-1";

/** Reversible "sealing", so a test can read what was stored. */
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
  /** A database other than the in-memory one (the PGlite suite's). */
  store?: { db: MarketplaceDb; transaction: <T>(fn: (tx: MarketplaceDb) => Promise<T>) => Promise<T> };
}

export function createHarness(options: HarnessOptions = {}) {
  const memory = createMemoryDb();
  const http = options.http ?? scriptedHttp([{ status: 500, body: "unscripted" }]);
  const clock = { at: NOW };
  const created: { clientId: string; order: NormalizedMarketplaceOrder; orderId: string }[] = [];
  const accepted: string[] = [];
  const refused: { orderId: string; reason: MarketplaceRefusal }[] = [];
  const enqueued: { name: string; payload: OutboundJobPayload; dedupeKey?: string }[] = [];
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
  const cancellationFailed: { orderId: string; reason: CancellationFailureReason }[] = [];
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
      create: async (clientId, order, _lines, db) => {
        if (options.failCreate) throw new Error("host is down");
        if (options.onCreate) await options.onCreate(db, order);
        const orderId = `order-${created.length + 1}`;
        created.push({ clientId, order, orderId });
        return orderId;
      },
      catalogHas: async (_clientId, ref) => catalog.has(ref),
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
    },
    secrets: { seal, open },
    http: http.http,
    enqueue: {
      enqueue: async (name, payload, opts) => {
        enqueued.push({ name, payload: payload as OutboundJobPayload, dedupeKey: opts?.dedupeKey });
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
    adapters: options.adapters ?? [createIfoodAdapter({ copy: IFOOD_ADAPTER_COPY_EN_US })],
  });

  /** Connect a provider for the tenant, with credentials, enabled. */
  async function connect(provider = "IFOOD", settings: { autoAccept?: boolean; webhookSecret?: string | null } = {}) {
    await engine.saveIntegration({
      clientId: TENANT,
      provider,
      enabled: true,
      externalMerchantId: `merchant-${provider}`,
      autoAccept: settings.autoAccept ?? false,
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

  /** Set columns on every integration row of the tenant. */
  function patchIntegration(data: Record<string, unknown>): void {
    for (const row of memory.tables.marketplaceIntegration.rows) Object.assign(row, data);
  }

  return {
    engine,
    memory,
    patchAcceptance,
    patchIntegration,
    http,
    clock,
    created,
    accepted,
    refused,
    enqueued,
    queued,
    published,
    logged,
    catalog,
    audited,
    auditDbs,
    admitted,
    cancellationConfirmed,
    cancellationFailed,
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
    settings: target?.enabled ? { autoAccept: target.autoAccept, ackSlaSeconds: target.ackSlaSeconds } : null,
  });
}
