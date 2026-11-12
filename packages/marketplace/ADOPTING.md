# Adopting @12-apps/marketplace

The engine is a library with required ports and no defaults: a host answers
every question only it can answer, and the engine supplies the mechanism.
Everything below is what a host binds, in the order it binds it.

## 1. The host ports (`MarketplacePorts`)

Every field is REQUIRED unless marked OPTIONAL. A missing required one is a type
error at mount, never a default that quietly adopts another host's policy.

| port | type | what the host answers |
|---|---|---|
| `db` | `() => Promise<MarketplaceDb>` | The Prisma client generated from a schema that includes `prisma/marketplace.prisma`. Structural: the four delegates `marketplaceIntegration`, `marketplaceMenuLink`, `marketplaceInboxEvent`, `marketplaceAcceptance`. |
| `transaction` | `<T>(fn: (db: MarketplaceDb) => Promise<T>) => Promise<T>` | Prisma's interactive `$transaction`: run `fn` with the transaction's client; a throw rolls back. Every bulk write and every decision (admission + claim) is one transaction. |
| `order.admit` | `(request: { clientId; orderId; decision: "ACCEPT" \| "REJECT"; admission: MarketplaceAdmission; db: MarketplaceDb }) => Promise<{ admitted: true } \| { admitted: false; code: string; message: string; details?: unknown }>` | Judge each decision BEFORE its claim commits, inside the claim's transaction (`request.db` is the transaction's client: draw the stock there, and a refusal anywhere in the call rolls the draw back). `admission` is `{ admitStockPastZero?: boolean }` as the person stated it. Refuse with your own code: the route answers 409 with it (`MARKETPLACE_STOCK_ASK` and the short lines in `details`). Never called for an ingest or `recordStoreCancellation`. |
| `order.create` | `(clientId, order: NormalizedMarketplaceOrder, lines: readonly ResolvedOrderLine[], db: MarketplaceDb) => Promise<string>` | Create the host's own order from a normalized one; return its id. `lines[i].subjectRef` is the mapped catalog id or null (never refuse the order for a null). `db` is the ingest's transaction client: write the order through it, so the order and the acceptance row commit together (a lost race rolls the host's order back instead of leaving an orphan a redelivery would duplicate). |
| `order.catalogHas` | `(clientId, subjectRef) => Promise<boolean>` | Does this catalog id exist and belong to this tenant? Asked before a SKU is mapped. |
| `order.onAccepted` | `(clientId, orderId) => Promise<void>` | The store accepted, or the connection auto-accepts. Start whatever accepting means here (the ticket, the board). Runs after the commit and AFTER the confirm is queued; a throw is logged and cannot un-accept or lose the confirm. Atomic work (the stock draw) belongs in `admit`. |
| `order.onRefused` | `(clientId, orderId, reason: "REJECTED" \| "EXPIRED" \| "CANCELLED") => Promise<void>` | Refuse/cancel the host order: the store refused on the clock, the clock lapsed, or the marketplace cancelled. After the commit and after the cancellation request is queued; a throw on a decision is logged. NOT called for `recordStoreCancellation`, and not for its confirmation when the host binds `onCancellationConfirmed`. |
| `order.onCancellationConfirmed` | OPTIONAL. `(clientId, orderId) => Promise<void>` | The marketplace CONFIRMED the store's own cancellation request (its event, or the job's answer for a marketplace that answers in the response). Run the host's cancel here when the host requests first and cancels on confirm. Bound: called INSTEAD of `onRefused(…, "CANCELLED")` for a cancellation the store asked for, once (a redelivered confirmation calls nothing). Not bound (a 1.0.0 host): `onRefused(…, "CANCELLED")` as before. A throw is logged. |
| `order.onCancellationFailed` | OPTIONAL. `(clientId, orderId, reason: "REFUSED" \| "TIMEOUT") => Promise<void>` | The store's request FAILED: REFUSED (the marketplace's refusal event, the job's 4xx, or its last attempt dying) or TIMEOUT (the outbound sweep, past the marketplace's answer window, or the 24-hour give-up). Called once, by the path that moved the row. The order stays as it was (AWAITING or ACCEPTED): show the adapter's app link and tell the person. A throw is logged. |
| `order.summarize` | `(clientId, orderIds: readonly string[]) => Promise<Map<string, MarketplaceOrderSummary>>` | The queue's host facts in one read: `{ buyerName, totalCents, unmappedLines, createdAt }`. |
| `secrets` | `{ seal(plaintext): string; open(sealed): string }` | Seal and open the credential blob with the host's key. `open` THROWS on a blob that will not open. |
| `http` | `(req: MarketplaceHttpRequest) => Promise<MarketplaceHttpResponse>` | The only way the engine reaches a marketplace. Answer any status; throw only when no answer arrived (timeout, network). The host owns the timeout, proxy and CA. |
| `audit` | `{ record(entry: { clientId; actorId: string \| null; action: "marketplace.integration.archive" \| "marketplace.integration.unarchive"; provider; reason: string \| null; at: Date }, db: MarketplaceDb): Promise<void> }` | Every archive and unarchive of a connection, INSIDE the same transaction: write the line through `db`, so an archive never lands without its line and a failing audit rolls the archive back. `actorId` is `MarketplaceActor.userId`. |
| `enqueue` | `{ enqueue(name, payload, { dedupeKey? }) => Promise<{ enqueued: boolean; reason?: string }> }` | The wiring `JobsEnqueuePort`. The engine queues only `marketplace.outbound` with `{ clientId, orderId, action }` and dedupe key `marketplace.outbound:<action>:<orderId>`. Never throws. |
| `clock` | `{ now(): Date }` | What time it is. |
| `logger` | `{ info, warn, error }` | The wiring `LoggerPort`; bind `assembled.loggers["@12-apps/marketplace"]`. |
| `publishChanged` | `(clientId) => void` | Tell the staff surfaces something moved. Fire-and-forget. |
| `defaultAckSlaSeconds` | `number` | The acceptance window a new connection gets (the origin host: 300). |
| `reconcileBatchSize` | `number` | Stored deliveries one reconciliation pass re-runs (origin: 50). |
| `maxInboxAttempts` | `number` | Re-runs before a stored delivery is retired (origin: 5). |
| `cancellationWindowMs` | OPTIONAL. `number` | How long a cancellation request the marketplace TOOK (REQUESTED) may wait for its answer before the outbound sweep fails it as TIMEOUT, for every adapter. Absent: each adapter's `capabilities.cancellationAnswerWindowMs` (iFood: 5 minutes, estimated); an adapter with none is given up on only after 24 hours. |

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
| `recordStoreCancellation({ clientId, orderId, reasonCode?, offendingSkus? })` | The store asks to cancel a marketplace order (before or after accepting it). Stamps the REQUEST and queues it; the decision status stays AWAITING or ACCEPTED until the marketplace confirms (decisions draft "request first, cancel on confirm"). `stale` when the marketplace already cancelled it or a request is already waiting. A FAILED request may be asked again. Either cancel first and call this (1.0.0's way), or call this first and cancel in `onCancellationConfirmed`. |
| `suggestReason(provider, { itemUnavailable })` | To preselect a reason in the refusal dialog. The host judges the shortage. |
| `orderStates(clientId, orderIds)` | The order reads: `{ status, confirmedAt, confirmFailedAt, cancellation, cancellationReasonCode, cancellationFailure, appUrl }` per marketplace order, one query. `cancellation` PENDING or REQUESTED is a request still waiting: draw it as such. `cancellationFailure` is REFUSED or TIMEOUT when `cancellation` is FAILED. |
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
11. **Orders accepted before adoption are stamped confirmed, never re-sent.** The migration's
    first run over the predecessor's table sets `confirmed_at = acknowledged_at` on every row
    already `ACCEPTED`, because nothing confirmed through an API before this engine; the outbound
    sweep then owes none of them. Fresh databases and replays stamp nothing.
12. **`order.create` and `audit.record` receive a transaction client** (last argument): write
    the host's order and the audit line through it, so they commit with the engine's own rows.
    Everything `create` writes goes through that client, the buyer record and the order
    number included, never the host's global client inside the callback: on PGlite, which
    runs one transaction at a time, a write on the global client hangs the ingest, and on
    Postgres a rolled-back ingest would leave an orphan order and a burnt order number.
13. **Request first, cancel on confirm (1.1, FUT-4758).** `recordStoreCancellation` no longer
    stamps the decision REJECTED: only the request moves, and the marketplace's confirmation
    does the rest. A host that cancels first (1.0.0's way) keeps working: its own cancel ran,
    and it never read the status back. To cancel only on confirm instead:
    - call `recordStoreCancellation` from every cancel entry point, without cancelling;
    - draw `orderStates(…).cancellation` PENDING/REQUESTED as "waiting for the marketplace";
    - bind `order.onCancellationConfirmed` (run the ordinary cancel there, with the reason the
      store chose: the host keeps it, the engine carries only the marketplace's code);
    - bind `order.onCancellationFailed` (REFUSED or TIMEOUT: the order stays, show the app link);
    - run migration `20261112120000_marketplace_cancellation_failure` (one nullable column,
      its CHECK and an index), through the host's plugin-migration sync like the first.

## 5. The database

The partial names no host table: `client_id`, `order_id` and `menu_item_id`
are by-value scalars. A host that wants referential integrity adds, in its own
migration:

- `marketplace_*.client_id → <tenants>(id) ON DELETE CASCADE`
- `marketplace_acceptances.order_id → <orders>(id) ON DELETE CASCADE`
- `marketplace_menu_links.menu_item_id → <catalog>(id) ON DELETE SET NULL`

The migrations are replay-safe. `20261112120000_marketplace_cancellation_failure`
(1.1) adds `marketplace_acceptances.cancellation_failure_reason` (REFUSED or
TIMEOUT, CHECKed), and an index the expiry of waiting requests reads.

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
