import type { AdapterRegistry } from "./registry";
import type { AdapterTokenCache, MarketplaceAdapter, MarketplaceHttp } from "./adapter";
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

/** Why the engine tells the host to refuse an order. Vocabulary, not copy. */
export type MarketplaceRefusal = "REJECTED" | "EXPIRED" | "CANCELLED";

/**
 * The host's domain, as five questions the engine asks and never answers.
 *
 * `onAccepted`/`onRefused` return nothing on purpose: the acceptance row's
 * transition has already been claimed and committed when they are called, and
 * a host that fails its half must not un-decide the acceptance.
 */
export interface MarketplaceOrderPort {
  /** Turn a normalized order into whatever this host sells; hand back its id. */
  create(
    clientId: string,
    order: NormalizedMarketplaceOrder,
    lines: readonly ResolvedOrderLine[],
  ): Promise<string>;
  /** Does this catalog id exist and belong to this tenant? */
  catalogHas(clientId: string, subjectRef: string): Promise<boolean>;
  /** The store said yes, or the connection auto-accepts. */
  onAccepted(clientId: string, orderId: string): Promise<void>;
  /** The store said no, the marketplace cancelled, or the clock lapsed. */
  onRefused(clientId: string, orderId: string, reason: MarketplaceRefusal): Promise<void>;
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

/** Everything the host plugs in. */
export interface MarketplacePorts {
  db: () => Promise<MarketplaceDb>;
  order: MarketplaceOrderPort;
  secrets: MarketplaceSecretsPort;
  /** The only way the engine reaches a marketplace. Tests answer it with a fake. */
  http: MarketplaceHttp;
  enqueue: MarketplaceEnqueuePort;
  clock: MarketplaceClockPort;
  logger: MarketplaceLogger;
  /**
   * Tell the staff surfaces something moved. Fire-and-forget: the engine never
   * awaits it, and a dead bus costs latency, never a transition.
   */
  publishChanged: (clientId: string) => void;
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
