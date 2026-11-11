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
| `transaction` | `<T>(fn: (db: MarketplaceDb) => Promise<T>) => Promise<T>` | Prisma's interactive `$transaction`: run `fn` with the transaction's client; a throw rolls back. Every bulk write and every decision (admission + claim) is one transaction. |
| `order.admit` | `(request: { clientId; orderId; decision: "ACCEPT" \| "REJECT"; admission: MarketplaceAdmission; db: MarketplaceDb }) => Promise<{ admitted: true } \| { admitted: false; code: string; message: string; details?: unknown }>` | Judge each decision BEFORE its claim commits, inside the claim's transaction (`request.db` is the transaction's client: draw the stock there, and a refusal anywhere in the call rolls the draw back). `admission` is `{ admitStockPastZero?: boolean }` as the person stated it. Refuse with your own code: the route answers 409 with it (`MARKETPLACE_STOCK_ASK` and the short lines in `details`). Never called for an ingest or `recordStoreCancellation`. |
| `order.create` | `(clientId, order: NormalizedMarketplaceOrder, lines: readonly ResolvedOrderLine[]) => Promise<string>` | Create the host's own order from a normalized one; return its id. `lines[i].subjectRef` is the mapped catalog id or null (never refuse the order for a null). |
| `order.catalogHas` | `(clientId, subjectRef) => Promise<boolean>` | Does this catalog id exist and belong to this tenant? Asked before a SKU is mapped. |
| `order.onAccepted` | `(clientId, orderId) => Promise<void>` | The store accepted, or the connection auto-accepts. Start whatever accepting means here (the ticket, the board). Runs after the commit and AFTER the confirm is queued; a throw is logged and cannot un-accept or lose the confirm. Atomic work (the stock draw) belongs in `admit`. |
| `order.onRefused` | `(clientId, orderId, reason: "REJECTED" \| "EXPIRED" \| "CANCELLED") => Promise<void>` | Refuse/cancel the host order: the store refused on the clock, the clock lapsed, or the marketplace cancelled. After the commit and after the cancellation request is queued; a throw on a decision is logged. NOT called for `recordStoreCancellation` (the host's own cancel already ran). |
| `order.summarize` | `(clientId, orderIds: readonly string[]) => Promise<Map<string, MarketplaceOrderSummary>>` | The queue's host facts in one read: `{ buyerName, totalCents, unmappedLines, createdAt }`. |
| `secrets` | `{ seal(plaintext): string; open(sealed): string }` | Seal and open the credential blob with the host's key. `open` THROWS on a blob that will not open. |
| `http` | `(req: MarketplaceHttpRequest) => Promise<MarketplaceHttpResponse>` | The only way the engine reaches a marketplace. Answer any status; throw only when no answer arrived (timeout, network). The host owns the timeout, proxy and CA. |
| `audit` | `{ record(entry: { clientId; actorId: string \| null; action: "marketplace.integration.archive" \| "marketplace.integration.unarchive"; provider; reason: string \| null; at: Date }): Promise<void> }` | Every archive and unarchive of a connection, written after the commit. `actorId` is `MarketplaceActor.userId`. |
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
  transaction: async (fn) => (await getPrismaClient()).$transaction((tx) => fn(tx)),
  order: { admit, create, catalogHas, onAccepted, onRefused, summarize },
  audit: { record: writeAuditLine },
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
| `decideMany({ clientId, decisions, validateOnly? })` / `decide({ clientId, ...decision })` | Every accept or refusal of an order on the clock, from every surface (the board, the admin route, the MCP tool). One decide path, all-or-nothing. A decision is `{ orderId, decision: "ACCEPT", admission?, preparationMinutes? }` or `{ orderId, decision: "REJECT", reasonCode?, offendingSkus? }`. `decide` answers `decided`, `stale` with `reason` (`ALREADY_DECIDED` with the `status` — answer an ACCEPTED one as done, I4 — `EXPIRED`, `NOT_FOUND`, `CONFLICT`), `invalidReason` (`INVALID_REASON`, `ITEMS_REQUIRED`, `UNKNOWN_ITEM`), or `refusedByHost` (your `admit`'s code). |
| `recordStoreCancellation({ clientId, orderId, reasonCode?, offendingSkus? })` | After the host's own cancel of a marketplace order (before or after accepting it). Stamps the request and queues it; `stale` when the marketplace already cancelled it or a request was already made. |
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
| `http` | `POST /webhooks/marketplace/:tenantSlug/:provider` (`kind: "webhook"`, needs the raw `request`), and per entity one read and one bulk write under `/admin/:tenantSlug/marketplace`: `GET`/`PUT` (connections), `GET`/`PUT /menu-links`, `GET`/`POST /acceptances` (decisions). `@12-apps/marketplace/hono`'s `marketplaceRouter({ ...config, resolveActor })` mounts them in one line. |
| `jobs` | `marketplace.expire-acceptances` (every minute, lease 5 min), `marketplace.reconcile-inbox` (every 5 min, lease 5 min), `marketplace.outbound` (3 attempts, exponential backoff 30 s), `marketplace.outbound-sweep` (every 5 min, lease 5 min: re-queues every call still owed after 10 min, gives a PENDING request up as FAILED after 24 h). Bind `{ engine }`. |
| `mcp` | Six tools, the bulk-upsert protocol: `listMarketplaceIntegrations` / `upsertMarketplaceIntegrations` (operations `upsert`, `archive`, `unarchive`), `listMarketplaceMenuLinks` / `upsertMarketplaceMenuLinks`, `listMarketplaceAcceptances` / `decideMarketplaceOrders`. Every write takes a list, is all-or-nothing in one transaction, supports `validateOnly`, answers every problem with its path; reads take `ids`. Descriptions are English. |
| `permissions` | `marketplace:manage` (connect, map) and `marketplace:decide` (read and answer the queue). The host decides which roles hold them; each route declares its own. |
| `db` | `prisma/marketplace.prisma` + `prisma/migrations` (composed). |
| `observability` | namespace `marketplace`. |

The route copy (`MarketplaceServerCopy`) and the iFood adapter's copy
(`IfoodAdapterCopy`) are required config; pt-BR and en-US packs ship beside
each.

## 4. What the origin host changes when it adopts this package

1. **Bind the new ports:** `transaction` (`prisma.$transaction`), `order.admit` (move the
   stock ask and the draw of an accept here, from the Quadro's own path, so the board, the
   admin route and the MCP share it), `audit`, `http` (`marketplaceHttp`), `enqueue`,
   `clock`, `logger`. Move any atomic work out of `onAccepted`.
2. **`normalizeIfoodEvent(payload, options)`** now takes `{ missingStreetNumber }` (the pack's
   `IFOOD_ADAPTER_COPY_PT_BR.missingStreetNumber` is "s/n"); the host's tests that call it with
   one argument change. Better: call `engine.normalize("IFOOD", payload)`.
3. **The webhook's refusals are JSON:** `401 {error:"unauthorized"}`, `404
   {error:"unknown_provider"}`, `400 {error:"invalid_json"}`; an unreadable payload answers
   `{received:true, ignored:"unrecognized_payload"}` (was "unrecognized payload").
4. **`GET …/menu-links?unmapped=`** is true only for `"true"` (the host's `z.coerce.boolean`
   read `"false"` as true).
5. **The tools and routes are bulk:** `saveMarketplaceIntegration`, `deleteMarketplaceIntegration`,
   `setMarketplaceMenuLink` and `decideMarketplaceOrder` (and `POST …/acceptances/:orderId`)
   become `upsertMarketplaceIntegrations` (delete is now `operation: "archive"`),
   `upsertMarketplaceMenuLinks` and `decideMarketplaceOrders` (`POST …/acceptances` with a
   `decisions` list). Update the admin SPA's calls, the MCP tool groups and the policy table.
6. **The guards move to permissions:** connections and SKU links take `marketplace:manage`
   (was `requireTenantAdminBySlug` / `products:*`), the queue and the decision
   `marketplace:decide` (was `orders:read:all` / `requireTenantAdminBySlug`). Grant BOTH to the
   roles that hold store administration today (OWNER, ADMIN) to keep today's access, and
   `marketplace:decide` to whoever reads the queue today.
7. **`decide` returns a union** (`decided`, `stale` with a reason, `invalidReason`,
   `refusedByHost`), not `AcceptanceOutcome | null`; `recordStoreCancellation` replaces calling
   `onRefused` after the PATCH cancel.
8. **The provider is a string** checked by `engine.knows(provider)`;
   `MARKETPLACE_PROVIDERS`/`isMarketplaceProvider` are gone.
9. **Drop the origin host's unmerged `20261111190000_marketplace_outbound`** migration: this
   package's `20261111200000_marketplace_engine` adds the same columns (and more), and
   deployed in the other order the plain `ADD COLUMN` of 190000 would fail.
10. **Stop syncing the predecessor's own migration copies over this package's**: keep the
    host's applied `20260814140000`/`20261105120000` files as they are.

## 5. The database

The partial names no host table: `client_id`, `order_id` and `menu_item_id`
are by-value scalars. A host that wants referential integrity adds, in its own
migration:

- `marketplace_*.client_id → <tenants>(id) ON DELETE CASCADE`
- `marketplace_acceptances.order_id → <orders>(id) ON DELETE CASCADE`
- `marketplace_menu_links.menu_item_id → <catalog>(id) ON DELETE SET NULL`

The migration `20261111200000_marketplace_engine` is replay-safe. On a host
that already has the predecessor's tables it adds the outbound columns
(including `cancellation_offending_skus`, `cancellation_requested_at`,
`preparation_minutes`), the order's `line_skus`, `delivered_by` and the
connection's `archived_at`, keeps the host's foreign keys, and replaces the
closed provider lists (`*_provider_valid`) with a shape check, so a new
adapter is never a migration.

## 6. What stays the host's

The stock draw at the acceptance, the settlement effects, the board's and the
order screen's UI, the cancel route itself, the HTTP client's timeout and CA,
the jobs runtime and its leases, which roles hold the two permissions, and
every sentence a person reads.
