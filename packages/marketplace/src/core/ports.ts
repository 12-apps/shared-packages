import type { AdapterRegistry } from "./registry";
import type { AdapterTokenCache, MarketplaceAdapter, MarketplaceHttp } from "./adapter";
import type { CatalogueImage, CatalogueItem } from "./catalogue-port";
import type { NormalizedMarketplaceOrder } from "./types";

/**
 * What the engine needs FROM its host, and nothing more.
 *
 * Everything below is something only the host can answer — where the rows
 * live, what an order IS in the product being sold, which key seals a secret,
 * how a job is queued, what time it is, who to tell. The MECHANISM (the
 * inbox and its dedup, the SKU map, the acceptance clock and its sweep, the
 * outbound bookkeeping) is the engine's and appears nowhere here.
 *
 * ## Never a default
 *
 * Every field is REQUIRED. A default would let a second host silently inherit
 * the first one's answers — an SLA, a batch size, a retry bound — and the
 * whole point of the ports is that those answers are the host's to give.
 */

/**
 * The Prisma delegates the engine reads and writes.
 *
 * Structural rather than a `PrismaClient` import: the engine must not depend
 * on the host's generated client, and this shape is what any client generated
 * from the shipped partial satisfies.
 *
 * Note what is NOT here: the host's order table. The engine cannot reach it,
 * which is why the acceptance clock lives in a table of the engine's own.
 */
export interface MarketplaceDb {
  marketplaceIntegration: {
    findMany(args: unknown): Promise<unknown[]>;
    findUnique(args: unknown): Promise<unknown>;
    upsert(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
  marketplaceMenuLink: {
    findMany(args: unknown): Promise<unknown[]>;
    upsert(args: unknown): Promise<unknown>;
  };
  marketplaceInboxEvent: {
    findUnique(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<unknown[]>;
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
  marketplaceAcceptance: {
    findFirst(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<unknown[]>;
    create(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  /**
   * OPTIONAL in the type, so a host on 1.x that has not yet composed the
   * catalogue model still compiles; the catalogue calls refuse without it
   * (FUT-4768, migration `20261113120000_marketplace_catalogue`).
   */
  marketplaceCataloguePublication?: {
    findFirst(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<unknown[]>;
    upsert(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  /** OPTIONAL, as above: the marketplace's category ids, found or created once per name. */
  marketplaceCatalogueCategory?: {
    findFirst(args: unknown): Promise<unknown>;
    create(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  /**
   * OPTIONAL in the type, so a host on 1.x that has not yet composed the
   * pause model still compiles; `pauseStore` refuses without it (FUT-4851,
   * migration `20261113180000_marketplace_store_pause`).
   */
  marketplaceStorePause?: {
    findFirst(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<unknown[]>;
    upsert(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
}

/**
 * One order line after the engine has matched it against the SKU map.
 * `subjectRef` is the host catalog id, or null when the SKU was never mapped —
 * never an error, and never a reason to refuse the order.
 */
export interface ResolvedOrderLine {
  externalSku: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  note: string | null;
  subjectRef: string | null;
}

/** What the acceptance queue shows about an order, resolved by the host. */
export interface MarketplaceOrderSummary {
  buyerName: string | null;
  totalCents: number;
  unmappedLines: number;
  createdAt: string | null;
}

/**
 * What a person stated beside an accept, for the host's admission to read.
 * Every field is optional and the host decides what it means.
 */
export interface MarketplaceAdmission {
  /** "Accept anyway": the person was told the order is short and confirmed. */
  admitStockPastZero?: boolean;
}

/** One decision as the host's admission sees it, BEFORE the claim commits. */
export interface MarketplaceAdmissionRequest {
  clientId: string;
  orderId: string;
  decision: "ACCEPT" | "REJECT";
  admission: MarketplaceAdmission;
  /**
   * The transaction the claim will commit in — the SAME object the host's
   * `transaction` port handed the engine, so a host that draws stock here
   * draws it atomically with the claim, and a refusal anywhere in the call
   * rolls the draw back.
   */
  db: MarketplaceDb;
}

/** The host's answer: proceed, or refuse with its own coded reason. */
export type MarketplaceAdmissionResult =
  | { admitted: true }
  | {
      admitted: false;
      /** The host's machine code (`MARKETPLACE_STOCK_ASK`). The route answers 409 with it. */
      code: string;
      /** The host's sentence, in the caller's language. */
      message: string;
      /** Anything the client needs to ask the person (the short lines). */
      details?: unknown;
    };

/** Why the engine tells the host to refuse an order. Vocabulary, not copy. */
export type MarketplaceRefusal = "REJECTED" | "EXPIRED" | "CANCELLED";

/**
 * Why the store's own cancellation request FAILED: REFUSED (the marketplace
 * said no, or every attempt failed) or TIMEOUT (no answer inside the
 * marketplace's cancellation window). Vocabulary, not copy.
 */
export type CancellationFailureReason = "REFUSED" | "TIMEOUT";

/**
 * The host's domain, as five questions the engine asks and never answers.
 *
 * `onAccepted`/`onRefused` return nothing on purpose: the acceptance row's
 * transition has already been claimed and committed when they are called, and
 * a host that fails its half must not un-decide the acceptance.
 */
export interface MarketplaceOrderPort {
  /**
   * Judge a decision BEFORE its claim commits, inside the claim's
   * transaction: the stock check (and the draw) of an accept, anything the
   * host must refuse with its own code. A refusal writes nothing anywhere in
   * the call (the transaction rolls back). Called for every decision of a
   * `decide` call, ACCEPT and REJECT alike; never for an ingest (an arriving
   * order is never refused) nor for `recordStoreCancellation`.
   */
  admit(request: MarketplaceAdmissionRequest): Promise<MarketplaceAdmissionResult>;
  /**
   * Turn a normalized order into whatever this host sells; hand back its id.
   * `db` is the ingest's transaction client (the host's `transaction` port):
   * write the order through it, so the order and the engine's acceptance row
   * commit together or not at all.
   */
  create(
    clientId: string,
    order: NormalizedMarketplaceOrder,
    lines: readonly ResolvedOrderLine[],
    db: MarketplaceDb,
  ): Promise<string>;
  /** Does this catalog id exist and belong to this tenant? */
  catalogHas(clientId: string, subjectRef: string): Promise<boolean>;
  /** The store said yes, or the connection auto-accepts. */
  onAccepted(clientId: string, orderId: string): Promise<void>;
  /** The store said no, the marketplace cancelled, or the clock lapsed. */
  onRefused(clientId: string, orderId: string, reason: MarketplaceRefusal): Promise<void>;
  /**
   * OPTIONAL. The marketplace CONFIRMED the store's own cancellation request
   * (the job's answer, or the marketplace's event). A host that requests first
   * and cancels on confirm runs its cancel here. When present it is called
   * INSTEAD of `onRefused(…, "CANCELLED")` for a cancellation the store asked
   * for; a cancellation the marketplace made on its own still reaches
   * `onRefused`. Absent (a 1.0.0 host): `onRefused(…, "CANCELLED")` as before.
   */
  onCancellationConfirmed?(clientId: string, orderId: string): Promise<void>;
  /**
   * OPTIONAL. The store's own cancellation request FAILED: refused (the job's
   * answer, the marketplace's event, or the last attempt) or timed out (the
   * outbound sweep, past the marketplace's window). Called once per request,
   * by the call that moved the row to FAILED. The pedido is still the
   * marketplace's: a person finishes it there, through the adapter's app link.
   */
  onCancellationFailed?(clientId: string, orderId: string, reason: CancellationFailureReason): Promise<void>;
  /** Queue facts for a batch of orders, keyed by id. Missing ids are dropped. */
  summarize(
    clientId: string,
    orderIds: readonly string[],
  ): Promise<Map<string, MarketplaceOrderSummary>>;
}

/**
 * Sealing and opening a stored secret. The KEY is the host's. `open` THROWS on
 * a ciphertext that will not open: a row written under a rotated key must not
 * read as "no credentials", which would turn a key problem into an endpoint
 * that accepts unsigned deliveries.
 */
export interface MarketplaceSecretsPort {
  seal(plaintext: string): string;
  open(sealed: string): string;
}

/**
 * Defer one job run by wire name — the shape of `@12-apps/wiring/ports`'
 * `JobsEnqueuePort`. Never throws. The engine enqueues only its own
 * namespaced job (`marketplace.outbound`).
 */
export interface MarketplaceEnqueuePort {
  enqueue(
    name: string,
    payload: unknown,
    options?: { dedupeKey?: string },
  ): Promise<{ enqueued: boolean; reason?: string }>;
}

/** One archive or unarchive of a connection: who, when, what and why. */
export interface MarketplaceAuditEntry {
  clientId: string;
  /** Whoever the host resolved as the caller; null for a system act. */
  actorId: string | null;
  action: "marketplace.integration.archive" | "marketplace.integration.unarchive";
  provider: string;
  reason: string | null;
  at: Date;
}

/**
 * The host's audit trail. `db` is the transaction client of the write being
 * audited (the host's `transaction` port): write the line through it, so the
 * archive and its audit line commit together, and a failing audit rolls the
 * archive back.
 */
export interface MarketplaceAuditPort {
  record(entry: MarketplaceAuditEntry, db: MarketplaceDb): Promise<void>;
}

/** The clock, so a test or a replay decides what "now" is. */
export interface MarketplaceClockPort {
  now(): Date;
}

/** Where the engine says what it did — the wiring `LoggerPort` shape. */
export interface MarketplaceLogger {
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
}

/**
 * The host's catalogue, as the catalogue publishing reads it (FUT-4768). The
 * engine never reads a host table: the host maps its product into the item
 * shape, at the moment the job sends it, so what goes out is the product as it
 * is now rather than as it was when the switch was turned on.
 */
export interface MarketplaceCataloguePort {
  /** These products as they go out, keyed by product id. Missing ids are products that no longer exist. */
  items(clientId: string, productIds: readonly string[]): Promise<Map<string, CatalogueItem>>;
  /** The bytes behind an item's photo, for a marketplace that takes an upload; null when they cannot be read. */
  image(url: string): Promise<CatalogueImage | null>;
}

/** Everything the host plugs in. */
export interface MarketplacePorts {
  db: () => Promise<MarketplaceDb>;
  /**
   * Run `fn` in ONE database transaction and hand it the transaction's client
   * (Prisma's interactive `$transaction`). A throw rolls everything back. Every
   * bulk write is all-or-nothing through this, and a decision's admission and
   * claim share it.
   */
  transaction: <T>(fn: (db: MarketplaceDb) => Promise<T>) => Promise<T>;
  order: MarketplaceOrderPort;
  secrets: MarketplaceSecretsPort;
  /** The only way the engine reaches a marketplace. Tests answer it with a fake. */
  http: MarketplaceHttp;
  enqueue: MarketplaceEnqueuePort;
  audit: MarketplaceAuditPort;
  clock: MarketplaceClockPort;
  logger: MarketplaceLogger;
  /**
   * Tell the staff surfaces something moved. Fire-and-forget: the engine never
   * awaits it, and a dead bus costs latency, never a transition.
   */
  publishChanged: (clientId: string) => void;
  /**
   * OPTIONAL. How long a store's cancellation request may wait for the
   * marketplace's answer before the outbound sweep fails it as TIMEOUT, in
   * milliseconds, for every adapter. Absent: each adapter's own
   * `capabilities.cancellationAnswerWindowMs`; an adapter that states none is
   * only given up on after `OUTBOUND_GIVE_UP_MS`.
   */
  cancellationWindowMs?: number;
  /**
   * OPTIONAL. The host's catalogue, for publishing products to a marketplace's
   * catalogue. Absent: every catalogue call answers `UNSUPPORTED`.
   */
  catalogue?: MarketplaceCataloguePort;
  /** The acceptance window a connection gets when it does not state its own. */
  defaultAckSlaSeconds: number;
  /** How many stored deliveries one reconciliation pass re-runs. */
  reconcileBatchSize: number;
  /** How many times a stored delivery may be re-run before it is retired. */
  maxInboxAttempts: number;
}

/** Everything a host hands `createMarketplaceEngine`. */
export interface MarketplaceEngineConfig extends MarketplacePorts {
  /** One per marketplace — `createIfoodAdapter(...)` and its siblings. */
  adapters: readonly MarketplaceAdapter[];
}

/** What every engine module is handed: the ports, the registry, the token cache. */
export interface EngineContext {
  ports: MarketplacePorts;
  registry: AdapterRegistry;
  tokens: AdapterTokenCache;
}
