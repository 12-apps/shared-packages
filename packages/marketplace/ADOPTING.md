# Adopting @12-apps/marketplace

The engine is a library with required ports and no defaults: a host answers
every question only it can answer, and the engine supplies the mechanism.
Everything below is what a host binds, in the order it binds it.

## 1. The host ports (`MarketplacePorts`)

Every field is REQUIRED. A missing one is a type error at mount, never a
default that quietly adopts another host's policy.

| port | type | what the host answers |
|---|---|---|
| `db` | `() => Promise<MarketplaceDb>` | The Prisma client generated from a schema that includes `prisma/marketplace.prisma`. Structural: the four delegates `marketplaceIntegration`, `marketplaceMenuLink`, `marketplaceInboxEvent`, `marketplaceAcceptance`. |
| `order.create` | `(clientId, order: NormalizedMarketplaceOrder, lines: readonly ResolvedOrderLine[]) => Promise<string>` | Create the host's own order from a normalized one; return its id. `lines[i].subjectRef` is the mapped catalog id or null (never refuse the order for a null). |
| `order.catalogHas` | `(clientId, subjectRef) => Promise<boolean>` | Does this catalog id exist and belong to this tenant? Asked before a SKU is mapped. |
| `order.onAccepted` | `(clientId, orderId) => Promise<void>` | The store accepted, or the connection auto-accepts. Start whatever accepting means here. Runs after the claim committed; it cannot un-accept. |
| `order.onRefused` | `(clientId, orderId, reason: "REJECTED" \| "EXPIRED" \| "CANCELLED") => Promise<void>` | Refuse/cancel the host order: the store refused on the clock, the clock lapsed, or the marketplace cancelled. NOT called for `recordStoreCancellation` (the host's own cancel already ran). |
| `order.summarize` | `(clientId, orderIds: readonly string[]) => Promise<Map<string, MarketplaceOrderSummary>>` | The queue's host facts in one read: `{ buyerName, totalCents, unmappedLines, createdAt }`. |
| `secrets` | `{ seal(plaintext): string; open(sealed): string }` | Seal and open the credential blob with the host's key. `open` THROWS on a blob that will not open. |
| `http` | `(req: MarketplaceHttpRequest) => Promise<MarketplaceHttpResponse>` | The only way the engine reaches a marketplace. Answer any status; throw only when no answer arrived (timeout, network). The host owns the timeout, proxy and CA. |
| `enqueue` | `{ enqueue(name, payload, { dedupeKey? }) => Promise<{ enqueued: boolean; reason?: string }> }` | The wiring `JobsEnqueuePort`. The engine queues only `marketplace.outbound` with `{ clientId, orderId, action }` and dedupe key `marketplace.outbound:<action>:<orderId>`. Never throws. |
| `clock` | `{ now(): Date }` | What time it is. |
| `logger` | `{ info, warn, error }` | The wiring `LoggerPort`; bind `assembled.loggers["@12-apps/marketplace"]`. |
| `publishChanged` | `(clientId) => void` | Tell the staff surfaces something moved. Fire-and-forget. |
| `defaultAckSlaSeconds` | `number` | The acceptance window a new connection gets (the origin host: 300). |
| `reconcileBatchSize` | `number` | Stored deliveries one reconciliation pass re-runs (origin: 50). |
| `maxInboxAttempts` | `number` | Re-runs before a stored delivery is retired (origin: 5). |

Plus `adapters: readonly MarketplaceAdapter[]` — one per marketplace the host
sells through. The list is validated at mount (ids, duplicates, reason lists).

```ts
import { createMarketplaceEngine } from "@12-apps/marketplace";
import { createIfoodAdapter } from "@12-apps/marketplace/ifood";
import { IFOOD_ADAPTER_COPY_PT_BR } from "@12-apps/marketplace/ifood/pt-BR";

export const engine = createMarketplaceEngine({
  db: async () => getPrismaClient(),
  order: { create, catalogHas, onAccepted, onRefused, summarize },
  secrets: { seal: encryptSecret, open: decryptSecret },
  http: marketplaceHttp,
  enqueue: jobs,
  clock: { now: () => new Date() },
  logger: assembled.loggers["@12-apps/marketplace"],
  publishChanged,
  defaultAckSlaSeconds: 300,
  reconcileBatchSize: 50,
  maxInboxAttempts: 5,
  adapters: [createIfoodAdapter({ copy: IFOOD_ADAPTER_COPY_PT_BR })],
});
```

## 2. What the host calls on the engine

| call | when |
|---|---|
| `decide({ clientId, orderId, decision, reasonCode? })` | Every accept or refusal of an order on the clock, from every surface (the board, the admin route, the MCP tool). One decide path. Answers `decided`, `stale` (409) or `invalidReason` (422, nothing written). |
| `recordStoreCancellation({ clientId, orderId, reasonCode? })` | After the host's own cancel of a marketplace order (before or after accepting it). Stamps the request and queues it; `stale` when the marketplace already cancelled it or a request was already made. |
| `suggestReason(provider, { itemUnavailable })` | To preselect a reason in the refusal dialog. The host judges the shortage. |
| `orderStates(clientId, orderIds)` | The order reads: `{ status, confirmedAt, confirmFailedAt, cancellation, cancellationReasonCode, appUrl }` per marketplace order, one query. |
| `adapter(provider)`, `reasons(provider)`, `appLink(provider, ref)` | The marketplace's capabilities, reasons and link, without naming it. |
| `ingest(...)`, `deliver(...)` | A producer that hands over an order directly; the webhook does `deliver` for you. |

A host never writes `provider === "IFOOD"`. A capability is asked of
`engine.adapter(provider).capabilities`.

## 3. The wiring capabilities

Adopt through `@12-apps/wiring/consumer`:

```ts
host.adoptServer({
  manifest: marketplaceManifest,          // @12-apps/marketplace/manifest
  server: marketplaceServerManifest,      // @12-apps/marketplace/manifest/server
  bindings: {
    http: { mountPath: "/api", config: { engine, copy: MARKETPLACE_SERVER_COPY_PT_BR, tenantBySlug, logger } },
    jobs: { deps: { engine } },
  },
});
```

| capability | what it is |
|---|---|
| `http` | `POST /webhooks/marketplace/:tenantSlug/:provider` (`kind: "webhook"`, needs the raw `request`), and seven authenticated routes under `/admin/:tenantSlug/marketplace` (`GET/PUT/DELETE` the connection, `GET/PUT /menu-links`, `GET /acceptances`, `POST /acceptances/:orderId`). Mounted at `/api` they reproduce the origin host's URLs. `@12-apps/marketplace/hono`'s `marketplaceRouter({ ...config, resolveActor })` mounts them in one line. |
| `jobs` | `marketplace.expire-acceptances` (every minute, lease 5 min), `marketplace.reconcile-inbox` (every 5 min, lease 5 min), `marketplace.outbound` (3 attempts, exponential backoff 30 s). Bind `{ engine }`. |
| `mcp` | The seven tools; `decideMarketplaceOrder` takes `reasonCode` on the same tool, all-or-nothing. `listMarketplaceIntegrations` carries each marketplace's capabilities and reasons. |
| `permissions` | `marketplace:manage` (connect, map) and `marketplace:decide` (read and answer the queue). The host decides which roles hold them; each route declares its own. |
| `db` | `prisma/marketplace.prisma` + `prisma/migrations` (composed). |
| `observability` | namespace `marketplace`. |

The route copy (`MarketplaceServerCopy`) and the iFood adapter's copy
(`IfoodAdapterCopy`) are required config; pt-BR and en-US packs ship beside
each.

## 4. The database

The partial names no host table: `client_id`, `order_id` and `menu_item_id`
are by-value scalars. A host that wants referential integrity adds, in its own
migration:

- `marketplace_*.client_id → <tenants>(id) ON DELETE CASCADE`
- `marketplace_acceptances.order_id → <orders>(id) ON DELETE CASCADE`
- `marketplace_menu_links.menu_item_id → <catalog>(id) ON DELETE SET NULL`

The migration `20261111200000_marketplace_engine` is replay-safe. On a host
that already has the predecessor's tables it adds the outbound columns and
`delivered_by`, keeps the host's foreign keys, and replaces the closed
provider lists (`*_provider_valid`) with a shape check, so a new adapter is
never a migration.

## 5. What stays the host's

The stock draw at the acceptance, the settlement effects, the board's and the
order screen's UI, the cancel route itself, the HTTP client's timeout and CA,
the jobs runtime and its leases, which roles hold the two permissions, and
every sentence a person reads.
